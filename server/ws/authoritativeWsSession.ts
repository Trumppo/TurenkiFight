import { createState, step, TICK_RATE } from '../../src/game/simulation/step';
import { MODE_IDS } from '../../src/game/simulation/modes';
import { botInput } from '../../src/game/input/botPolicy';
import { MAX_PLAYERS } from '../../src/game/protocol/players';
import type { GameEvent, GameState, ModeId, PlayerInput, Team } from '../../src/game/simulation/types';
import { DEFAULT_MAX_INPUT_LEAD_TICKS } from '../../src/game/session/sessionInputBuffer';
import type { StateSnapshot } from '../../src/game/protocol/stateSnapshot';
import {
  isRoomCode,
  isSessionIdentifier,
  normalizeRoomCode,
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
import { computeMatchResult } from './matchResult';

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
 *   (there is no host-only start envelope in the v1 client schema yet; wave:
 *   as soon as at least one human is present and at least one slot is
 *   unclaimed, with the unclaimed slots filled by seeded bot enemies);
 * - the roster is frozen from `starting` onwards (wave: from `running` onwards,
 *   so additional humans can join the short lobby window);
 * - a host disconnect terminates the session with `session-closed: host-lost`,
 *   never migrating host authority;
 * - a non-host disconnect during `running` keeps that player's slot reserved
 *   for the configured rejoin window (the operator-facing WebSocket transport
 *   defaults to {@link DEFAULT_REJOIN_WINDOW_MS}); a new connection with the
 *   same room code and player id may reattach, and an expired reservation
 *   releases the slot without stopping the match;
 * - `maxTicks` is a benchmark-only bound that stops the run explicitly.
 *
 * Rejoin is not host migration and not authentication: the server stays
 * authoritative and any peer that knows the room code and player id can
 * reclaim a reserved slot.
 *
 * No client prediction, rollback, reconnect token, authentication or
 * production security is implemented here.
 */
export type WsSessionPhase = 'lobby' | 'starting' | 'running' | 'results' | 'closed';

/** Slots stay reserved this long after a mid-match drop by default. */
export const DEFAULT_REJOIN_WINDOW_MS = 30_000;
/** Upper bound so a misconfiguration cannot pin a slot indefinitely. */
export const MAX_REJOIN_WINDOW_MS = 10 * 60_000;
/**
 * Fixed seed for the deterministic enemy bots in a wave match. The same roster,
 * seed and accepted human inputs therefore produce the same wave outcomes.
 */
export const DEFAULT_WAVE_BOT_SEED = 20261107;

/**
 * Why a match cannot start. `roster-incomplete` is the historical free-for-all
 * rule; the wave reasons are eligibility failures specific to the co-op mode.
 */
export type MatchStartRefusalReason =
  | 'roster-incomplete'
  | 'wave-needs-humans'
  | 'wave-needs-enemies';

type RejoinReservation = {
  /** Trusted connection that dropped; its sequence domain is already revoked. */
  readonly connectionId: string;
  readonly playerIds: readonly string[];
  /** Monotonic clock value at which the slot is released. */
  readonly expiresAt: number;
};

export type WsSessionOptions = {
  roomId?: string;
  /**
   * Optional admission code. When set, a join (including a rejoin) must carry
   * the matching code or it is denied before a slot is allocated.
   */
  roomCode?: string;
  /**
   * How long a non-host player's slot stays reserved after a mid-match drop.
   * This low-level session defaults to `0` (immediate revocation); the
   * operator-facing WebSocket transport supplies `DEFAULT_REJOIN_WINDOW_MS`.
   */
  rejoinWindowMs?: number;
  /** Clock used only for reservation expiry; injectable for deterministic tests. */
  now?: () => number;
  /** Simulation roster; the default is the historical P1..P4, up to MAX_PLAYERS. */
  playerIds?: readonly string[];
  /** Match rules chosen at creation. Defaults to Score Brawl. */
  mode?: ModeId;
  snapshotHz?: SnapshotHz;
  maxLead?: number;
  /** Benchmark-only bound. Stops after this many authoritative ticks. */
  maxTicks?: number;
  /**
   * Opt-in repeatable session. When false (the default), a `rematch` is denied
   * with `rematch-disabled` and the historical one-match lifecycle is intact.
   */
  allowRematch?: boolean;
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
  private readonly roomCode: string | null;
  private readonly playerIds: readonly string[];
  private readonly playerIdSet: ReadonlySet<string>;
  private readonly mode: ModeId;
  private readonly snapshotInterval: number;
  private readonly snapshotHz: SnapshotHz;
  private readonly maxLead: number;
  private readonly maxTicks: number | null;
  private readonly allowRematch: boolean;
  private readonly rejoinWindowMs: number;
  private readonly clock: () => number;
  private readonly onOutgoing: (targetConnectionId: string | null, message: WsServerMessage) => void;
  private readonly onPhaseChange: (phase: WsSessionPhase) => void;
  private readonly onRoomDenial: (connectionId: string, code: string) => void;

  private readonly connections = new Set<string>();
  private readonly ownership = new Map<string, string[]>();
  private readonly reservations = new Map<string, RejoinReservation>();
  private readonly readys = new Set<string>(); // ready connections for room contract (Gate D)
  private readonly eventLog: GameEvent[] = [];
  private state: GameState;
  /** Team split frozen when a wave match starts; null for every other mode. */
  private waveTeams: Readonly<Record<string, Team>> | null = null;
  private phaseValue: WsSessionPhase = 'lobby';
  private host: string | null = null;
  private runComplete = false;
  /** Monotonic across matches in this process; echoed by `match-start`. */
  private matchId = 1;
  /** Start tick of the current match, replayed to a rejoining connection. */
  private matchStartTick = 0;
  /** True between an accepted rematch and the first tick of the new match. */
  private rematchInProgress = false;

  constructor(options: WsSessionOptions = {}) {
    const roomId = options.roomId ?? DEFAULT_WS_ROOM_ID;
    if (!isSessionIdentifier(roomId)) throw new Error('Invalid room binding');
    let roomCode: string | null = null;
    if (options.roomCode !== undefined) {
      const normalized = normalizeRoomCode(options.roomCode);
      if (!isRoomCode(normalized)) throw new Error('Invalid room code');
      roomCode = normalized;
    }
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
    this.roomCode = roomCode;
    this.playerIds = [...playerIds];
    this.playerIdSet = new Set(playerIds);
    this.mode = mode;
    this.snapshotHz = snapshotHz;
    this.snapshotInterval = TICK_RATE / snapshotHz;
    this.maxLead = options.maxLead ?? DEFAULT_MAX_INPUT_LEAD_TICKS;
    this.maxTicks = options.maxTicks ?? null;
    this.allowRematch = options.allowRematch === true;
    const rejoinWindowMs = options.rejoinWindowMs ?? 0;
    if (!Number.isSafeInteger(rejoinWindowMs) || rejoinWindowMs < 0 || rejoinWindowMs > MAX_REJOIN_WINDOW_MS) {
      throw new Error('Invalid rejoin window');
    }
    this.rejoinWindowMs = rejoinWindowMs;
    const clock = options.now ?? (() => Date.now());
    if (typeof clock !== 'function') throw new Error('Invalid clock');
    this.clock = clock;
    this.onOutgoing = options.onOutgoing ?? (() => undefined);
    this.onPhaseChange = options.onPhaseChange ?? (() => undefined);
    this.onRoomDenial = options.onRoomDenial ?? (() => undefined);
    this.gateway = new SessionEnvelopeGateway({
      roomId,
      ...(roomCode === null ? {} : { roomCode }),
      ...(options.maxLead === undefined ? {} : { maxLead: options.maxLead }),
      maxPlayers: this.playerIds.length,
    });
    // The prototype begins in `fighting` like the deterministic benchmark
    // adapter; no gameplay rule or timing constant is changed. Score Brawl
    // still omits `mode` from the state, so its wire bytes stay identical.
    //
    // A wave match cannot exist before its teams are known, so the wave
    // session starts with a neutral placeholder that is replaced atomically in
    // `beginMatch` once the human claims are frozen.
    this.state = mode === 'wave'
      ? createState({ ids: [...this.playerIds], phase: 'lobby' })
      : createState({ ids: [...this.playerIds], phase: 'fighting', mode });
  }

  get roomIdValue(): string { return this.roomId; }
  /** Admission code this session enforces, or null when no code is configured. */
  get roomCodeValue(): string | null { return this.roomCode; }
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
  /** Identifier of the current match; starts at 1 and increases on rematch. */
  get matchIdValue(): number { return this.matchId; }
  /** Whether this session accepts `rematch` in `results`. */
  get rematchAllowed(): boolean { return this.allowRematch; }
  /** Configured rejoin window in milliseconds; `0` disables reservations. */
  get rejoinWindowMsValue(): number { return this.rejoinWindowMs; }
  /** Connections whose slots are currently held open for a rejoin. */
  get reservationCount(): number { return this.reservations.size; }
  /** Player ids currently reserved for a rejoin, in canonical order. */
  get reservedPlayerIds(): string[] {
    return [...this.reservations.values()].flatMap(reservation => [...reservation.playerIds]).sort();
  }

  isJoined(connectionId: string): boolean {
    return this.ownership.has(connectionId);
  }

  /** Registers transport-accepted socket identity. The client never supplies this ID. */
  addConnection(connectionId: string): void {
    if (!isSessionIdentifier(connectionId)) throw new Error('Invalid trusted connection ID');
    if (this.connections.has(connectionId)) throw new Error('Connection already registered');
    if (this.phaseValue === 'closed') throw new Error('Session is closed');
    this.expireReservations();
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
    this.expireReservations();

    let header: ClientEnvelopeHeader | null = null;
    try {
      header = parseClientEnvelopeHeader(data);
    } catch {
      // The gateway produces the authoritative denial with a stable code.
    }

    if (this.phaseValue === 'closed') {
      return this.denyRoom(connectionId, 'session-closed', 'Session is closed', header);
    }

    if (header?.kind === 'join-request' && this.roomCode !== null) {
      // Admission precedes phase and roster checks: a peer without the code
      // learns nothing about the match state and can never reach slot allocation.
      if (header.roomCode === undefined) {
        return this.denyRoom(connectionId, 'room-code-required', 'Join requires the server room code', header);
      }
      if (header.roomCode !== this.roomCode) {
        return this.denyRoom(connectionId, 'room-code-mismatch', 'Join room code does not match this server', header);
      }
    }

    // A mid-match rejoin is the only join allowed after the lobby. It must
    // claim the complete reserved slot set; every other claim follows the
    // ordinary frozen-roster path below.
    const rejoin = header?.kind === 'join-request'
      ? this.rejoinReservationFor(header.playerIds ?? [])
      : null;

    if (header?.kind === 'join-request' && rejoin === null) {
      // Wave accepts humans until the first authoritative tick: unclaimed
      // slots are only classified as enemies when the match starts. Every
      // other mode keeps the historical freeze at `starting`.
      const waveStarting = this.mode === 'wave' && this.phaseValue === 'starting';
      if (this.phaseValue !== 'lobby' && !waveStarting) {
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

    if (header?.kind === 'rematch') {
      if (!this.allowRematch) {
        return this.denyRoom(
          connectionId,
          'rematch-disabled',
          'This session serves one match; restart the server to play again',
          header,
        );
      }
      if (this.phaseValue !== 'results' && !this.rematchInProgress) {
        return this.denyRoom(
          connectionId,
          'not-in-results',
          'Rematch is accepted only after a finished match',
          header,
        );
      }
      if (this.phaseValue === 'results') {
        if (this.runComplete) {
          return this.denyRoom(
            connectionId,
            'not-in-results',
            'A bounded benchmark run cannot be rematched',
            header,
          );
        }
        if (!this.rematchRosterReady()) {
          return this.denyRoom(
            connectionId,
            'roster-incomplete',
            'Every configured player must still be connected for a rematch',
            header,
          );
        }
      }
    }

    const result = rejoin === null
      ? this.gateway.handle(this.binding(connectionId), data)
      : this.gateway.handle(this.binding(connectionId), data, { rejoinPlayerIds: rejoin.playerIds });
    if (!result.accepted) {
      this.emitError(connectionId, result.code, result.message, header);
      return result;
    }

    if (header?.kind === 'join-request') {
      const slots = result.envelope.kind === 'join-request' ? [...result.envelope.playerIds] : [];
      if (rejoin !== null) {
        // The reservation is consumed only after the reattach was accepted.
        this.reservations.delete(rejoin.connectionId);
      }
      this.ownership.set(connectionId, slots);
      if (this.host === null) this.host = connectionId;
      this.emit(connectionId, { version: 1, kind: 'join-result', accepted: true, playerIds: slots });
      this.emitRoster();
      if (rejoin !== null) {
        // Fresh snapshot stream: the rejoining peer gets the current authority
        // immediately and then joins the ordinary broadcast cadence. No
        // duplicate fighter or roster entry exists because the same slots were
        // transferred, not reallocated.
        this.emit(connectionId, this.matchStartMessage());
        this.emit(connectionId, { version: 1, kind: 'snapshot', snapshot: this.snapshot() });
        return result;
      }
      if (this.phaseValue === 'lobby' && this.canAutoStart()) {
        this.setPhase('starting');
      }
      return result;
    }

    if (header?.kind === 'ready-request') {
      this.readys.add(connectionId);
      this.emitRoster();
      return result;
    }

    if (header?.kind === 'leave-request') {
      this.ownership.delete(connectionId);
      this.readys.delete(connectionId);
      if (connectionId === this.host) {
        // Host authority is revoked, never migrated. Terminating the session is
        // the documented lifecycle outcome for this prototype.
        this.close('host-lost');
      } else {
        // An incomplete frozen roster cannot start; return to lobby rather than
        // leaving the session stuck in `starting`. Wave stays startable while
        // at least one human and one unclaimed enemy slot remain.
        if (this.phaseValue === 'starting' && !this.canAutoStart()) {
          this.setPhase('lobby');
        }
        this.emitRoster();
        if (this.phaseValue === 'lobby' && this.canAutoStart()) this.setPhase('starting');
      }
      return result;
    }

    if (header?.kind === 'ping') {
      this.emit(connectionId, { version: 1, kind: 'pong', sequence: header.sequence });
      return result;
    }

    if (header?.kind === 'rematch') {
      if (this.phaseValue === 'results') {
        this.beginRematch();
      }
      // A duplicate request while the accepted rematch is still starting is a
      // no-op: the sequence is valid, but no second match is created.
      return result;
    }

    // Accepted input needs no direct acknowledgement; it is consumed on tick.
    return result;
  }

  /**
   * Transport calls this once the start delay has elapsed. Returns false when
   * the roster is not eligible or the session is not in `starting`.
   *
   * Free-for-all modes keep the historical full-roster rule. A wave match
   * freezes its team split here: every claimed slot is `players`, every
   * unclaimed slot becomes a bot-driven `enemies` slot.
   */
  beginMatch(): boolean {
    if (this.phaseValue !== 'starting') return false;
    const refusal = this.matchStartRefusal();
    if (refusal !== null) {
      // A wave start that became impossible (for example every slot became a
      // human) returns to the lobby instead of hanging in `starting`.
      if (this.mode === 'wave') this.setPhase('lobby');
      return false;
    }
    if (this.mode === 'wave') {
      const teams = this.waveTeamAssignment();
      if (teams === null) {
        this.setPhase('lobby');
        return false;
      }
      this.waveTeams = teams;
      this.state = createState({ ids: [...this.playerIds], phase: 'fighting', mode: 'wave', teams });
    }
    this.setPhase('running');
    this.emitMatchStart();
    return true;
  }

  /**
   * Typed eligibility check for a start request. It is the single place that
   * defines "the roster is full" so `serve:match` can report a readable reason
   * instead of silently refusing an unwinnable wave match.
   */
  matchStartRefusal(): MatchStartRefusalReason | null {
    if (this.mode === 'wave') {
      const humans = this.claimedPlayerIds().length;
      if (humans === 0) return 'wave-needs-humans';
      if (humans >= this.playerIds.length) return 'wave-needs-enemies';
      return null;
    }
    return this.gateway.playerCount === this.playerIds.length ? null : 'roster-incomplete';
  }

  /**
   * Starts another match with the same roster and mode after an accepted
   * `rematch`. Counters that define a match reset; the absolute tick and every
   * connection keep moving forward so client input targets stay valid and a
   * late snapshot from the previous match is never mistaken for this one.
   */
  private beginRematch(): void {
    const startTick = this.gateway.nextTick;
    this.matchId += 1;
    this.eventLog.length = 0;
    this.gateway.discardPendingInputs();
    const teams = this.mode === 'wave' ? this.waveTeams : null;
    this.state = createState({
      ids: [...this.playerIds],
      phase: 'countdown',
      mode: this.mode,
      ...(teams === null ? {} : { teams }),
    });
    this.state.tick = startTick;
    this.rematchInProgress = true;
    this.setPhase('running');
    this.emitMatchStart();
  }

  private emitMatchStart(): void {
    this.matchStartTick = this.gateway.nextTick;
    this.emit(null, this.matchStartMessage());
  }

  private matchStartMessage(): WsServerMessage {
    return {
      version: 1,
      kind: 'match-start',
      startTick: this.matchStartTick,
      tickRate: TICK_RATE,
      snapshotHz: this.snapshotHz,
      matchId: this.matchId,
    };
  }

  /** Advances exactly one authoritative tick; no-op outside `running`. */
  stepOnce(): WsStepResult {
    this.expireReservations();
    if (this.phaseValue !== 'running' || this.runComplete) {
      return { stepped: false, tick: this.state.tick, snapshotSent: false, complete: this.runComplete };
    }
    const frame = this.gateway.consume();
    this.state = step(this.state, this.tickInputs(frame.inputs));
    // The rematch idempotency window closes once the new match actually ticks.
    this.rematchInProgress = false;
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
      this.emit(null, {
        version: 1,
        kind: 'match-end',
        tick: this.state.tick,
        result: computeMatchResult(this.state, this.eventLog),
      });
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

  /**
   * Trusted socket close. A non-host mid-match drop keeps its slots reserved for
   * the rejoin window; every other disconnection revokes immediately.
   *
   * `reserve: false` is used for policy closures (rate limit, oversized
   * message, bad room code) so an abusive peer cannot come back to a held slot.
   */
  disconnect(connectionId: string, options: { reserve?: boolean } = {}): string[] {
    this.expireReservations();
    if (!this.connections.delete(connectionId)) return [];
    this.readys.delete(connectionId);
    if (connectionId === this.host) {
      const revoked = this.gateway.disconnect(connectionId);
      this.ownership.delete(connectionId);
      this.close('host-lost');
      return revoked;
    }
    if (options.reserve !== false && this.rejoinWindowMs > 0 &&
        this.phaseValue === 'running' && this.ownership.has(connectionId)) {
      const reserved = this.gateway.reserve(connectionId);
      this.ownership.delete(connectionId);
      if (reserved.length > 0) {
        this.reservations.set(connectionId, {
          connectionId,
          playerIds: reserved,
          expiresAt: this.clock() + this.rejoinWindowMs,
        });
        // The roster is unchanged: the player is still claimed, just idle.
        this.emitRoster();
        return reserved;
      }
    }
    const revoked = this.gateway.disconnect(connectionId);
    this.ownership.delete(connectionId);
    // An incomplete frozen roster cannot start; return to lobby rather than
    // leaving the session stuck in `starting`. Wave stays startable while at
    // least one human and one unclaimed enemy slot remain.
    if (this.phaseValue === 'starting' && !this.canAutoStart()) {
      this.setPhase('lobby');
    }
    if (this.phaseValue !== 'closed') this.emitRoster();
    if (this.phaseValue === 'lobby' && this.canAutoStart()) this.setPhase('starting');
    return revoked;
  }

  /**
   * Releases every reservation whose window has elapsed. Called from message,
   * connection, disconnect and tick paths, and directly by the transport's
   * expiry timer. Returns the player ids released by this call.
   */
  expireReservations(now: number = this.clock()): string[] {
    if (this.reservations.size === 0) return [];
    const released: string[] = [];
    for (const [connectionId, reservation] of [...this.reservations]) {
      if (reservation.expiresAt > now) continue;
      this.reservations.delete(connectionId);
      released.push(...this.gateway.releaseReserved(connectionId));
    }
    if (released.length > 0) this.emitRoster();
    return released;
  }

  /** Terminates the session and revokes every remaining slot. No host migration. */
  close(reason: SessionClosedReason): void {
    if (this.phaseValue === 'closed') return;
    for (const connectionId of [...this.connections]) this.gateway.disconnect(connectionId);
    for (const connectionId of [...this.reservations.keys()]) this.gateway.releaseReserved(connectionId);
    this.reservations.clear();
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

  /**
   * The reservation a join claim may reattach, or null when this is an ordinary
   * join. Rejoin is allowed only while the match is running and only for the
   * complete reserved slot set; the claim itself is never trusted as identity.
   */
  private rejoinReservationFor(playerIds: readonly string[]): RejoinReservation | null {
    if (this.rejoinWindowMs === 0 || this.phaseValue !== 'running') return null;
    const claim = [...playerIds].sort();
    for (const reservation of this.reservations.values()) {
      const reserved = [...reservation.playerIds].sort();
      if (reserved.length !== claim.length) continue;
      if (reserved.every((playerId, index) => playerId === claim[index])) return reservation;
    }
    return null;
  }

  /** Roster slots currently owned by a connected human, in stable order. */
  private claimedPlayerIds(): string[] {
    const claimed = new Set<string>();
    for (const slots of this.ownership.values()) {
      for (const playerId of slots) claimed.add(playerId);
    }
    return this.playerIds.filter(playerId => claimed.has(playerId));
  }

  /**
   * Auto-start trigger. Free-for-all modes wait for the full roster. A wave
   * match starts as soon as at least one human is present, leaving every
   * unclaimed slot to the enemy bots; joining humans may still claim free slots
   * until the first tick.
   */
  private canAutoStart(): boolean {
    if (this.mode === 'wave') {
      const humans = this.claimedPlayerIds().length;
      return humans >= 1 && humans < this.playerIds.length;
    }
    return this.gateway.playerCount === this.playerIds.length;
  }

  /**
   * Team split frozen at match start: claimed slots are players, unclaimed
   * slots are enemies. Returns null when either side would be empty.
   */
  private waveTeamAssignment(): Record<string, Team> | null {
    const humans = new Set(this.claimedPlayerIds());
    const teams: Record<string, Team> = {};
    let players = 0;
    let enemies = 0;
    for (const playerId of this.playerIds) {
      if (humans.has(playerId)) {
        teams[playerId] = 'players';
        players += 1;
      } else {
        teams[playerId] = 'enemies';
        enemies += 1;
      }
    }
    return players === 0 || enemies === 0 ? null : teams;
  }

  /**
   * A rematch keeps the original roster. Wave only requires the human slots to
   * still be connected; the enemy slots stay bots by design.
   */
  private rematchRosterReady(): boolean {
    const owned = new Set([...this.ownership.values()].flat());
    if (this.mode === 'wave') {
      if (this.waveTeams === null) return false;
      return this.playerIds
        .filter(playerId => this.waveTeams?.[playerId] === 'players')
        .every(playerId => owned.has(playerId));
    }
    return this.playerIds.every(playerId => owned.has(playerId));
  }

  /**
   * Builds the authoritative input frame for one tick. In wave mode the enemy
   * slots are always driven here by the seeded bot policy; client input for an
   * enemy slot is filtered out even if it ever reached this method, so a peer
   * can never steer an enemy.
   */
  private tickInputs(humanInputs: readonly PlayerInput[]): PlayerInput[] {
    const teams = this.waveTeams;
    if (this.mode !== 'wave' || teams === null) return [...humanInputs];
    const enemyIds = this.playerIds.filter(playerId => teams[playerId] === 'enemies');
    return [
      ...humanInputs.filter(input => teams[input.playerId] !== 'enemies'),
      ...enemyIds.map(playerId => botInput(this.state, playerId, DEFAULT_WAVE_BOT_SEED)),
    ];
  }

  private emitSnapshot(): void {
    this.emit(null, { version: 1, kind: 'snapshot', snapshot: this.snapshot() });
  }

  private emitRoster(): void {
    // A reserved player is still claimed, so the roster keeps its entry and a
    // rejoin never creates a duplicate.
    const owned = new Set([...this.ownership.values()].flat());
    for (const reservation of this.reservations.values()) {
      for (const playerId of reservation.playerIds) owned.add(playerId);
    }
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
