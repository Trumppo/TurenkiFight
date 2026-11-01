import { isSessionIdentifier } from '../session/sessionEnvelope';
import {
  SIGNALING_PROTOCOL_VERSION,
  decodeServerSignalingMessage,
  encodeClientSignalingMessage,
  type SignalCandidate,
  type SignalDescription,
  type SignalingPeer,
  type SignalingRole,
} from './signalingMessages';

/**
 * Browser-safe WebSocket signaling client for the WebRTC prototype.
 *
 * It only exchanges room-scoped offer/answer/ICE messages. It does not open a
 * simulation session, read the session envelope or grant any authority. The
 * caller supplies the target peer ID learned from `joined`/`peer-joined`;
 * the relay re-validates that target against its own trusted roster.
 */
export type SignalingSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type SignalingSocketHandlers = {
  onOpen: () => void;
  onMessage: (data: string | Uint8Array) => void;
  onClose: () => void;
  onError: (error?: unknown) => void;
};

export type SignalingSocketFactory = (url: string, handlers: SignalingSocketHandlers) => SignalingSocket;

export type SignalingClientHandlers = {
  onJoined?: (info: { peerId: string; role: SignalingRole; peers: readonly SignalingPeer[] }) => void;
  onPeerJoined?: (peer: SignalingPeer) => void;
  onPeerLeft?: (peerId: string) => void;
  onSignal?: (message: {
    from: string;
    description?: SignalDescription;
    candidate?: SignalCandidate;
  }) => void;
  onError?: (error: { code: string; message: string }) => void;
  /** Malformed server bytes are ignored without mutating signaling state. */
  onProtocolError?: (message: string) => void;
  onTransportClosed?: () => void;
  onTransportError?: (message: string) => void;
};

export type SignalingClientOptions = {
  url: string;
  roomId: string;
  role: SignalingRole;
  handlers?: SignalingClientHandlers;
  /** Injectable for tests; defaults to the global WebSocket constructor. */
  socketFactory?: SignalingSocketFactory;
};

export type SignalingClient = {
  readonly peerId: string | null;
  readonly role: SignalingRole;
  readonly joined: boolean;
  readonly hostPeerId: string | null;
  signalDescription(target: string, description: SignalDescription): number;
  signalCandidate(target: string, candidate: SignalCandidate): number;
  close(code?: number, reason?: string): void;
};

const OPEN = 1;

/** Resolves the global WebSocket at call time so tests can inject a stub. */
export function createGlobalSignalingSocketFactory(): SignalingSocketFactory {
  const Constructor = (globalThis as typeof globalThis & {
    WebSocket?: new (url: string) => WebSocket;
  }).WebSocket;
  if (typeof Constructor !== 'function') throw new Error('WebSocket is not available in this environment');

  return (url, handlers) => {
    const socket = new Constructor(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === 'string') handlers.onMessage(data);
      else if (data instanceof ArrayBuffer) handlers.onMessage(new Uint8Array(data));
      else if (data instanceof Uint8Array) handlers.onMessage(data);
      else handlers.onMessage(String(data));
    };
    socket.onclose = () => handlers.onClose();
    socket.onerror = (event: Event) => handlers.onError(event);
    return {
      send: (data: string) => {
        if (socket.readyState !== OPEN) throw new Error('Signaling socket is not open');
        socket.send(data);
      },
      close: (code?: number, reason?: string) => socket.close(code, reason),
    };
  };
}

export function openSignalingClient(options: SignalingClientOptions): SignalingClient {
  if (typeof options?.url !== 'string' || options.url.length === 0) throw new Error('Signaling URL is required');
  if (!isSessionIdentifier(options.roomId)) throw new Error('Invalid signaling room');
  if (options.role !== 'host' && options.role !== 'client') throw new Error('Invalid signaling role');

  const handlers = options.handlers ?? {};
  const factory = options.socketFactory ?? createGlobalSignalingSocketFactory();
  const peers = new Map<string, SignalingRole>();
  let peerId: string | null = null;
  let joined = false;
  let ready = false;
  let sequence = 0;
  let closed = false;
  const queued: string[] = [];

  const joinMessage = encodeClientSignalingMessage({
    version: SIGNALING_PROTOCOL_VERSION,
    kind: 'join',
    roomId: options.roomId,
    role: options.role,
  });

  const sendRaw = (data: string): void => {
    if (closed) return;
    if (ready) socket.send(data);
    else queued.push(data);
  };

  // The join is always the first message; it is flushed once the socket opens.
  queued.push(joinMessage);

  const socket = factory(options.url, {
    onOpen: () => {
      ready = true;
      for (const data of queued.splice(0)) socket.send(data);
    },
    onMessage: data => {
      let message;
      try {
        message = decodeServerSignalingMessage(data);
      } catch (error) {
        handlers.onProtocolError?.(error instanceof Error ? error.message : 'Malformed signaling message');
        return;
      }
      switch (message.kind) {
        case 'joined':
          peerId = message.peerId;
          joined = true;
          peers.clear();
          for (const peer of message.peers) peers.set(peer.peerId, peer.role);
          handlers.onJoined?.({ peerId: message.peerId, role: message.role, peers: message.peers });
          return;
        case 'peer-joined':
          peers.set(message.peerId, message.role);
          handlers.onPeerJoined?.({ peerId: message.peerId, role: message.role });
          return;
        case 'peer-left':
          peers.delete(message.peerId);
          handlers.onPeerLeft?.(message.peerId);
          return;
        case 'signal':
          handlers.onSignal?.({
            from: message.from,
            ...(message.description === undefined ? {} : { description: message.description }),
            ...(message.candidate === undefined ? {} : { candidate: message.candidate }),
          });
          return;
        case 'error':
          handlers.onError?.({ code: message.code, message: message.message });
          return;
      }
    },
    onClose: () => {
      ready = false;
      joined = false;
      queued.length = 0;
      handlers.onTransportClosed?.();
    },
    onError: error =>
      handlers.onTransportError?.(error instanceof Error ? error.message : 'Signaling socket error'),
  });

  const signal = (
    target: string,
    payload: { description: SignalDescription } | { candidate: SignalCandidate },
  ): number => {
    if (!joined) throw new Error('Signaling join is not accepted yet');
    if (!isSessionIdentifier(target)) throw new Error('Invalid signaling target');
    if (sequence >= Number.MAX_SAFE_INTEGER - 1) throw new Error('Signaling sequence exhausted');
    sequence += 1;
    sendRaw(encodeClientSignalingMessage({
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'signal',
      sequence,
      target,
      ...payload,
    }));
    return sequence;
  };

  return {
    get peerId() { return peerId; },
    role: options.role,
    get joined() { return joined; },
    get hostPeerId() {
      for (const [candidateId, role] of peers) if (role === 'host') return candidateId;
      return null;
    },
    signalDescription: (target, description) => signal(target, { description }),
    signalCandidate: (target, candidate) => signal(target, { candidate }),
    close: (code = 1000, reason = 'signaling closing') => {
      if (closed) return;
      closed = true;
      queued.length = 0;
      try {
        socket.close(code, reason);
      } catch {
        // Already closed.
      }
    },
  };
}
