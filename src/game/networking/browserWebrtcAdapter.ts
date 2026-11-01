import { isSessionIdentifier } from '../session/sessionEnvelope';
import {
  attachDataChannelSession,
  toDataChannelPort,
  type DataChannelSession,
} from './dataChannelSession';
import {
  openSignalingClient,
  type SignalingClient,
  type SignalingSocketFactory,
} from './signalingClient';
import type { SessionClientCore, SessionClientHandlers } from './wsSessionClient';
import {
  fromSignalCandidate,
  resolvePeerConnectionFactory,
  toSignalCandidate,
  type PeerConnectionFactory,
} from './browserRtcSupport';

/**
 * Browser WebRTC client adapter for architecture B.
 *
 * It negotiates one ordered DataChannel with the browser host over a room-scoped
 * signaling relay, then attaches the same `SessionClientCore` used by the
 * WebSocket adapter. The client is not an authority: it emits the canonical
 * session envelope and consumes authoritative snapshots.
 *
 * The adapter waits for the host's `welcome` message before resolving, so a
 * caller can safely send `join-request` immediately afterwards.
 */
export type BrowserWebrtcSessionOptions = {
  signalingUrl: string;
  roomId: string;
  handlers?: SessionClientHandlers;
  iceServers?: RTCIceServer[];
  dataChannelLabel?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global WebSocket constructor. */
  signalingSocketFactory?: SignalingSocketFactory;
  /** Injectable for tests; defaults to the global RTCPeerConnection. */
  peerConnectionFactory?: PeerConnectionFactory;
};

export type BrowserWebrtcSession = {
  client: SessionClientCore;
  close: () => void;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export function openBrowserWebrtcSession(
  options: BrowserWebrtcSessionOptions,
): Promise<BrowserWebrtcSession> {
  if (typeof options?.signalingUrl !== 'string' || options.signalingUrl.length === 0) {
    throw new Error('Signaling URL is required');
  }
  if (!isSessionIdentifier(options.roomId)) throw new Error('Invalid signaling room');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Invalid WebRTC timeout');
  }
  const createPeerConnection = resolvePeerConnectionFactory(options.peerConnectionFactory);

  return new Promise<BrowserWebrtcSession>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let signaling: SignalingClient | null = null;
    let peer: RTCPeerConnection | null = null;
    let channelSession: DataChannelSession | null = null;
    let channelOpen = false;
    let welcomed = false;
    let hostPeerId: string | null = null;
    let remoteDescriptionSet = false;
    let negotiating = false;
    let offerSent = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];
    const localCandidates: RTCIceCandidate[] = [];

    const mergedHandlers: SessionClientHandlers = {
      ...options.handlers,
      onWelcome: info => {
        welcomed = true;
        options.handlers?.onWelcome?.(info);
        maybeResolve();
      },
      onTransportClosed: () => {
        options.handlers?.onTransportClosed?.();
        if (!settled) fail(new Error('WebRTC session closed before the handshake completed'));
      },
    };

    const clearTimer = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const cleanup = (): void => {
      clearTimer();
      const session = channelSession;
      channelSession = null;
      try { session?.close(); } catch { /* already closed */ }
      try { peer?.close(); } catch { /* already closed */ }
      peer = null;
      try { signaling?.close(); } catch { /* already closed */ }
      signaling = null;
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const maybeResolve = (): void => {
      if (settled || !channelOpen || !welcomed || !channelSession) return;
      settled = true;
      clearTimer();
      const client = channelSession.client;
      resolve({
        client,
        close: () => cleanup(),
      });
    };

    const negotiate = (): void => {
      if (settled || negotiating || peer || !hostPeerId) return;
      negotiating = true;
      const target = hostPeerId;
      void (async () => {
        try {
          const connection = createPeerConnection({ iceServers: options.iceServers ?? [] });
          peer = connection;
          connection.onicecandidate = event => {
            if (!event.candidate || !hostPeerId) return;
            if (!offerSent) {
              localCandidates.push(event.candidate);
              return;
            }
            try {
              signaling?.signalCandidate(hostPeerId, toSignalCandidate(event.candidate));
            } catch {
              // Signaling closure is reported through the transport handler.
            }
          };
          connection.onconnectionstatechange = () => {
            const state = connection.connectionState;
            if (state === 'failed') fail(new Error('WebRTC connection failed'));
          };
          const channel = connection.createDataChannel(
            options.dataChannelLabel ?? 'turenki-session',
            { ordered: true },
          );
          channelSession = attachDataChannelSession(toDataChannelPort(channel), mergedHandlers, {
            onOpen: () => {
              channelOpen = true;
              maybeResolve();
            },
            onClose: () => {
              if (!settled) fail(new Error('DataChannel closed before the host session started'));
            },
          });
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          const sdp = connection.localDescription?.sdp;
          if (!sdp) throw new Error('WebRTC offer has no SDP');
          signaling?.signalDescription(target, { type: 'offer', sdp });
          offerSent = true;
          for (const candidate of localCandidates.splice(0)) {
            signaling?.signalCandidate(target, toSignalCandidate(candidate));
          }
          negotiating = false;
        } catch (error) {
          negotiating = false;
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    };

    timer = setTimeout(() => fail(new Error('Timed out establishing a WebRTC session')), timeoutMs);

    try {
      signaling = openSignalingClient({
        url: options.signalingUrl,
        roomId: options.roomId,
        role: 'client',
        ...(options.signalingSocketFactory === undefined
          ? {}
          : { socketFactory: options.signalingSocketFactory }),
        handlers: {
          onJoined: info => {
            hostPeerId = info.peers.find(peerInfo => peerInfo.role === 'host')?.peerId ?? null;
            negotiate();
          },
          onPeerJoined: peerInfo => {
            if (peerInfo.role !== 'host') return;
            hostPeerId = peerInfo.peerId;
            negotiate();
          },
          onPeerLeft: peerId => {
            if (peerId === hostPeerId) fail(new Error('Host left the signaling room'));
          },
          onSignal: message => {
            if (message.description?.type === 'answer') {
              if (!peer) {
                fail(new Error('Received an answer before an offer was sent'));
                return;
              }
              void peer.setRemoteDescription({ type: 'answer', sdp: message.description.sdp })
                .then(async () => {
                  remoteDescriptionSet = true;
                  for (const candidate of pendingCandidates.splice(0)) {
                    await peer?.addIceCandidate(candidate);
                  }
                })
                .catch(error => fail(error instanceof Error ? error : new Error(String(error))));
              return;
            }
            if (message.candidate) {
              const candidate = fromSignalCandidate(message.candidate);
              if (peer && remoteDescriptionSet) {
                void peer.addIceCandidate(candidate)
                  .catch(error => fail(error instanceof Error ? error : new Error(String(error))));
              } else {
                pendingCandidates.push(candidate);
              }
            }
          },
          onError: error => fail(new Error(`Signaling error: ${error.code}`)),
          onProtocolError: message => fail(new Error(`Malformed signaling message: ${message}`)),
          onTransportClosed: () => {
            if (!settled) fail(new Error('Signaling connection closed during WebRTC setup'));
          },
          onTransportError: message => {
            if (!settled) fail(new Error(`Signaling transport error: ${message}`));
          },
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
