import { createState, step, TICK_RATE } from '../../src/game/simulation/step';
import { MODE_IDS } from '../../src/game/simulation/modes';
import { MAX_PLAYERS } from '../../src/game/protocol/players';
import type { GameEvent, GameState, ModeId } from '../../src/game/simulation/types';
import { DEFAULT_MAX_INPUT_LEAD_TICKS } from '../../src/game/session/sessionInputBuffer';
import type { StateSnapshot } from '../../src/game/protocol/stateSnapshot';
import {
  isSessionIdentifier,
  parseClientEnvelopeHeader,
  type ClientEnvelopeHeader,
} from '../../src/game/session/sessionEnvelope';
import {
  SessionEnvelopeGateway,
  type SessionEnvelopeResult,
  type TrustedSessionBinding,
} from '../../src/game/session/sessionEnvelopeGateway';
import {
  SUPPORTED_SNAPSHOT_HZ,
  type SessionClosedReason,
  type SnapshotHz,
  type WsServerMessage,
} from '../../src/game/networking/wsMessages';

/**
 * Authoritative in-process session for the architecture-A WebSocket prototype.
 *
 * Transport-neutral on purpose: `server/ws/wsServer.ts` supplies a trusted
 * connection ID per socket and delivers bytes here. This file never imports a
 * socket library, so unit tests can inject an outgoing channel and drive ticks
 * manually.
 *
 * Prototype policy, deliberately narrower than the approved M2 contract:
 * - the match starts automatically once every configured slot is claimed
 *   (there is no host-only start envelope in the v1 client schema yet);
 * - the roster is frozen from `starting` onwards;
 * - a host disconnect terminates the session with `session-closed: host-lost`,
 *   never migrating host authority;
 * - `maxTicks` is a benchmark-only bound that stops the run explicitly.
 *
 * No client prediction, rollback, reconnect token, authentication or
 * production security is implemented here.
 */
export type WsSessionPhase = 'lobby' | 'starting' | 'running' | 'results' | 'closed';

export type WsSessionOptions = {
  roomId?: string;
  /** Simulation roster; the default is the historical P1..P4, up to MAX_PLAYERS. */
  playerIds?: readonly string[];
  /** Match rules chosen at creation. Defaults to Score Brawl. */
  mode?: ModeId;
  snapshotHz?: SnapshotHz;
  maxLead?: number;
  /** Benchmark-only bound. Stops after this many authoritative ticks. */
  maxTicks?: number;
  onOutgoing?: (targetConnectionId: string | null, message: WsServerMessage) => void;
  onPhaseChange?: (phase: WsSessionPhase) => void;
  /**
   * Benchmark-only observation of room-level denials that are decided before
   * the gateway sees the envelope (`session-closed`, `match-started`,
   * `match-complete`, `unknown-player`, `not-started`). Gateway-level denials are
   * returned from `handleMessage` instead. This hook cannot accept, rewrite or
   * reorder anything; it exists so a coordinator can audit every denial.
   */
  onRoomDenial?: (connectionId: string, code: string) => void;
};

export type WsStepResult = {
  readonly stepped: boolean;
  readonly tick: number;
  readonly snapshotSent: boolean;
  readonly complete: boolean;
};

export const DEFAULT_WS_ROOM_ID = 'ws-prototype';
export const DEFAULT_WS_PLAYER_IDS = ['P1', 'P2', 'P3', 'P4'] as const;

const cloneState = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;

/**
 * The session's `snapshot()` is the wire value. Last Man Standing stores
 * `eliminated: false` internally, but the canonical protocol form omits the
 * alive marker, so the snapshot is normalised before it is encoded.
 */
const wireState = (state: GameState): GameState => {
  const clone = cloneState(state);
  if (clone.mode === 'last-man-standing') {
    for (const fighter of clone.fighters) {
      if (fighter.eliminated === false) delete fighter.eliminated;
    }
  }
  return clone;
};

export class AuthoritativeWsSession {
  private readonly gateway: SessionEnvelopeGateway;
  private readonly roomId: string;
  private readonly playerIds: readonly string[];
  private readonly playerIdSet: ReadonlySet<string>;
  private readonly mode: ModeId;
  private readonly snapshotInterval: number;
  private readonly snapshotHz: SnapshotHz;
  private readonly maxLead: number;
  private readonly maxTicks: number | null;
  private readonly onOutgoing: (targetConnectionId: string | null, message: WsServerMessage) => void;
  private readonly onPhaseChange: (phase: WsSessionPhase) => void;
  private readonly onRoomDenial: (connectionId: string, code: string) => void;

  private readonly connections = new Set<string>();
  private readonly ownership = new Map<string, string[]>();
  private readonly eventLog: GameEvent[] = [];
  private state: GameState;
  private phaseValue: WsSessionPhase = 'lobby';
  private host: string | null = null;
  private runComplete = false;

  constructor(options: WsSessionOptions = {}) {
    const roomId = options.roomId ?? DEFAULT_WS_ROOM_ID;
    if (!isSessionIdentifier(roomId)) throw new Error('Invalid room binding');
    const playerIds = options.playerIds ?? DEFAULT_WS_PLAYER_IDS;
    if (!Array.isArray(playerIds) || playerIds.length < 1 || playerIds.length > MAX_PLAYERS ||
        new Set(playerIds).size !== playerIds.length || !playerIds.every(isSessionIdentifier)) {
      throw new Error('Invalid session roster');
    }
    const snapshotHz = options.snapshotHz ?? 20;
    if (!SUPPORTED_SNAPSHOT_HZ.includes(snapshotHz)) throw new Error('Unsupported snapshot rate');
    const mode = options.mode ?? 'score-brawl';
    if (!MODE_IDS.includes(mode)) throw new Error(`Unsupported match mode: ${String(options.mode)}`);
    if (!Number.isSafeInteger(TICK_RATE) || TICK_RATE % snapshotHz !== 0) {
      throw new Error('Snapshot rate must divide the simulation tick rate');
    }
    if (options.maxTicks !== undefined &&
        (!Number.isSafeInteger(options.maxTicks) || options.maxTicks < 1 || options.maxTicks > 7200)) {
      throw new Error('Invalid bounded tick count');
    }

    this.roomId = roomId;
    this.playerIds = [...playerIds];
    this.playerIdSet = new Set(playerIds);
    this.mode = mode;
    this.snapshotHz = snapshotHz;
    this.snapshotInterval = TICK_RATE / snapshotHz;
    this.maxLead = options.maxLead ?? DEFAULT_MAX_INPUT_LEAD_TICKS;
    this.maxTicks = options.maxTicks ?? null;
    this.onOutgoing = options.onOutgoing ?? (() => undefined);
    this.onPhaseChange = options.onPhaseChange ?? (() => undefined);
    this.onRoomDenial = options.onRoomDenial ?? (() => undefined);
    this.gateway = new SessionEnvelopeGateway({
      roomId,
      ...(options.maxLead === undefined ? {} : { maxLead: options.maxLead }),
      maxPlayers: this.playerIds.length,
    });
    // The prototype begins in `fighting` like the deterministic benchmark
    // adapter; no gameplay rule or timing constant is changed. Score Brawl
    // still omits `mode` from the state, so its wire bytes stay identical.
    this.state = createState({ ids: [...this.playerIds], phase: 'fighting', mode });
  }

  get roomIdValue(): string { return this.roomId; }
  get modeValue(): ModeId { return this.mode; }
  get phase(): WsSessionPhase { return this.phaseValue; }
  get tick(): number { return this.state.tick; }
  get snapshotRate(): SnapshotHz { return this.snapshotHz; }
  get maxLeadTicks(): number { return this.maxLead; }
  get hostConnectionId(): string | null { return this.host; }
  get playerCount(): number { return this.gateway.playerCount; }
  get bufferedTicks(): number { return this.gateway.bufferedTicks; }
  get connectionCount(): number { return this.connections.size; }
  get isRunComplete(): boolean { return this.runComplete; }
  get configuredPlayerIds(): readonly string[] { return [...this.playerIds]; }

  isJoined(connectionId: string): boolean {
    return this.ownership.has(connectionId);
  }

  /** Registers transport-accepted socket identity. The client never supplies this ID. */
  addConnection(connectionId: string): void {
    if (!isSessionIdentifier(connectionId)) throw new Error('Invalid trusted connection ID');
    if (this.connections.has(connectionId)) throw new Error('Connection already registered');
    if (this.phaseValue === 'closed') throw new Error('Session is closed');
    this.connections.add(connectionId);
    this.emit(connectionId, {
      version: 1,
      kind: 'welcome',
      connectionId,
      roomId: this.roomId,
    });
  }

  /** Handles one client envelope from a trusted, already-registered socket. */
  handleMessage(connectionId: string, data: string | Uint8Array): SessionEnvelopeResult | null {
    if (!this.connections.has(connectionId)) return null;

    let header: ClientEnvelopeHeader | null = null;
    try {
      header = parseClientEnvelopeHeader(data);
    } catch {
      // The gateway produces the authoritative denial with a stable code.
    }

    if (this.phaseValue === 'closed') {
      return this.denyRoom(connectionId, 'session-closed', 'Session is closed', header);
    }

    if (header?.kind === 'join-request') {
      if (this.phaseValue !== 'lobby') {
        return this.denyRoom(
          connectionId,
          this.phaseValue === 'results' ? 'match-complete' : 'match-started',
          'Roster is frozen after the match has started',
          header,
        );
      }
      // A configured session never accepts an arbitrary slot name.
      if ((header.playerIds ?? []).some(playerId => !this.playerIdSet.has(playerId))) {
        return this.denyRoom(
          connectionId,
          'unknown-player',
          'Join claims a player outside the configured roster',
          header,
        );
      }
    }

    if (header?.kind === 'input' && this.phaseValue !== 'running') {
      return this.denyRoom(
        connectionId,
        this.phaseValue === 'results' ? 'match-complete' : 'not-started',
        'Authoritative match has not started',
        header,
      );
    }

    const result = this.gateway.handle(this.binding(connectionId), data);
    if (!result.accepted) {
      this.emitError(connectionId, result.code, result.message, header);
      return result;
    }

    if (header?.kind === 'join-request') {
      const slots = result.envelope.kind === 'join-request' ? [...result.envelope.playerIds] : [];
      this.ownership.set(connectionId, slots);
      if (this.host === null) this.host = connectionId;
      this.emit(connectionId, { version: 1, kind: 'join-result', accepted: true, playerIds: slots });
      this.emitRoster();
      if (this.phaseValue === 'lobby' && this.gateway.playerCount === this.playerIds.length) {
        this.setPhase('starting');
      }
      return result;
    }

    if (header?.kind === 'leave-request') {
      this.ownership.delete(connectionId);
      if (connectionId === this.host) {
        // Host authority is revoked, never migrated. Terminating the session is
        // the documented lifecycle outcome for this prototype.
        this.close('host-lost');
      } else {
        // An incomplete frozen roster cannot start; return to lobby rather than
        // leaving the session stuck in `starting`.
        if (this.phaseValue === 'starting' && this.gateway.playerCount < this.playerIds.length) {
          this.setPhase('lobby');
        }
        this.emitRoster();
      }
      return result;
    }

    if (header?.kind === 'ping') {
      this.emit(connectionId, { version: 1, kind: 'pong', sequence: header.sequence });
      return result;
    }

    // Accepted input needs no direct acknowledgement; it is consumed on tick.
    return result;
  }

  /**
   * Transport calls this once the start delay has elapsed. Returns false when
   * the roster is not full or the session is not in `starting`.
   */
  beginMatch(): boolean {
    if (this.phaseValue !== 'starting' || this.gateway.playerCount !== this.playerIds.length) return false;
    this.setPhase('running');
    this.emit(null, {
      version: 1,
      kind: 'match-start',
      startTick: this.gateway.nextTick,
      tickRate: TICK_RATE,
      snapshotHz: this.snapshotHz,
    });
    return true;
  }

  /** Advances exactly one authoritative tick; no-op outside `running`. */
  stepOnce(): WsStepResult {
    if (this.phaseValue !== 'running' || this.runComplete) {
      return { stepped: false, tick: this.state.tick, snapshotSent: false, complete: this.runComplete };
    }
    const frame = this.gateway.consume();
    this.state = step(this.state, frame.inputs);
    this.eventLog.push(...this.state.events);

    let snapshotSent = false;
    if (this.state.tick % this.snapshotInterval === 0) {
      this.emitSnapshot();
      snapshotSent = true;
    }

    if (this.state.phase === 'results') {
      if (!snapshotSent) {
        this.emitSnapshot();
        snapshotSent = true;
      }
      this.setPhase('results');
      this.emit(null, { version: 1, kind: 'match-end', tick: this.state.tick });
    }

    if (this.maxTicks !== null && this.state.tick >= this.maxTicks) {
      if (!snapshotSent) {
        this.emitSnapshot();
        snapshotSent = true;
      }
      this.runComplete = true;
      this.emit(null, { version: 1, kind: 'run-complete', tick: this.state.tick, reason: 'bounded' });
    }

    return { stepped: true, tick: this.state.tick, snapshotSent, complete: this.runComplete };
  }

  /** Trusted socket close. Revokes slots, queued input and the sequence domain. */
  disconnect(connectionId: string): string[] {
    if (!this.connections.delete(connectionId)) return [];
    const revoked = this.gateway.disconnect(connectionId);
    this.ownership.delete(connectionId);
    if (connectionId === this.host) {
      this.close('host-lost');
      return revoked;
    }
    // An incomplete frozen roster cannot start; return to lobby rather than
    // leaving the session stuck in `starting`.
    if (this.phaseValue === 'starting' && this.gateway.playerCount < this.playerIds.length) {
      this.setPhase('lobby');
    }
    if (this.phaseValue !== 'closed') this.emitRoster();
    return revoked;
  }

  /** Terminates the session and revokes every remaining slot. No host migration. */
  close(reason: SessionClosedReason): void {
    if (this.phaseValue === 'closed') return;
    for (const connectionId of [...this.connections]) this.gateway.disconnect(connectionId);
    this.connections.clear();
    this.ownership.clear();
    this.phaseValue = 'closed';
    this.emit(null, { version: 1, kind: 'session-closed', reason });
    this.onPhaseChange('closed');
  }

  snapshot(): StateSnapshot {
    return { version: 1, state: wireState(this.state) };
  }

  orderedEvents(): GameEvent[] {
    return this.eventLog.map(event => ({ ...event }));
  }

  private binding(connectionId: string): TrustedSessionBinding {
    return { connectionId, roomId: this.roomId };
  }

  private emitSnapshot(): void {
    this.emit(null, { version: 1, kind: 'snapshot', snapshot: this.snapshot() });
  }

  private emitRoster(): void {
    const owned = new Set([...this.ownership.values()].flat());
    this.emit(null, {
      version: 1,
      kind: 'roster',
      playerIds: this.playerIds.filter(playerId => owned.has(playerId)),
    });
  }

  private emitError(
    connectionId: string,
    code: string,
    message: string,
    header: ClientEnvelopeHeader | null,
  ): void {
    this.emit(connectionId, {
      version: 1,
      kind: 'error',
      code,
      message: message.slice(0, 200),
      ...(header?.targetTick === undefined ? {} : { targetTick: header.targetTick }),
    });
  }

  private emit(targetConnectionId: string | null, message: WsServerMessage): void {
    this.onOutgoing(targetConnectionId, message);
  }

  /**
   * Emits a room-level denial and reports it to the benchmark observer. The
   * client-visible error message and the `null` return are unchanged; the
   * observer runs afterwards and can never alter the decision.
   */
  private denyRoom(
    connectionId: string,
    code: string,
    message: string,
    header: ClientEnvelopeHeader | null,
  ): null {
    this.emitError(connectionId, code, message, header);
    try {
      this.onRoomDenial(connectionId, code);
    } catch {
      // Observation must never affect authority.
    }
    return null;
  }

  private setPhase(phase: WsSessionPhase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    this.onPhaseChange(phase);
  }
}
