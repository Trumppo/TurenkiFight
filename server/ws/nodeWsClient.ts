import WebSocket, { type RawData } from 'ws';
import { SessionClientCore, type SessionClientHandlers } from '../../src/game/networking/wsSessionClient';

/**
 * Node-only synthetic client used by the benchmark driver and the local
 * integration test. It shares `SessionClientCore` with the browser adapter, so
 * protocol handling is identical; only the socket implementation differs.
 *
 * Requires the `ws` devDependency. Never import this module from `src/`.
 */
export type NodeSessionOptions = {
  url: string;
  handlers?: SessionClientHandlers;
  openTimeoutMs?: number;
  /**
   * Read-only wire accounting at the socket boundary: one event per text frame
   * with its UTF-8 byte length. It never rewrites, delays or reorders a payload,
   * so wrapping this hook cannot change protocol behaviour.
   */
  onWireMessage?: (event: WireMessageSize) => void;
};

export type WireMessageSize = {
  readonly direction: 'in' | 'out';
  readonly bytes: number;
};

export type NodeSession = {
  client: SessionClientCore;
  /** Test/benchmark hook for deliberately malformed or spoofed payloads. */
  sendRaw: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  closed: Promise<void>;
};

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data));
}

export async function openNodeSession(options: NodeSessionOptions): Promise<NodeSession> {
  if (typeof options?.url !== 'string' || options.url.length === 0) throw new Error('WebSocket URL is required');
  const timeoutMs = options.openTimeoutMs ?? 5000;
  const onWireMessage = options.onWireMessage ?? null;
  if (onWireMessage !== null && typeof onWireMessage !== 'function') {
    throw new Error('Invalid wire observer');
  }
  /** A throwing observer must never break the socket or the client core. */
  const noteWire = (direction: 'in' | 'out', bytes: number): void => {
    if (onWireMessage === null) return;
    try {
      onWireMessage({ direction, bytes });
    } catch {
      // Observation is optional; a bad sink is ignored.
    }
  };
  const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');
  const socket = new WebSocket(options.url);
  const client = new SessionClientCore(options.handlers);

  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>(resolve => {
    resolveClosed = resolve;
  });

  socket.on('message', (data: RawData) => {
    const text = toText(data);
    noteWire('in', byteLength(text));
    client.receive(text);
  });
  socket.on('close', () => {
    client.markTransportClosed();
    resolveClosed();
  });
  socket.on('error', (error: Error) => client.markTransportError(error.message));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out opening WebSocket'));
    }, timeoutMs);
    const onOpen = () => {
      clearTimeout(timer);
      socket.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      clearTimeout(timer);
      socket.off('open', onOpen);
      reject(error);
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });

  client.attachTransport(text => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    noteWire('out', byteLength(text));
    socket.send(text);
  });

  return {
    client,
    sendRaw: (data: string) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
      noteWire('out', byteLength(data));
      socket.send(data);
    },
    close: (code = 1000, reason = 'client closing') => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(code, reason);
      }
    },
    closed,
  };
}
