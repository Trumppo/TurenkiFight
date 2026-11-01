import type { DataChannelPort } from '../../src/game/networking/dataChannelSession';

/**
 * Ordered, in-memory DataChannel pair for the bounded WebRTC correctness run.
 *
 * This emulates the *message semantics* of one ordered RTCDataChannel. It does
 * not implement SCTP, ICE, DTLS, congestion control or any real network path,
 * and it is never a source of latency or bandwidth numbers.
 */
export type LoopbackChannelPair = {
  host: DataChannelPort;
  client: DataChannelPort;
};

const noop = (): void => undefined;

export function createLoopbackDataChannelPair(): LoopbackChannelPair {
  let closed = false;

  const endpoint = (): DataChannelPort => ({
    readyState: 'open',
    send: noop,
    close: noop,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  });

  const host = endpoint();
  const client = endpoint();

  const close = (): void => {
    if (closed) return;
    closed = true;
    host.readyState = 'closed';
    client.readyState = 'closed';
    host.onclose?.();
    client.onclose?.();
  };

  host.send = text => {
    if (closed) throw new Error('DataChannel is closed');
    client.onmessage?.({ data: text });
  };
  client.send = text => {
    if (closed) throw new Error('DataChannel is closed');
    host.onmessage?.({ data: text });
  };
  host.close = close;
  client.close = close;

  return { host, client };
}
