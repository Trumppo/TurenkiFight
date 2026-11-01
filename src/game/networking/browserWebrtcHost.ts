import { isSessionIdentifier } from '../session/sessionEnvelope';
import { toDataChannelPort } from './dataChannelSession';
import {
  openSignalingClient,
  type SignalingClient,
  type SignalingSocketFactory,
} from './signalingClient';
import { WebrtcHostSession, type WebrtcHostSessionOptions } from './webrtcHostSession';
import type { SnapshotHz, WsServerMessage } from './wsMessages';
import type { WsSessionPhase } from '../../../server/ws/authoritativeWsSession';
import {
  fromSignalCandidate,
  resolvePeerConnectionFactory,
  toSignalCandidate,
  type PeerConnectionFactory,
} from './browserRtcSupport';

/**
 * Browser-host signaling/RTC shell for architecture B.
 *
 * The host opens a signaling room, answers one offer per remote browser and
 * hands every incoming DataChannel to `WebrtcHostSession`, which reuses the
 * existing authoritative session. Signaling is only a relay: it never accepts
 * gameplay input, and the host allocates the trusted connection ID per channel.
 *
 * Prototype only: no authentication, no TLS, no TURN/NAT traversal and no
 * production hardening.
 */
export type BrowserWebrtcHostOptions = {
  signalingUrl: string;
  roomId: string;
  playerIds?: readonly string[];
  snapshotHz?: SnapshotHz;
  maxLead?: number;
  maxTicks?: number;
  iceServers?: RTCIceServer[];
  timeoutMs?: number;
  onOutgoing?: (targetConnectionId: string | null, message: WsServerMessage) => void;
  onPhaseChange?: (phase: WsSessionPhase) => void;
  signalingSocketFactory?: SignalingSocketFactory;
  peerConnectionFactory?: PeerConnectionFactory;
};

export type BrowserWebrtcHost = {
  session: WebrtcHostSession;
  close: () => void;
};

const DEFAULT_TIMEOUT_MS = 15_000;

type PeerLink = {
  connection: RTCPeerConnection;
  remoteDescriptionSet: boolean;
  answerSent: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  localCandidates: RTCIceCandidate[];
};

export function openBrowserWebrtcHost(options: BrowserWebrtcHostOptions): Promise<BrowserWebrtcHost> {
  if (typeof options?.signalingUrl !== 'string' || options.signalingUrl.length === 0) {
    throw new Error('Signaling URL is required');
  }
  if (!isSessionIdentifier(options.roomId)) throw new Error('Invalid signaling room');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Invalid WebRTC timeout');
  }
  const createPeerConnection = resolvePeerConnectionFactory(options.peerConnectionFactory);

  const sessionOptions: WebrtcHostSessionOptions = {
    roomId: options.roomId,
    ...(options.playerIds === undefined ? {} : { playerIds: options.playerIds }),
    ...(options.snapshotHz === undefined ? {} : { snapshotHz: options.snapshotHz }),
    ...(options.maxLead === undefined ? {} : { maxLead: options.maxLead }),
    ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
    ...(options.onOutgoing === undefined ? {} : { onOutgoing: options.onOutgoing }),
    ...(options.onPhaseChange === undefined ? {} : { onPhaseChange: options.onPhaseChange }),
  };
  const hostSession = new WebrtcHostSession(sessionOptions);

  return new Promise<BrowserWebrtcHost>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let signaling: SignalingClient | null = null;
    const links = new Map<string, PeerLink>();

    const clearTimer = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const closeLinks = (): void => {
      for (const link of links.values()) {
        try { link.connection.close(); } catch { /* already closed */ }
      }
      links.clear();
    };

    const cleanup = (): void => {
      clearTimer();
      closeLinks();
      try { signaling?.close(); } catch { /* already closed */ }
      signaling = null;
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try { hostSession.close('host-lost'); } catch { /* already closed */ }
      reject(error);
    };

    const removePeer = (peerId: string): void => {
      const link = links.get(peerId);
      if (!link) return;
      links.delete(peerId);
      try { link.connection.close(); } catch { /* already closed */ }
    };

    const acceptChannel = (channel: RTCDataChannel): void => {
      const port = toDataChannelPort(channel);
      const accept = (): void => {
        try {
          hostSession.acceptChannel(port);
        } catch {
          try { port.close(); } catch { /* already closed */ }
        }
      };
      if (port.readyState === 'open') accept();
      else port.onopen = accept;
    };

    const answerOffer = (peerId: string, sdp: string): void => {
      if (links.has(peerId)) return;
      let connection: RTCPeerConnection;
      try {
        connection = createPeerConnection({ iceServers: options.iceServers ?? [] });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const link: PeerLink = {
        connection,
        remoteDescriptionSet: false,
        answerSent: false,
        pendingCandidates: [],
        localCandidates: [],
      };
      links.set(peerId, link);

      connection.onicecandidate = event => {
        if (!event.candidate) return;
        if (!link.answerSent) {
          link.localCandidates.push(event.candidate);
          return;
        }
        try {
          signaling?.signalCandidate(peerId, toSignalCandidate(event.candidate));
        } catch {
          // Signaling closure is handled by the transport callback.
        }
      };
      connection.ondatachannel = event => acceptChannel(event.channel);
      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === 'failed' || state === 'closed') removePeer(peerId);
      };

      void (async () => {
        try {
          await connection.setRemoteDescription({ type: 'offer', sdp });
          link.remoteDescriptionSet = true;
          for (const candidate of link.pendingCandidates.splice(0)) {
            await connection.addIceCandidate(candidate);
          }
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          const answerSdp = connection.localDescription?.sdp;
          if (!answerSdp) throw new Error('WebRTC answer has no SDP');
          signaling?.signalDescription(peerId, { type: 'answer', sdp: answerSdp });
          link.answerSent = true;
          for (const candidate of link.localCandidates.splice(0)) {
            signaling?.signalCandidate(peerId, toSignalCandidate(candidate));
          }
        } catch (error) {
          removePeer(peerId);
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    };

    timer = setTimeout(() => fail(new Error('Timed out opening the WebRTC signaling room')), timeoutMs);

    try {
      signaling = openSignalingClient({
        url: options.signalingUrl,
        roomId: options.roomId,
        role: 'host',
        ...(options.signalingSocketFactory === undefined
          ? {}
          : { socketFactory: options.signalingSocketFactory }),
        handlers: {
          onJoined: () => {
            if (settled) return;
            settled = true;
            clearTimer();
            resolve({
              session: hostSession,
              close: () => {
                try { hostSession.close('host-lost'); } catch { /* already closed */ }
                cleanup();
              },
            });
          },
          onPeerLeft: peerId => removePeer(peerId),
          onSignal: message => {
            if (message.description?.type === 'offer') {
              answerOffer(message.from, message.description.sdp);
              return;
            }
            if (!message.candidate) return;
            const link = links.get(message.from);
            if (!link) return;
            const candidate = fromSignalCandidate(message.candidate);
            if (link.remoteDescriptionSet) {
              void link.connection.addIceCandidate(candidate)
                .catch(() => removePeer(message.from));
            } else {
              link.pendingCandidates.push(candidate);
            }
          },
          onError: error => fail(new Error(`Signaling error: ${error.code}`)),
          onProtocolError: message => fail(new Error(`Malformed signaling message: ${message}`)),
          onTransportClosed: () => {
            if (!settled) fail(new Error('Signaling connection closed during host setup'));
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
