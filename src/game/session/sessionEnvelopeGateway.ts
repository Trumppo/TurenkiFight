import type { InputFrame } from '../protocol/inputFrame';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { consumeAuthorizedFrame } from './protocolIntegration';
import {
  SessionEnvelopeError,
  decodeClientEnvelope,
  isSessionIdentifier,
  parseClientEnvelopeHeader,
  type ClientEnvelopeHeader,
  type ClientSessionEnvelope,
  type SessionEnvelopeErrorCode,
} from './sessionEnvelope';

/**
 * Trusted context supplied by a transport adapter from connection state.
 * Neither value is ever read from client JSON.
 */
export type TrustedSessionBinding = {
  readonly connectionId: string;
  readonly roomId: string;
};

export type SessionEnvelopeDenialCode =
  | SessionEnvelopeErrorCode
  | 'invalid-binding'
  | 'room-mismatch'
  | 'not-joined'
  | 'already-joined'
  | 'replayed-sequence'
  | 'sequence-exhausted'
  | 'late-tick'
  | 'future-tick'
  | 'tick-out-of-window'
  | 'tick-exhausted'
  | 'unauthorized-player'
  | 'duplicate-input'
  | 'player-owned'
  | 'session-full'
  | 'tick-roster-full'
  | 'invalid-state';

export type SessionEnvelopeAccepted = {
  accepted: true;
  envelope: ClientSessionEnvelope;
};

export type SessionEnvelopeDenied = {
  accepted: false;
  code: SessionEnvelopeDenialCode;
  message: string;
};

export type SessionEnvelopeResult = SessionEnvelopeAccepted | SessionEnvelopeDenied;

export type SessionEnvelopeGatewayOptions = {
  /** Room/session binding for this gateway; client payloads cannot select it. */
  roomId: string;
  startTick?: number;
  maxLead?: number;
  maxPlayers?: number;
};

const accepted = (envelope: ClientSessionEnvelope): SessionEnvelopeAccepted => ({ accepted: true, envelope });
const denied = (code: SessionEnvelopeDenialCode, message: string): SessionEnvelopeDenied => ({ accepted: false, code, message });

function classifyStateError(message: string): SessionEnvelopeDenialCode {
  if (/Session full/.test(message)) return 'session-full';
  if (/Tick roster full/.test(message)) return 'tick-roster-full';
  if (/Player slot already owned/.test(message)) return 'player-owned';
  if (/Unauthorized player input/.test(message)) return 'unauthorized-player';
  if (/Duplicate player input/.test(message)) return 'duplicate-input';
  if (/Replayed input sequence/.test(message)) return 'replayed-sequence';
  if (/Stale, future or malformed input/.test(message)) return 'tick-out-of-window';
  if (/Sequence counter exhausted/.test(message)) return 'sequence-exhausted';
  if (/Tick counter exhausted/.test(message)) return 'tick-exhausted';
  if (/Malformed player/.test(message)) return 'malformed-input';
  if (/Invalid player slots|Duplicate player slot|Invalid session identifier/.test(message)) return 'invalid-envelope';
  return 'invalid-state';
}

/**
 * Transport-neutral adapter boundary for one session room.
 *
 * The adapter calls `handle` with bytes and trusted connection/room context.
 * Player IDs in a join or input payload are only claims: joins may acquire free
 * slots, and input is accepted only for slots already owned by that connection.
 * Every denial is returned before state mutation; callers fail closed.
 *
 * No socket, WebSocket or WebRTC code lives here. Transport selection remains a
 * separate decision.
 */
export class SessionEnvelopeGateway {
  private readonly roomId: string;
  private readonly ingress: AuthorizedSessionIngress;
  private readonly sequences = new Map<string, number>();

  constructor(options: SessionEnvelopeGatewayOptions) {
    if (!isSessionIdentifier(options?.roomId)) throw new Error('Invalid room binding');
    this.roomId = options.roomId;
    // Undefined optional values keep the existing session defaults (tick 0,
    // bounded look-ahead, MAX_PLAYERS slots) instead of inventing new timings.
    this.ingress = new AuthorizedSessionIngress(options.startTick, options.maxLead, options.maxPlayers);
  }

  handle(binding: TrustedSessionBinding, message: string | Uint8Array): SessionEnvelopeResult {
    try {
      return this.handleTrusted(binding, message);
    } catch (error) {
      if (error instanceof SessionEnvelopeError) return denied(error.code, error.message);
      if (error instanceof Error) return denied(classifyStateError(error.message), error.message);
      throw error;
    }
  }

  /** Trusted disconnect revokes slots, queued input and the sequence domain. */
  disconnect(connectionId: string): string[] {
    const revoked = this.ingress.disconnect(connectionId);
    this.sequences.delete(connectionId);
    return revoked;
  }

  /**
   * Drops input queued for ticks that will never run (for example ahead of a
   * finished match) without revoking slots or per-connection sequences.
   */
  discardPendingInputs(): void {
    this.ingress.discardPending();
  }

  /** Consumes the next authoritative frame; missing players stay neutral. */
  consume(): InputFrame {
    return consumeAuthorizedFrame(this.ingress);
  }

  isJoined(connectionId: string): boolean {
    return this.ingress.hasConnection(connectionId);
  }

  sequenceOf(connectionId: string): number | undefined {
    return this.sequences.get(connectionId);
  }

  get room(): string {
    return this.roomId;
  }

  get nextTick(): number {
    return this.ingress.nextTick;
  }

  get playerCount(): number {
    return this.ingress.playerCount;
  }

  get bufferedTicks(): number {
    return this.ingress.bufferedTicks;
  }

  get playerCapacity(): number {
    return this.ingress.playerCapacity;
  }

  private handleTrusted(binding: TrustedSessionBinding, message: string | Uint8Array): SessionEnvelopeResult {
    if (!binding || !isSessionIdentifier(binding.connectionId) || !isSessionIdentifier(binding.roomId)) {
      return denied('invalid-binding', 'Trusted connection binding required');
    }
    // Cross-room traffic is denied from trusted context, not from client JSON.
    if (binding.roomId !== this.roomId) return denied('room-mismatch', 'Connection is bound to another room');
    const connectionId = binding.connectionId;

    const header = parseClientEnvelopeHeader(message);
    // A diagnostic room claim must agree with the trusted binding.
    if (header.roomId !== undefined && header.roomId !== this.roomId) {
      return denied('room-mismatch', 'Envelope room does not match the connection binding');
    }

    if (header.kind === 'join-request') return this.handleJoin(connectionId, message, header);
    if (!this.ingress.hasConnection(connectionId)) return denied('not-joined', 'Connection has no authorized slots');

    const sequenceDenial = this.checkSequence(connectionId, header.sequence);
    if (sequenceDenial) return sequenceDenial;

    switch (header.kind) {
      case 'input':
        return this.handleInput(connectionId, message, header);
      case 'leave-request': {
        const envelope = decodeClientEnvelope(message, header);
        this.ingress.disconnect(connectionId);
        this.sequences.delete(connectionId);
        return accepted(envelope);
      }
      case 'ping': {
        const envelope = decodeClientEnvelope(message, header);
        this.sequences.set(connectionId, header.sequence);
        return accepted(envelope);
      }
      case 'rematch': {
        // The room decides phase and roster eligibility; the gateway only
        // authenticates the envelope and advances the sequence domain.
        const envelope = decodeClientEnvelope(message, header);
        this.sequences.set(connectionId, header.sequence);
        return accepted(envelope);
      }
    }
  }

  private handleJoin(
    connectionId: string,
    message: string | Uint8Array,
    header: ClientEnvelopeHeader,
  ): SessionEnvelopeResult {
    if (this.ingress.hasConnection(connectionId)) return denied('already-joined', 'Connection already joined');
    const sequenceDenial = this.checkSequence(connectionId, header.sequence);
    if (sequenceDenial) return sequenceDenial;
    const envelope = decodeClientEnvelope(message, header);
    if (envelope.kind !== 'join-request') return denied('invalid-state', 'Join envelope expected');
    this.ingress.joinMany(connectionId, envelope.playerIds);
    this.sequences.set(connectionId, header.sequence);
    return accepted(envelope);
  }

  private handleInput(
    connectionId: string,
    message: string | Uint8Array,
    header: ClientEnvelopeHeader,
  ): SessionEnvelopeResult {
    const targetTick = header.targetTick as number;
    // A target at the terminal safe integer can never be consumed; request a reset.
    if (targetTick >= Number.MAX_SAFE_INTEGER) return denied('tick-exhausted', 'Tick exhausted; session reset required');
    // Bounds come from the existing session buffer window, never a new timing.
    if (targetTick < this.ingress.nextTick) return denied('late-tick', 'Input target tick has already been consumed');
    if (targetTick - this.ingress.nextTick > this.ingress.maxLeadTicks) {
      return denied('future-tick', 'Input target tick is outside the bounded look-ahead window');
    }
    const envelope = decodeClientEnvelope(message, header);
    if (envelope.kind !== 'input') return denied('invalid-state', 'Input envelope expected');
    // A payload playerId is only a claim; every slot must already be owned.
    for (const input of envelope.frame.inputs) {
      if (!this.ingress.owns(connectionId, input.playerId)) {
        return denied('unauthorized-player', 'Connection does not own a claimed player slot');
      }
    }
    this.ingress.submitFrame(connectionId, header.sequence, targetTick, envelope.frame.inputs);
    this.sequences.set(connectionId, header.sequence);
    return accepted(envelope);
  }

  private checkSequence(connectionId: string, sequence: number): SessionEnvelopeDenied | null {
    // Accepting MAX_SAFE_INTEGER would leave no representable successor.
    if (sequence >= Number.MAX_SAFE_INTEGER) return denied('sequence-exhausted', 'Sequence exhausted; session reset required');
    const previous = this.sequences.get(connectionId);
    if (previous !== undefined && sequence <= previous) return denied('replayed-sequence', 'Replayed or stale sequence');
    return null;
  }
}
