import { SessionClientCore, type SessionClientHandlers } from './wsSessionClient';

/**
 * Browser-only WebSocket adapter. It deliberately uses the global WebSocket
 * API and never imports the Node `ws` package, so the browser bundle cannot
 * pull in a server dependency.
 */
export type SessionSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type BrowserSocketHandlers = {
  onOpen: () => void;
  onMessage: (data: string | Uint8Array) => void;
  onClose: () => void;
  onError: (error?: unknown) => void;
};

export type BrowserSocketFactory = (url: string, handlers: BrowserSocketHandlers) => SessionSocket;

export type BrowserSessionOptions = {
  url: string;
  roomId: string;
  handlers?: SessionClientHandlers;
  /** Injectable for tests; defaults to the global WebSocket constructor. */
  socketFactory?: BrowserSocketFactory;
};

export type BrowserSession = {
  client: SessionClientCore;
  close: (code?: number, reason?: string) => void;
};

const OPEN = 1;

/** Resolves the global WebSocket at call time so tests can inject a stub. */
export function createGlobalWebSocketFactory(): BrowserSocketFactory {
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
        if (socket.readyState !== OPEN) throw new Error('WebSocket is not open');
        socket.send(data);
      },
      close: (code?: number, reason?: string) => socket.close(code, reason),
    };
  };
}

/**
 * Opens a session client over the browser WebSocket API. Returns immediately;
 * callers wait for `onJoinResult` before submitting input.
 */
export function openBrowserSession(options: BrowserSessionOptions): BrowserSession {
  if (typeof options?.url !== 'string' || options.url.length === 0) throw new Error('WebSocket URL is required');
  if (typeof options.roomId !== 'string' || options.roomId.length === 0) throw new Error('Room ID is required');

  const client = new SessionClientCore(options.handlers);
  const factory = options.socketFactory ?? createGlobalWebSocketFactory();
  let ready = false;
  const queued: string[] = [];
  let socket: SessionSocket;
  socket = factory(options.url, {
    onOpen: () => {
      // Messages requested before the handshake completes are flushed in order.
      ready = true;
      for (const data of queued.splice(0)) socket.send(data);
    },
    onMessage: data => client.receive(data),
    onClose: () => {
      ready = false;
      queued.length = 0;
      client.markTransportClosed();
    },
    onError: error => client.markTransportError(error instanceof Error ? error.message : 'WebSocket error'),
  });
  client.attachTransport(data => {
    if (ready) socket.send(data);
    else queued.push(data);
  });
  return {
    client,
    close: (code?: number, reason?: string) => {
      ready = false;
      queued.length = 0;
      socket.close(code, reason);
    },
  };
}
