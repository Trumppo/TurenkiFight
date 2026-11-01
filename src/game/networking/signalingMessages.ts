import { isSessionIdentifier } from '../session/sessionEnvelope';

/**
 * Prototype WebRTC signaling schema.
 *
 * Architecture B (browser-host authority) needs a tiny room-scoped relay so two
 * peers can exchange an SDP offer/answer and ICE candidates. This module is a
 * codec only: it defines no gameplay authority and never touches the session
 * envelope or simulation. Signaling messages are deliberately separate from
 * `wsMessages.ts`, so the input path cannot be confused with control traffic.
 *
 * This is NOT a frozen wire contract, has no authentication or TLS claims, and
 * does not select a production topology.
 */
export const SIGNALING_PROTOCOL_VERSION = 1 as const;

export const SIGNALING_ROLES = ['host', 'client'] as const;
export type SignalingRole = (typeof SIGNALING_ROLES)[number];

/**
 * Signaling is control-plane only. The cap bounds pre-parse work for SDP and
 * ICE payloads; a real deployment would derive it from measured SDP sizes.
 */
export const MAX_SIGNALING_MESSAGE_BYTES = 64 * 1024;
export const MAX_SDP_LENGTH = 32 * 1024;
export const MAX_ICE_CANDIDATE_LENGTH = 2048;
export const MAX_PEERS_PER_ROOM = 5;
export const MAX_PEER_ID_LIST = MAX_PEERS_PER_ROOM - 1;

export type SignalDescription = {
  type: 'offer' | 'answer';
  sdp: string;
};

/** The three interoperable ICE candidate fields; nothing else is relayed. */
export type SignalCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

export type SignalingPeer = {
  peerId: string;
  role: SignalingRole;
};

/** Client-authored signaling messages understood by the room relay. */
export type SignalingClientMessage =
  | { version: typeof SIGNALING_PROTOCOL_VERSION; kind: 'join'; roomId: string; role: SignalingRole }
  | {
      version: typeof SIGNALING_PROTOCOL_VERSION;
      kind: 'signal';
      sequence: number;
      target: string;
      description?: SignalDescription;
      candidate?: SignalCandidate;
    };

/** Server-authored signaling messages. Peer IDs always come from the relay. */
export type SignalingServerMessage =
  | {
      version: typeof SIGNALING_PROTOCOL_VERSION;
      kind: 'joined';
      peerId: string;
      role: SignalingRole;
      peers: SignalingPeer[];
    }
  | { version: typeof SIGNALING_PROTOCOL_VERSION; kind: 'peer-joined'; peerId: string; role: SignalingRole }
  | { version: typeof SIGNALING_PROTOCOL_VERSION; kind: 'peer-left'; peerId: string }
  | {
      version: typeof SIGNALING_PROTOCOL_VERSION;
      kind: 'signal';
      from: string;
      description?: SignalDescription;
      candidate?: SignalCandidate;
    }
  | { version: typeof SIGNALING_PROTOCOL_VERSION; kind: 'error'; code: string; message: string };

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const ERROR_CODE = /^[a-z][a-z0-9-]{0,63}$/;

const own = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const isRole = (value: unknown): value is SignalingRole =>
  SIGNALING_ROLES.includes(value as SignalingRole);

function byteLength(input: string | Uint8Array): number {
  return typeof input === 'string' ? utf8.encode(input).byteLength : input.byteLength;
}

function decodeText(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    if (byteLength(input) > MAX_SIGNALING_MESSAGE_BYTES) throw new Error('Signaling message exceeds size limit');
    return input;
  }
  if (!(input instanceof Uint8Array)) throw new Error('Signaling message must be UTF-8 text or bytes');
  if (input.byteLength > MAX_SIGNALING_MESSAGE_BYTES) throw new Error('Signaling message exceeds size limit');
  try {
    return strictUtf8.decode(input);
  } catch {
    throw new Error('Signaling message is not valid UTF-8');
  }
}

function parseDescription(value: unknown): SignalDescription {
  if (!isRecord(value) || !exactKeys(value, ['type', 'sdp']) ||
      (value.type !== 'offer' && value.type !== 'answer') ||
      !boundedText(value.sdp, MAX_SDP_LENGTH)) {
    throw new Error('Malformed signaling description');
  }
  return { type: value.type, sdp: value.sdp };
}

function parseCandidate(value: unknown): SignalCandidate {
  if (!isRecord(value) || !exactKeys(value, ['candidate', 'sdpMid', 'sdpMLineIndex']) ||
      !boundedText(value.candidate, MAX_ICE_CANDIDATE_LENGTH)) {
    throw new Error('Malformed ICE candidate');
  }
  const sdpMid = value.sdpMid;
  if (sdpMid !== null && !boundedText(sdpMid, 256)) throw new Error('Malformed ICE candidate');
  const sdpMLineIndex = value.sdpMLineIndex;
  if (sdpMLineIndex !== null && (!nonnegative(sdpMLineIndex) || sdpMLineIndex > 255)) {
    throw new Error('Malformed ICE candidate');
  }
  return { candidate: value.candidate, sdpMid, sdpMLineIndex };
}

function parseSignalPayload(value: Record<string, unknown>): {
  description?: SignalDescription;
  candidate?: SignalCandidate;
} {
  const hasDescription = own(value, 'description');
  const hasCandidate = own(value, 'candidate');
  // Exactly one payload kind: an offer/answer or a single ICE candidate.
  if (hasDescription === hasCandidate) throw new Error('Malformed signaling payload');
  return hasDescription
    ? { description: parseDescription(value.description) }
    : { candidate: parseCandidate(value.candidate) };
}

function parseClientMessage(value: unknown): SignalingClientMessage {
  if (!isRecord(value) || value.version !== SIGNALING_PROTOCOL_VERSION || typeof value.kind !== 'string') {
    throw new Error('Unsupported signaling message');
  }
  if (value.kind === 'join') {
    if (!exactKeys(value, ['version', 'kind', 'roomId', 'role']) ||
        !isSessionIdentifier(value.roomId) || !isRole(value.role)) {
      throw new Error('Malformed signaling join');
    }
    return {
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'join',
      roomId: value.roomId,
      role: value.role,
    };
  }
  if (value.kind === 'signal') {
    if (!exactKeys(value, own(value, 'description')
      ? ['version', 'kind', 'sequence', 'target', 'description']
      : ['version', 'kind', 'sequence', 'target', 'candidate']) ||
        !nonnegative(value.sequence) || !boundedText(value.target, 64) ||
        !isSessionIdentifier(value.target)) {
      throw new Error('Malformed signaling message');
    }
    return {
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'signal',
      sequence: value.sequence,
      target: value.target,
      ...parseSignalPayload(value),
    };
  }
  throw new Error('Unknown signaling kind');
}

function parsePeer(value: unknown): SignalingPeer {
  if (!isRecord(value) || !exactKeys(value, ['peerId', 'role']) ||
      !isSessionIdentifier(value.peerId) || !isRole(value.role)) {
    throw new Error('Malformed signaling peer');
  }
  return { peerId: value.peerId, role: value.role };
}

function parseServerMessage(value: unknown): SignalingServerMessage {
  if (!isRecord(value) || value.version !== SIGNALING_PROTOCOL_VERSION || typeof value.kind !== 'string') {
    throw new Error('Unsupported signaling message');
  }
  switch (value.kind) {
    case 'joined': {
      if (!exactKeys(value, ['version', 'kind', 'peerId', 'role', 'peers']) ||
          !isSessionIdentifier(value.peerId) || !isRole(value.role) ||
          !Array.isArray(value.peers) || value.peers.length > MAX_PEER_ID_LIST) {
        throw new Error('Malformed signaling message');
      }
      const peers = value.peers.map(parsePeer);
      if (new Set(peers.map(peer => peer.peerId)).size !== peers.length ||
          peers.some(peer => peer.peerId === value.peerId)) {
        throw new Error('Malformed signaling message');
      }
      return {
        version: SIGNALING_PROTOCOL_VERSION,
        kind: 'joined',
        peerId: value.peerId,
        role: value.role,
        peers,
      };
    }
    case 'peer-joined': {
      if (!exactKeys(value, ['version', 'kind', 'peerId', 'role']) ||
          !isSessionIdentifier(value.peerId) || !isRole(value.role)) {
        throw new Error('Malformed signaling message');
      }
      return {
        version: SIGNALING_PROTOCOL_VERSION,
        kind: 'peer-joined',
        peerId: value.peerId,
        role: value.role,
      };
    }
    case 'peer-left':
      if (!exactKeys(value, ['version', 'kind', 'peerId']) || !isSessionIdentifier(value.peerId)) {
        throw new Error('Malformed signaling message');
      }
      return { version: SIGNALING_PROTOCOL_VERSION, kind: 'peer-left', peerId: value.peerId };
    case 'signal':
      if (!exactKeys(value, own(value, 'description')
        ? ['version', 'kind', 'from', 'description']
        : ['version', 'kind', 'from', 'candidate']) ||
          !isSessionIdentifier(value.from)) {
        throw new Error('Malformed signaling message');
      }
      return {
        version: SIGNALING_PROTOCOL_VERSION,
        kind: 'signal',
        from: value.from,
        ...parseSignalPayload(value),
      };
    case 'error':
      if (!exactKeys(value, ['version', 'kind', 'code', 'message']) ||
          !boundedText(value.code, 64) || !ERROR_CODE.test(value.code) ||
          !boundedText(value.message, 200)) {
        throw new Error('Malformed signaling message');
      }
      return {
        version: SIGNALING_PROTOCOL_VERSION,
        kind: 'error',
        code: value.code,
        message: value.message,
      };
    default:
      throw new Error('Unknown signaling kind');
  }
}

export function decodeClientSignalingMessage(input: string | Uint8Array): SignalingClientMessage {
  const text = decodeText(input);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Signaling message is not valid JSON');
  }
  return parseClientMessage(decoded);
}

export function encodeClientSignalingMessage(message: SignalingClientMessage): string {
  const json = JSON.stringify(parseClientMessage(message));
  if (byteLength(json) > MAX_SIGNALING_MESSAGE_BYTES) throw new Error('Signaling message exceeds size limit');
  return json;
}

export function decodeServerSignalingMessage(input: string | Uint8Array): SignalingServerMessage {
  const text = decodeText(input);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Signaling message is not valid JSON');
  }
  return parseServerMessage(decoded);
}

export function encodeServerSignalingMessage(message: SignalingServerMessage): string {
  const json = JSON.stringify(parseServerMessage(message));
  if (byteLength(json) > MAX_SIGNALING_MESSAGE_BYTES) throw new Error('Signaling message exceeds size limit');
  return json;
}
