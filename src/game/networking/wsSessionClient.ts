import type { PlayerInput } from '../simulation/types';
import { MAX_PLAYERS_PER_FRAME } from '../protocol/inputFrame';
import type { StateSnapshot } from '../protocol/stateSnapshot';
import {
  encodeClientEnvelope,
  type ClientSessionEnvelope,
  type InputEnvelope,
} from '../session/sessionEnvelope';
import {
  decodeWsServerMessage,
  type SessionClosedReason,
  type SnapshotHz,
  type WsMatchResult,
  type WsServerMessage,
} from './wsMessages';

/**
 * Transport-injected client core shared by the Node benchmark driver and the
 * browser adapter. It never imports `ws`: callers attach a `send` function and
 * feed inbound text/bytes into `receive`.
 *
 * The client is not an authority. Sequence numbers only order this connection's
 * own messages; the server still validates ownership, ticks and duplicates.
 */
export type SessionClientHandlers = {
  onWelcome?: (info: { connectionId: string; roomId: string }) => void;
  onJoinResult?: (info: { accepted: boolean; playerIds: readonly string[]; code?: string }) => void;
  onRoster?: (playerIds: readonly string[]) => void;
  onMatchStart?: (info: {
    startTick: number;
    tickRate: number;
    snapshotHz: SnapshotHz;
    /** Monotonic across rematches; undefined for the legacy server shape. */
    matchId?: number;
  }) => void;
  onSnapshot?: (snapshot: StateSnapshot) => void;
  onError?: (error: { code: string; message: string; targetTick?: number }) => void;
  onPong?: (sequence: number) => void;
  /** `result` is the server-authored ranking; absent on the legacy message. */
  onMatchEnd?: (tick: number, result?: WsMatchResult) => void;
  onRunComplete?: (tick: number) => void;
  onSessionClosed?: (reason: SessionClosedReason) => void;
  /** Malformed server bytes are ignored without mutating client state. */
  onProtocolError?: (message: string) => void;
  onTransportClosed?: () => void;
  onTransportError?: (message: string) => void;
};

export type ClientSessionState = 'idle' | 'joined' | 'closed';

export class SessionClientCore {
  private readonly handlers: SessionClientHandlers;
  private transport: ((data: string) => void) | null = null;
  private sequence = 0;
  private state: ClientSessionState = 'idle';
  private owned: readonly string[] = [];
  private snapshot: StateSnapshot | null = null;
  private lastStartTick = 0;
  private startInfo: { startTick: number; tickRate: number; snapshotHz: SnapshotHz; matchId?: number } | null = null;
  private connection: string | null = null;
  private matchIdValue: number | null = null;
  private resultValue: WsMatchResult | null = null;

  constructor(handlers: SessionClientHandlers = {}) {
    this.handlers = handlers;
  }

  attachTransport(send: (data: string) => void): void {
    if (this.transport) throw new Error('Client transport already attached');
    this.transport = send;
  }

  get connectionId(): string | null { return this.connection; }
  get sessionState(): ClientSessionState { return this.state; }
  get ownedPlayerIds(): readonly string[] { return this.owned; }
  get lastSnapshot(): StateSnapshot | null { return this.snapshot; }
  /** Last authoritative tick announced by match-start or a snapshot. */
  get serverTick(): number { return this.snapshot?.state.tick ?? this.lastStartTick; }
  get matchStart(): { startTick: number; tickRate: number; snapshotHz: SnapshotHz; matchId?: number } | null {
    return this.startInfo;
  }
  /** Latest server-announced match identifier, null before the first match. */
  get matchId(): number | null { return this.matchIdValue; }
  /** Server-authored result of the last finished match, null until `match-end`. */
  get matchResult(): WsMatchResult | null { return this.resultValue; }

  join(playerIds: readonly string[]): number {
    if (!Array.isArray(playerIds) || playerIds.length < 1 || playerIds.length > MAX_PLAYERS_PER_FRAME) {
      throw new Error(`Join requires 1..${MAX_PLAYERS_PER_FRAME} player slots`);
    }
    if (this.state === 'closed') throw new Error('Session is closed');
    return this.send({
      version: 1,
      kind: 'join-request',
      sequence: this.nextSequence(),
      playerIds: [...playerIds],
    });
  }

  leave(): number {
    return this.send({ version: 1, kind: 'leave-request', sequence: this.nextSequence() });
  }

  ping(): number {
    return this.send({ version: 1, kind: 'ping', sequence: this.nextSequence() });
  }

  /** Asks the server for another match with the same roster. Server decides. */
  rematch(): number {
    if (this.state !== 'joined') throw new Error('Rematch requires an accepted join');
    return this.send({ version: 1, kind: 'rematch', sequence: this.nextSequence() });
  }

  submitInput(tick: number, inputs: readonly PlayerInput[]): number {
    if (this.state !== 'joined') throw new Error('Input requires an accepted join');
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid target tick');
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_PLAYERS_PER_FRAME) {
      throw new Error(`Input requires 1..${MAX_PLAYERS_PER_FRAME} player slots`);
    }
    for (const input of inputs) {
      if (!this.owned.includes(input.playerId)) throw new Error('Input claims an unowned player slot');
    }
    const envelope: InputEnvelope = {
      version: 1,
      kind: 'input',
      sequence: this.nextSequence(),
      targetTick: tick,
      frame: { version: 1, tick, inputs: inputs.map(input => ({ ...input })) },
    };
    return this.send(envelope);
  }

  /** Feeds one server message without requiring a real socket. */
  receive(data: string | Uint8Array): void {
    let message: WsServerMessage;
    try {
      message = decodeWsServerMessage(data);
    } catch (error) {
      this.handlers.onProtocolError?.(error instanceof Error ? error.message : 'Malformed server message');
      return;
    }
    switch (message.kind) {
      case 'welcome':
        this.connection = message.connectionId;
        this.handlers.onWelcome?.({ connectionId: message.connectionId, roomId: message.roomId });
        return;
      case 'join-result':
        this.state = message.accepted ? 'joined' : 'idle';
        this.owned = message.accepted ? [...message.playerIds] : [];
        this.handlers.onJoinResult?.({
          accepted: message.accepted,
          playerIds: [...message.playerIds],
          ...(message.code === undefined ? {} : { code: message.code }),
        });
        return;
      case 'roster':
        this.handlers.onRoster?.([...message.playerIds]);
        return;
      case 'match-start': {
        const previousMatchId = this.matchIdValue;
        if (message.matchId !== undefined) {
          // A new match identifier invalidates the previous match's last state;
          // callers can now drop their interpolation history deterministically.
          if (previousMatchId !== null && message.matchId !== previousMatchId) this.snapshot = null;
          this.matchIdValue = message.matchId;
        }
        this.lastStartTick = message.startTick;
        this.startInfo = {
          startTick: message.startTick,
          tickRate: message.tickRate,
          snapshotHz: message.snapshotHz,
          ...(message.matchId === undefined ? {} : { matchId: message.matchId }),
        };
        this.handlers.onMatchStart?.({ ...this.startInfo });
        return;
      }
      case 'snapshot':
        this.snapshot = message.snapshot;
        this.handlers.onSnapshot?.(message.snapshot);
        return;
      case 'error':
        this.handlers.onError?.({
          code: message.code,
          message: message.message,
          ...(message.targetTick === undefined ? {} : { targetTick: message.targetTick }),
        });
        return;
      case 'pong':
        this.handlers.onPong?.(message.sequence);
        return;
      case 'match-end':
        this.resultValue = message.result ?? null;
        this.handlers.onMatchEnd?.(message.tick, message.result);
        return;
      case 'run-complete':
        this.handlers.onRunComplete?.(message.tick);
        return;
      case 'session-closed':
        this.state = 'closed';
        this.owned = [];
        this.handlers.onSessionClosed?.(message.reason);
        return;
    }
  }

  /** Trusted transport closure: revoke the local view without inventing authority. */
  markTransportClosed(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.owned = [];
    this.handlers.onTransportClosed?.();
  }

  markTransportError(message: string): void {
    this.handlers.onTransportError?.(message);
  }

  private nextSequence(): number {
    // The gateway rejects MAX_SAFE_INTEGER and any non-monotonic sequence; a
    // prototype session is bounded well below that limit.
    if (this.sequence >= Number.MAX_SAFE_INTEGER - 1) throw new Error('Client sequence exhausted');
    this.sequence += 1;
    return this.sequence;
  }

  private send(envelope: ClientSessionEnvelope): number {
    if (!this.transport) throw new Error('Client transport is not attached');
    this.transport(encodeClientEnvelope(envelope));
    return envelope.sequence;
  }
}
