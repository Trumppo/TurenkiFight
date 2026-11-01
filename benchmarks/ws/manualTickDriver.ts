import type { WsStepResult } from '../../server/ws/authoritativeWsSession';

/**
 * Deterministic manual pacing for the loopback WebSocket benchmark.
 *
 * `interval` mode lets the server's own 60 Hz timer advance ticks while the
 * benchmark only submits input, so a 120 s (7200-tick) match costs 120 s of
 * wall-clock time. Manual mode instead advances the authority on demand.
 *
 * The driver is still exercised through real sockets: it submits a bounded
 * window of fixture input on every ordered connection, then sends a ping. A
 * WebSocket delivers frames in order, and the server answers pings only after
 * the earlier input frames have been handled, so the returned pong proves the
 * whole window is buffered. Only then does the driver step the ticks. No
 * timing is recorded: the barrier timeout is a hang guard, not a pacing
 * measurement.
 *
 * The window must stay inside the session look-ahead
 * (`windowTicks <= maxLead + 1`); the caller owns that configuration.
 */

/** Ticks submitted ahead of the authority; matches the benchmark's 8-tick lead. */
export const MANUAL_WINDOW_TICKS = 8;

/** Hang guard for one barrier window. Never reported as a measurement. */
export const DEFAULT_MANUAL_BARRIER_TIMEOUT_MS = 10000;

export type ManualTickClient = {
  /** Submits this client's fixture input for one tick; must not be repeated. */
  submitInput(tick: number): void;
  /** Sends a ping and returns its envelope sequence number. */
  ping(): number;
  /** Highest ping sequence this client has received back from the server. */
  lastPongSequence(): number;
};

export type ManualTickDriverOptions = {
  /** Total authoritative ticks the run must reach. */
  ticks: number;
  /** Authoritative ticks already stepped (the room's current tick). */
  nextTick: () => number;
  /** Advances exactly one authoritative tick. */
  stepOnce: () => WsStepResult;
  clients: readonly ManualTickClient[];
  /** Ticks submitted ahead of the authority. Defaults to `MANUAL_WINDOW_TICKS`. */
  windowTicks?: number;
  /** Hang guard for one window barrier. Defaults to 10 s. */
  barrierTimeoutMs?: number;
  /** Returns the fatal error that must stop the driver, or null while healthy. */
  abortReason?: () => Error | null;
  /** Yields to the event loop so socket frames can be delivered. */
  yieldTurn?: () => Promise<void>;
  /** Injectable clock for the hang guard; not a measured value. */
  now?: () => number;
};

const defaultYieldTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

export async function driveManualTicks(options: ManualTickDriverOptions): Promise<void> {
  const { ticks } = options;
  if (!Number.isSafeInteger(ticks) || ticks < 1) throw new Error('Invalid manual tick count');
  const windowTicks = options.windowTicks ?? MANUAL_WINDOW_TICKS;
  if (!Number.isSafeInteger(windowTicks) || windowTicks < 1) throw new Error('Invalid manual input window');
  const barrierTimeoutMs = options.barrierTimeoutMs ?? DEFAULT_MANUAL_BARRIER_TIMEOUT_MS;
  if (!Number.isSafeInteger(barrierTimeoutMs) || barrierTimeoutMs < 1) {
    throw new Error('Invalid manual barrier timeout');
  }
  const clients = [...options.clients];
  if (clients.length === 0) throw new Error('Manual driver requires at least one client');
  const yieldTurn = options.yieldTurn ?? defaultYieldTurn;
  const now = options.now ?? (() => Date.now());
  // Surface the original fatal error instead of a generic abort message.
  const abortReason = (): Error | null => options.abortReason?.() ?? null;

  while (options.nextTick() < ticks) {
    const abort = abortReason();
    if (abort) throw abort;
    const first = options.nextTick();
    const last = Math.min(ticks - 1, first + windowTicks - 1);

    for (const client of clients) {
      for (let tick = first; tick <= last; tick++) client.submitInput(tick);
    }

    // Ordered connections: a pong implies every earlier input frame of that
    // connection has been processed, so a complete pong set proves the window
    // is buffered. This is a correctness barrier, not a latency probe.
    const expectedPongs = clients.map(client => client.ping());
    const startedAt = now();
    while (!clients.every((client, index) => client.lastPongSequence() >= expectedPongs[index])) {
      const barrierAbort = abortReason();
      if (barrierAbort) throw barrierAbort;
      if (now() - startedAt > barrierTimeoutMs) {
        throw new Error(`Manual tick barrier timed out after ${barrierTimeoutMs} ms at tick ${first}`);
      }
      await yieldTurn();
    }

    for (let tick = first; tick <= last; tick++) {
      const result = options.stepOnce();
      if (!result.stepped || result.tick !== tick + 1) {
        throw new Error(`Manual driver did not advance deterministically at tick ${tick}`);
      }
    }
  }

  if (options.nextTick() !== ticks) {
    throw new Error(`Manual run ended at tick ${options.nextTick()}, expected ${ticks}`);
  }
}
