import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  MAX_SIGNALING_MESSAGE_BYTES,
  encodeServerSignalingMessage,
} from '../../src/game/networking/signalingMessages';
import { isSessionIdentifier } from '../../src/game/session/sessionEnvelope';
import { DEFAULT_SIGNALING_ROOM_ID, SignalingRelay } from './signalingRelay';

/**
 * Thin Node WebSocket transport around `SignalingRelay`.
 *
 * A trusted `sig-N` identity is allocated per socket; nothing in a signaling
 * payload can set it. This is loopback development infrastructure only: no TLS,
 * authentication, origin checks, rate limiting or production hardening.
 */
export type SignalingServerConfig = {
  port: number;
  host?: string;
  roomId?: string;
  maxPeers?: number;
};

export type SignalingServerHandle = {
  readonly port: number;
  readonly host: string;
  readonly relay: SignalingRelay;
  close(): Promise<void>;
};

function rawBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

export async function startSignalingServer(
  config: SignalingServerConfig,
): Promise<SignalingServerHandle> {
  if (!Number.isSafeInteger(config?.port) || config.port < 0 || config.port > 65535) {
    throw new Error('Invalid signaling port');
  }
  const host = config.host ?? '127.0.0.1';
  const roomId = config.roomId ?? DEFAULT_SIGNALING_ROOM_ID;
  if (!isSessionIdentifier(roomId)) throw new Error('Invalid signaling room');

  const sockets = new Map<string, WebSocket>();
  let nextPeerId = 1;
  let closed = false;

  const httpServer: Server = createServer((request, response) => {
    // Playwright (and operators) can probe readiness without a WebSocket client.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('ok');
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  const relay = new SignalingRelay({
    roomId,
    ...(config.maxPeers === undefined ? {} : { maxPeers: config.maxPeers }),
    onOutgoing: (peerId, message) => {
      const socket = sockets.get(peerId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      let encoded: string;
      try {
        encoded = encodeServerSignalingMessage(message);
      } catch (error) {
        process.stderr.write(`webrtc signaling: failed to encode ${message.kind}: ${String(error)}\n`);
        return;
      }
      socket.send(encoded, error => {
        if (error) socket.terminate();
      });
    },
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_SIGNALING_MESSAGE_BYTES });

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    httpServer.once('listening', onListening);
    httpServer.once('error', onError);
    httpServer.listen(config.port, host);
  });

  httpServer.on('error', error => {
    process.stderr.write(`webrtc signaling: server error: ${error.message}\n`);
  });

  wss.on('connection', socket => {
    if (closed) {
      socket.close(1001, 'server closed');
      return;
    }
    const peerId = `sig-${nextPeerId++}`;
    try {
      relay.addPeer(peerId);
    } catch {
      socket.close(1008, 'registration denied');
      return;
    }
    sockets.set(peerId, socket);
    socket.on('message', (data: RawData) => {
      // Trusted context is the socket's allocated ID, never a payload field.
      relay.handleMessage(peerId, rawBytes(data));
    });
    socket.on('close', () => {
      if (!sockets.delete(peerId)) return;
      relay.disconnect(peerId);
    });
    socket.on('error', () => {
      try {
        socket.terminate();
      } catch {
        // Already closed.
      }
    });
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null
    ? (address as AddressInfo).port
    : config.port;

  return {
    port: boundPort,
    host,
    relay,
    close: async () => {
      if (closed) return;
      closed = true;
      relay.close();
      for (const socket of sockets.values()) {
        try {
          socket.close(1000, 'server stopping');
        } catch {
          // Already closed.
        }
      }
      sockets.clear();
      await new Promise<void>(resolve => {
        wss.close(() => resolve());
      });
      await new Promise<void>(resolve => {
        httpServer.close(() => resolve());
      });
    },
  };
}
