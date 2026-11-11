import type { StateSnapshot } from '../protocol/stateSnapshot';
import { isRoomCode, normalizeRoomCode, type RoomConfiguration } from '../session/sessionEnvelope';
import { TICK_RATE } from '../simulation/step';
import type { GameState, PlayerInput } from '../simulation/types';
import {
  openBrowserSession,
  type BrowserSession,
  type BrowserSocketFactory,
} from './browserWsAdapter';
import { interpolateTimedSnapshots, type TimedSnapshot } from './snapshotInterpolation';
import type { SessionClientHandlers } from './wsSessionClient';
import type { SnapshotHz, WsMatchResult } from './wsMessages';

/**
 * Browser online match client: one authoritative WebSocket session, no local
 * simulation and no prediction.
 *
 * Responsibilities:
 * - join exactly one requested slot and verify the grant;
 * - sample the caller's input at 60 Hz and submit canonical input frames a few
 *   ticks ahead (`ONLINE_INPUT_LEAD_TICKS`);
 * - keep the last two snapshots for interpolation and the latest authoritative
 *   state for HUD values;
 * - measure RTT with the existing ping/pong messages;
 * - turn every lifecycle outcome (connect failure, roster denial, session
 *   close, transport loss) into an explicit status instead of a silent freeze.
 *
 * It never calls `step()`, never extrapolates and never claims authority.
 */
export const ONLINE_INPUT_LEAD_TICKS = 3;
export const ONLINE_PING_INTERVAL_MS = 500;
export const ONLINE_CONNECT_TIMEOUT_MS = 10_000;
export const ONLINE_STALE_SNAPSHOT_MS = 3_000;
export const ONLINE_SNAPSHOT_HISTORY = 3;
const MAX_INPUT_LEAD = 8;

export type OnlineConnectionState =
  | 'idle'
  | 'connecting'
  | 'joined'
  | 'running'
  | 'ended'
  | 'closed'
  | 'error';

export type OnlineStatus = {
  readonly state: OnlineConnectionState;
  readonly message: string;
  /** Last non-fatal denial/protocol detail, kept visible but not alarming. */
  readonly detail?: string;
};

export type OnlineLinkInfo = {
  readonly state: OnlineConnectionState;
  readonly message: string;
  readonly rttMs: number | null;
  readonly snapshotCount: number;
  readonly tick: number;
  readonly lastSnapshotAgeMs: number | null;
  readonly stale: boolean;
  readonly detail?: string;
};

export type OnlineMatchOptions = {
  readonly socketFactory?: BrowserSocketFactory;
  readonly now?: () => number;
  readonly pingIntervalMs?: number;
  readonly connectTimeoutMs?: number;
  readonly onStatus?: (status: OnlineStatus) => void;
};

export type OnlineJoinOptions = {
  readonly url: string;
  readonly playerId: string;
  /**
   * Server admission code. Optional so a code-less server still works; when
   * present it is normalized to uppercase and sent with the join.
   */
  readonly roomCode?: string;
  /** Present when this browser is creating the one room hosted by the process. */
  readonly roomConfig?: RoomConfiguration;
};

type MatchStartInfo = {
  readonly startTick: number;
  readonly tickRate: number;
  readonly snapshotHz: SnapshotHz;
  readonly matchId?: number;
};

export type OnlineLobbyState = {
  readonly requiredPlayerIds: readonly string[];
  readonly playerIds: readonly string[];
  readonly readyPlayerIds: readonly string[];
  readonly hostPlayerId: string | null;
  readonly mode: string;
  readonly arena: string;
  readonly durationMinutes: number;
};

const ROOM_ID = 'match';
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function neutralInput(playerId: string): PlayerInput {
  return { playerId, moveX: 0, moveY: 0, jump: false, punch: false, kick: false, jumpkick: false };
}

function validateRoomCode(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value.length === 0) return undefined;
  const normalized = normalizeRoomCode(value);
  if (!isRoomCode(normalized)) throw new Error('Room code must be 4-12 letters or digits');
  return normalized;
}

function validateJoin(options: OnlineJoinOptions): URL {
  if (typeof options?.url !== 'string' || options.url.trim().length === 0) {
    throw new Error('Server URL is required, for example ws://127.0.0.1:8787');
  }
  let parsed: URL;
  try {
    parsed = new URL(options.url.trim());
  } catch {
    throw new Error('Server URL must look like ws://HOST:PORT');
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Server URL must use ws:// or wss://');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Server URL must not contain credentials, a query or a fragment');
  }
  if (!PLAYER_ID.test(options.playerId)) {
    throw new Error('Player slot must be a short identifier such as P1');
  }
  return parsed;
}

export class OnlineMatchController {
  private readonly onStatus: (status: OnlineStatus) => void;
  private readonly socketFactory: BrowserSocketFactory | undefined;
  private readonly clock: () => number;
  private readonly pingIntervalMs: number;
  private readonly connectTimeoutMs: number;

  private session: BrowserSession | null = null;
  private inputReader: (() => PlayerInput) | null = null;
  private playerIdValue = '';
  private roomCodeValue = '';
  private urlValue = '';
  private lobbyStateValue: OnlineLobbyState = { requiredPlayerIds: [], playerIds: [], readyPlayerIds: [], hostPlayerId: null, mode: 'score-brawl', arena: 'station', durationMinutes: 2 };

  private statusValue: OnlineStatus = { state: 'idle', message: 'Not connected.' };
  private snapshots: TimedSnapshot[] = [];
  private snapshotCountValue = 0;
  private lastSnapshotAt: number | null = null;
  private rttSamples: number[] = [];
  private pingSends = new Map<number, number>();
  private lastDetail: string | undefined;

  private matchStartValue: MatchStartInfo | null = null;
  private matchStartedAt: number | null = null;
  private matchResultValue: WsMatchResult | null = null;
  private rematchRefusedCodeValue: string | null = null;
  private nextTick = 0;
  private joined = false;
  private running = false;
  private terminal = false;
  private disconnecting = false;
  private attemptToken = 0;

  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: OnlineMatchOptions = {}) {
    this.onStatus = options.onStatus ?? (() => undefined);
    this.socketFactory = options.socketFactory;
    this.clock = options.now ?? (() => performance.now());
    this.pingIntervalMs = options.pingIntervalMs ?? ONLINE_PING_INTERVAL_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? ONLINE_CONNECT_TIMEOUT_MS;
  }

  get status(): OnlineStatus { return this.statusValue; }
  get connectionState(): OnlineConnectionState { return this.statusValue.state; }
  get playerId(): string { return this.playerIdValue; }
  get roomCode(): string { return this.roomCodeValue; }
  get lobbyState(): OnlineLobbyState { return this.lobbyStateValue; }
  get url(): string { return this.urlValue; }
  get snapshotCount(): number { return this.snapshotCountValue; }
  get latestTick(): number {
    return this.snapshots[this.snapshots.length - 1]?.snapshot.state.tick ?? this.matchStartValue?.startTick ?? 0;
  }
  get rttMs(): number | null {
    return this.rttSamples.length > 0 ? this.rttSamples[this.rttSamples.length - 1]! : null;
  }
  get matchStart(): MatchStartInfo | null { return this.matchStartValue; }
  /** Server-authored result of the last finished match; the client never ranks. */
  get matchResult(): WsMatchResult | null { return this.matchResultValue; }
  /** Typed server denial for the most recent rematch request, if refused. */
  get rematchRefusedCode(): string | null { return this.rematchRefusedCodeValue; }
  get ownedPlayerIds(): readonly string[] { return this.session?.client.ownedPlayerIds ?? []; }
  get isRunning(): boolean { return this.running; }

  /**
   * Latest authoritative state exactly as received; null before the first
   * snapshot. This is a read-only diagnostics view: `renderState()` remains the
   * presentation path, and no caller may step or mutate this state.
   */
  latestState(): GameState | null {
    return this.snapshots[this.snapshots.length - 1]?.snapshot.state ?? null;
  }

  now(): number {
    return this.clock();
  }

  /** The input source is read at 60 Hz and at most a few ticks ahead. */
  setInputReader(reader: (() => PlayerInput) | null): void {
    this.inputReader = reader;
  }

  connect(options: OnlineJoinOptions): void {
    if (this.session !== null) throw new Error('A session is already open; reload the page to reconnect');
    if (this.statusValue.state === 'connecting') throw new Error('A connection attempt is already in progress');
    const parsed = validateJoin(options);
    const roomCode = validateRoomCode(options.roomCode);
    this.reset();
    this.playerIdValue = options.playerId;
    this.roomCodeValue = roomCode ?? '';
    this.urlValue = parsed.href.replace(/\/$/, '');
    this.setStatus('connecting', `Connecting to ${this.urlValue} as ${this.playerIdValue}…`);

    // Every handler belongs to one connection attempt. A late event from a
    // closed or superseded socket must not overwrite the current status.
    const attempt = ++this.attemptToken;

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.joined && !this.terminal) {
        this.fail(`No join response from ${this.urlValue} within ${this.connectTimeoutMs} ms.`);
      }
    }, this.connectTimeoutMs);

    const handlers: SessionClientHandlers = {
      onWelcome: info => {
        if (attempt !== this.attemptToken || this.terminal) return;
        this.setStatus('connecting', `Connected to room ${info.roomId}; joining ${this.playerIdValue}…`);
      },
      onJoinResult: result => {
        if (attempt !== this.attemptToken || this.terminal) return;
        if (!result.accepted) {
          this.fail(`Join denied${result.code ? ` (${result.code})` : ''}. ` +
            'The server may be full, or the match may already have started.');
          return;
        }
        if (result.playerIds.length !== 1 || result.playerIds[0] !== this.playerIdValue) {
          this.fail(`Server granted [${result.playerIds.join(', ')}] but this page requested ` +
            `[${this.playerIdValue}].`);
          return;
        }
        this.joined = true;
        this.clearConnectTimer();
        this.setStatus('joined', `Joined ${this.playerIdValue}. Waiting for every configured slot…`);
        this.startPingTimer();
      },
      onRoster: playerIds => {
        if (attempt !== this.attemptToken || this.terminal || !this.joined ||
            this.statusValue.state === 'running') return;
        this.setStatus('joined', `Roster: ${playerIds.join(', ') || 'empty'}. ` +
          'Waiting for every configured slot…');
      },
      onLobbyState: state => {
        if (attempt !== this.attemptToken || this.terminal) return;
        this.lobbyStateValue = {
          requiredPlayerIds: [...state.requiredPlayerIds],
          playerIds: [...state.playerIds],
          readyPlayerIds: [...state.readyPlayerIds],
          hostPlayerId: state.hostPlayerId,
          mode: state.mode,
          arena: state.arena,
          durationMinutes: state.durationMinutes,
        };
        this.emitStatus();
      },
      onMatchStart: info => {
        if (attempt !== this.attemptToken || !this.joined) return;
        const previousMatchId = this.matchStartValue?.matchId;
        const rematch = info.matchId !== undefined && previousMatchId !== undefined &&
          info.matchId !== previousMatchId;
        if (this.terminal && !rematch) return;
        if (rematch) {
          // A higher match identifier means the previous match's snapshots and
          // interpolation history are stale. Drop them before the new countdown.
          this.terminal = false;
          this.snapshots = [];
          this.snapshotCountValue = 0;
          this.lastSnapshotAt = null;
          this.matchResultValue = null;
        }
        this.rematchRefusedCodeValue = null;
        this.matchStartValue = { ...info };
        this.matchStartedAt = this.clock();
        this.nextTick = info.startTick;
        this.running = true;
        this.clearConnectTimer();
        this.setStatus('running', `Match started at tick ${info.startTick} · ` +
          `${info.snapshotHz} Hz snapshots · ${info.tickRate} Hz ticks`);
        this.startInputTimer();
      },
      onSnapshot: snapshot => {
        if (attempt !== this.attemptToken) return;
        this.noteSnapshot(snapshot);
      },
      onError: error => {
        if (attempt !== this.attemptToken) return;
        // A results-phase rematch refusal is an expected, recoverable reply.
        // Preserve the finished match and surface the typed denial to the page;
        // all other errors after a terminal state remain ignored as before.
        if (this.terminal) {
          if (['rematch-disabled', 'roster-incomplete', 'not-in-results'].includes(error.code)) {
            this.rematchRefusedCodeValue = error.code;
            this.setStatus('ended', 'Rematch refused.', `${error.code}: ${error.message}`);
          }
          return;
        }
        const text = `${error.code}: ${error.message}`;
        this.lastDetail = text;
        if (!this.joined) {
          this.fail(`Join denied (${error.code}): ${error.message}`);
          return;
        }
        // Late input and a match completing under our feet are expected races,
        // not reasons to tear down a healthy link.
        if (error.code === 'late-tick' || error.code === 'match-complete' || error.code === 'not-started') {
          this.emitStatus();
          return;
        }
        this.setStatus(this.statusValue.state, this.statusValue.message, text);
      },
      onPong: sequence => {
        if (attempt !== this.attemptToken) return;
        this.notePong(sequence);
      },
      onMatchEnd: (tick, result) => {
        if (attempt !== this.attemptToken || this.terminal) return;
        this.matchResultValue = result ?? null;
        this.rematchRefusedCodeValue = null;
        this.terminal = true;
        this.running = false;
        this.stopTimers();
        this.setStatus('ended', `Match ended at tick ${tick}. Scores are final.`);
      },
      onRunComplete: tick => {
        if (attempt !== this.attemptToken || this.terminal) return;
        this.terminal = true;
        this.running = false;
        this.stopTimers();
        this.setStatus('ended', `Server ended its bounded run at tick ${tick}.`);
      },
      onSessionClosed: reason => {
        if (attempt !== this.attemptToken || this.terminal) return;
        this.terminal = true;
        this.running = false;
        this.stopTimers();
        this.setStatus('closed', reason === 'host-lost'
          ? 'Session closed: the host disconnected.'
          : 'Session closed: the match is complete.');
      },
      onProtocolError: message => {
        if (attempt !== this.attemptToken || this.terminal) return;
        this.lastDetail = `protocol: ${message}`;
        this.emitStatus();
      },
      onTransportClosed: () => {
        if (attempt !== this.attemptToken || this.disconnecting || this.terminal ||
            this.statusValue.state === 'error' || this.statusValue.state === 'closed') return;
        this.stopTimers();
        this.running = false;
        this.joined = false;
        if (this.statusValue.state === 'connecting' || this.statusValue.state === 'idle') {
          this.fail(`Could not connect to ${this.urlValue}. Check the URL and that the match ` +
            'server is running.');
          return;
        }
        this.terminal = true;
        this.setStatus('closed', 'Connection closed by the server or the network.');
      },
      onTransportError: message => {
        if (attempt !== this.attemptToken || this.disconnecting || this.terminal) return;
        this.lastDetail = message;
        if (!this.joined) {
          this.fail(`Connection failed for ${this.urlValue}: ${message}. Check the URL and ` +
            'that the match server is running.');
          return;
        }
        this.terminal = true;
        this.running = false;
        this.stopTimers();
        this.setStatus('error', `Connection error after joining: ${message}`);
        const session = this.session;
        this.session = null;
        if (session !== null) {
          try {
            session.close(1000, 'client transport error');
          } catch {
            // Already closed.
          }
        }
      },
    };

    try {
      const session = openBrowserSession({
        url: this.urlValue,
        roomId: ROOM_ID,
        handlers,
        ...(this.socketFactory === undefined ? {} : { socketFactory: this.socketFactory }),
      });
      this.session = session;
      // The adapter queues this until the WebSocket handshake completes.
      session.client.join([this.playerIdValue], roomCode, options.roomConfig);
    } catch (error) {
      this.fail(`Could not open the connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Last two snapshots, interpolated at `now`; null until the first snapshot. */
  renderState(now = this.now()): GameState | null {
    const current = this.snapshots[this.snapshots.length - 1];
    if (!current) return null;
    const previous = this.snapshots.length >= 2 ? this.snapshots[this.snapshots.length - 2]! : null;
    const intervalMs = this.matchStartValue === null
      ? undefined
      : 1000 / this.matchStartValue.snapshotHz;
    return interpolateTimedSnapshots(previous, current, now, intervalMs);
  }

  linkInfo(now = this.now()): OnlineLinkInfo {
    // Before the first snapshot, age is measured from match-start so a link
    // that accepts input but never delivers state is visibly stalled.
    const since = this.lastSnapshotAt ?? this.matchStartedAt;
    const age = since === null ? null : Math.max(0, now - since);
    return {
      state: this.statusValue.state,
      message: this.statusValue.message,
      rttMs: this.rttMs,
      snapshotCount: this.snapshotCountValue,
      tick: this.latestTick,
      lastSnapshotAgeMs: age,
      stale: this.running && age !== null && age > ONLINE_STALE_SNAPSHOT_MS,
      ...(this.lastDetail === undefined ? {} : { detail: this.lastDetail }),
    };
  }

  /**
   * Asks the authoritative session for another match with the same roster.
   * The server accepts only in `results` with every player still connected.
   */
  requestRematch(): number {
    if (this.session === null) throw new Error('No open session to rematch');
    // Do not let a prior refusal masquerade as the response to a new request.
    this.lastDetail = undefined;
    this.rematchRefusedCodeValue = null;
    this.setStatus(this.statusValue.state, this.statusValue.message);
    return this.session.client.rematch();
  }

  requestReady(): number {
    if (this.session === null) throw new Error('No open session to ready up');
    return this.session.client.ready();
  }

  requestHostStart(): number {
    if (this.session === null) throw new Error('No open session to start');
    return this.session.client.startMatch();
  }

  /** Best-effort graceful leave, then close the socket. Idempotent. */
  disconnect(): void {
    const hadSession = this.session !== null;
    this.disconnecting = true;
    // Supersede every pending handler before closing: a late join result,
    // snapshot or pong from the closing socket must not revive a client the
    // user has explicitly left.
    this.attemptToken += 1;
    this.terminal = true;
    this.stopTimers();
    this.running = false;
    this.joined = false;
    if (this.session !== null) {
      const session = this.session;
      this.session = null;
      try {
        if (session.client.sessionState === 'joined') session.client.leave();
      } catch {
        // The socket may already be closed.
      }
      try {
        session.close(1000, 'client leave');
      } catch {
        // The socket may already be closed.
      }
    }
    // Leaving also drops the received view: nothing may keep presenting the
    // departed match's mode, timer, scores or RTT as if the link were live.
    this.snapshots = [];
    this.snapshotCountValue = 0;
    this.lastSnapshotAt = null;
    this.rttSamples = [];
    this.pingSends.clear();
    this.matchStartValue = null;
    this.matchStartedAt = null;
    this.matchResultValue = null;
    this.lobbyStateValue = { requiredPlayerIds: [], playerIds: [], readyPlayerIds: [], hostPlayerId: null, mode: 'score-brawl', arena: 'station', durationMinutes: 2 };
    this.rematchRefusedCodeValue = null;
    this.nextTick = 0;
    this.roomCodeValue = '';
    if (hadSession && this.statusValue.state !== 'error' && this.statusValue.state !== 'ended') {
      this.setStatus('closed', 'Disconnected from the match server.');
    }
  }

  private noteSnapshot(snapshot: StateSnapshot): void {
    if (this.statusValue.state === 'error' || this.statusValue.state === 'closed') return;
    const receivedAt = this.clock();
    this.snapshotCountValue += 1;
    this.lastSnapshotAt = receivedAt;
    const latest = this.snapshots[this.snapshots.length - 1];
    // TCP preserves order, but an out-of-order or duplicate snapshot must not
    // rewind the rendered state.
    if (!latest || snapshot.state.tick > latest.snapshot.state.tick) {
      this.snapshots.push({ snapshot, receivedAt });
      if (this.snapshots.length > ONLINE_SNAPSHOT_HISTORY) this.snapshots.shift();
    }
    if (this.joined && !this.running && !this.terminal) {
      this.running = true;
      this.setStatus('running', `Receiving snapshots at tick ${snapshot.state.tick}.`);
    }
    if (this.running) this.pumpInput();
  }

  private notePong(sequence: number): void {
    const sentAt = this.pingSends.get(sequence);
    if (sentAt === undefined) return;
    this.pingSends.delete(sequence);
    // A delayed pong still measures this link honestly; keep a bounded window.
    this.rttSamples.push(Math.max(0, this.clock() - sentAt));
    if (this.rttSamples.length > 16) this.rttSamples.shift();
  }

  private startInputTimer(): void {
    this.stopInputTimer();
    this.pumpInput();
    this.inputTimer = setInterval(() => this.pumpInput(), 1000 / TICK_RATE);
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      if (this.session === null || this.terminal) return;
      try {
        const sequence = this.session.client.ping();
        if (this.pingSends.size > 64) this.pingSends.clear();
        this.pingSends.set(sequence, this.clock());
      } catch {
        // A closed transport is reported by its own handler.
      }
    }, this.pingIntervalMs);
  }

  /**
   * Submits the next authoritative ticks. `serverTick` advances on each
   * snapshot, so input stays inside the server's bounded look-ahead window
   * without prediction. Multiple ticks are sent after a snapshot arrives; the
   * input source is the local keyboard state at that instant.
   */
  private pumpInput(): void {
    if (!this.running || this.terminal || !this.joined || this.session === null) return;
    const client = this.session.client;
    const serverTick = client.serverTick;
    // If a stall put the local schedule behind the authoritative tick, do not
    // flood the server with already-consumed ticks. The next input can only
    // affect ticks that have not been consumed yet.
    if (this.snapshots.length > 0 && this.nextTick < serverTick + 1) {
      this.nextTick = serverTick + 1;
    }
    const target = Math.min(
      Math.max(this.nextTick, serverTick + ONLINE_INPUT_LEAD_TICKS),
      serverTick + MAX_INPUT_LEAD,
    );
    let guard = 0;
    while (this.nextTick <= target && guard < MAX_INPUT_LEAD + 1) {
      guard += 1;
      let input: PlayerInput;
      try {
        input = this.inputReader?.() ?? neutralInput(this.playerIdValue);
      } catch {
        input = neutralInput(this.playerIdValue);
      }
      try {
        client.submitInput(this.nextTick, [{ ...input, playerId: this.playerIdValue }]);
        this.nextTick += 1;
      } catch (error) {
        this.lastDetail = `input: ${error instanceof Error ? error.message : String(error)}`;
        this.emitStatus();
        return;
      }
    }
  }

  private reset(): void {
    this.stopTimers();
    this.session = null;
    this.snapshots = [];
    this.snapshotCountValue = 0;
    this.lastSnapshotAt = null;
    this.rttSamples = [];
    this.pingSends.clear();
    this.lastDetail = undefined;
    this.matchStartValue = null;
    this.matchStartedAt = null;
    this.matchResultValue = null;
    this.rematchRefusedCodeValue = null;
    this.nextTick = 0;
    this.joined = false;
    this.running = false;
    this.terminal = false;
    this.disconnecting = false;
    this.roomCodeValue = '';
  }

  private fail(message: string): void {
    if (this.terminal && this.statusValue.state === 'error') return;
    this.terminal = true;
    this.running = false;
    this.joined = false;
    this.stopTimers();
    this.setStatus('error', message);
    const session = this.session;
    this.session = null;
    if (session !== null) {
      try {
        session.close(1000, 'client error');
      } catch {
        // Already closed.
      }
    }
  }

  private setStatus(
    state: OnlineConnectionState,
    message: string,
    detail?: string,
  ): void {
    if (detail !== undefined) this.lastDetail = detail;
    const next: OnlineStatus = {
      state,
      message,
      ...(this.lastDetail === undefined ? {} : { detail: this.lastDetail }),
    };
    if (next.state === this.statusValue.state && next.message === this.statusValue.message &&
        next.detail === this.statusValue.detail) return;
    this.statusValue = next;
    this.onStatus(next);
  }

  /** Re-emits the same state with the current detail so the UI updates. */
  private emitStatus(): void {
    this.statusValue = {
      state: this.statusValue.state,
      message: this.statusValue.message,
      ...(this.lastDetail === undefined ? {} : { detail: this.lastDetail }),
    };
    this.onStatus(this.statusValue);
  }

  private stopInputTimer(): void {
    if (this.inputTimer !== null) clearInterval(this.inputTimer);
    this.inputTimer = null;
  }

  private stopPingTimer(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private stopTimers(): void {
    this.stopInputTimer();
    this.stopPingTimer();
    this.clearConnectTimer();
  }
}
