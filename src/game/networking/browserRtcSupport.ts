import type { SignalCandidate } from './signalingMessages';

/**
 * Browser-only helpers shared by the WebRTC client and host adapters.
 *
 * No Node or `ws` import may appear here: the same modules are loaded by the
 * Vite-served browser prototype and by Playwright pages.
 */
export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;

/** Resolves the global constructor at call time so tests can inject a stub. */
export function resolvePeerConnectionFactory(factory?: PeerConnectionFactory): PeerConnectionFactory {
  if (factory) return factory;
  const Constructor = (globalThis as typeof globalThis & {
    RTCPeerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection;
  }).RTCPeerConnection;
  if (typeof Constructor !== 'function') throw new Error('WebRTC is not available in this environment');
  return config => new Constructor(config);
}

/** Only the interoperable candidate fields cross the signaling relay. */
export function toSignalCandidate(candidate: RTCIceCandidate): SignalCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
  };
}

export function fromSignalCandidate(candidate: SignalCandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
}
