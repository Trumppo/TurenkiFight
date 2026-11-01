import { SessionClientCore, type SessionClientHandlers } from './wsSessionClient';

/**
 * The small DataChannel surface the WebRTC adapters need.
 *
 * `RTCDataChannel` satisfies this shape at runtime. Browser adapters cast a real
 * channel with `toDataChannelPort` once at the RTC boundary; tests and the
 * emulated benchmark supply an in-memory channel instead.
 */
export type DataChannelPort = {
  readyState: string;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event?: unknown) => void) | null;
};

export type DataChannelSession = {
  client: SessionClientCore;
  close: () => void;
};

export type DataChannelSessionOptions = {
  onOpen?: () => void;
  onClose?: () => void;
};

/** Single documented cast point for a browser `RTCDataChannel`. */
export function toDataChannelPort(channel: RTCDataChannel): DataChannelPort {
  return channel as unknown as DataChannelPort;
}

/**
 * Attaches the transport-neutral `SessionClientCore` to one DataChannel.
 *
 * This is the WebRTC counterpart of `browserWsAdapter`: the same client core,
 * the same canonical session envelope, and no transport-specific protocol.
 * Messages requested before the channel opens are queued in order.
 */
export function attachDataChannelSession(
  channel: DataChannelPort,
  handlers: SessionClientHandlers = {},
  options: DataChannelSessionOptions = {},
): DataChannelSession {
  const client = new SessionClientCore(handlers);
  const queue: string[] = [];
  let open = channel.readyState === 'open';
  let closed = false;

  const markClosed = (): void => {
    if (closed) return;
    closed = true;
    open = false;
    queue.length = 0;
    client.markTransportClosed();
    options.onClose?.();
  };

  const sendText = (text: string): void => {
    try {
      channel.send(text);
    } catch (error) {
      client.markTransportError(error instanceof Error ? error.message : 'DataChannel send failed');
    }
  };

  channel.onopen = () => {
    if (closed) return;
    open = true;
    for (const text of queue.splice(0)) sendText(text);
    options.onOpen?.();
  };
  channel.onmessage = event => {
    if (closed) return;
    const data: unknown = event?.data;
    if (typeof data === 'string') client.receive(data);
    else if (data instanceof ArrayBuffer) client.receive(new Uint8Array(data));
    else if (data instanceof Uint8Array) client.receive(data);
    else client.markTransportError('Unsupported DataChannel payload');
  };
  channel.onclose = () => markClosed();
  channel.onerror = () => client.markTransportError('DataChannel error');

  client.attachTransport(text => {
    if (closed) throw new Error('DataChannel is closed');
    if (open) sendText(text);
    else queue.push(text);
  });

  if (open) options.onOpen?.();

  return {
    client,
    close: () => {
      if (closed) return;
      markClosed();
      try {
        channel.close();
      } catch {
        // Already closed.
      }
    },
  };
}
