import type { PlayerInput } from '../../src/game/simulation/types';
import { sha256 } from '../scenarios';
import {
  DEFAULT_TICKS,
  MAX_TICKS,
  WS_BENCHMARK_ROSTER,
  loadWsBenchmarkSchedule,
} from '../ws/benchmarkSetup';

/**
 * Deterministic input schedules for the headless bot client.
 *
 * Two patterns exist and both are pure functions of (pattern, players, ticks,
 * seed):
 *
 * - `fixture` replays this player's slice of the committed BASE-4 fixture, so a
 *   bot run is reproducible and comparable with the benchmark roles.
 * - `wander` is a small seeded pseudo-random walk so a human opponent sees a
 *   moving, fighting player instead of an idle statue. It is deliberately
 *   simple: it is not an AI and never changes simulation rules.
 *
 * Nothing here measures or simulates network behaviour. A `--ticks` bound is a
 * cycle count, not a duration.
 */

export const BOT_INPUT_PATTERNS = ['fixture', 'wander'] as const;
export type BotInputPattern = (typeof BOT_INPUT_PATTERNS)[number];

/** Seeded default for `wander`; recorded in the manifest. */
export const DEFAULT_WANDER_SEED = 1337;

/**
 * Bounds. `--ticks` is bounded by the longest deterministic match (7200 ticks
 * at 60 Hz = 120 s) because the fixture schedule is defined for exactly that.
 */
export { DEFAULT_TICKS, MAX_TICKS, WS_BENCHMARK_ROSTER };

export type BotSchedule = {
  readonly pattern: BotInputPattern;
  readonly players: readonly string[];
  readonly ticks: number;
  readonly seed: number;
  /** `null` for `wander`, which has no committed fixture. */
  readonly fixtureSha256: string | null;
  /** SHA-256 of the exact inputs this bot would drive, for both patterns. */
  readonly scheduleSha256: string;
  /** One schedule per requested player; every array has exactly `ticks` entries. */
  readonly inputsByPlayer: ReadonlyMap<string, readonly PlayerInput[]>;
};

export function isBotInputPattern(value: unknown): value is BotInputPattern {
  return BOT_INPUT_PATTERNS.includes(value as BotInputPattern);
}

export function assertBotTicks(ticks: number): void {
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
    throw new Error(`Tick bound must be 1..${MAX_TICKS}`);
  }
}

export function assertBotSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) {
    throw new Error('Seed must be an integer between 1 and 4294967295');
  }
}

/** mulberry32: tiny, fast and fully deterministic from a 32-bit seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function validatePlayers(players: readonly string[]): readonly string[] {
  if (!Array.isArray(players) || players.length < 1 || players.length > WS_BENCHMARK_ROSTER.length) {
    throw new Error(`Bot requires 1..${WS_BENCHMARK_ROSTER.length} player slots`);
  }
  if (new Set(players).size !== players.length) throw new Error('Bot player slots must be unique');
  for (const playerId of players) {
    if (!WS_BENCHMARK_ROSTER.includes(playerId)) {
      throw new Error(`Unknown player slot: ${String(playerId)} (expected ${WS_BENCHMARK_ROSTER.join(', ')})`);
    }
  }
  return [...players];
}

function scheduleDigest(
  pattern: BotInputPattern,
  players: readonly string[],
  ticks: number,
  seed: number,
  inputsByPlayer: ReadonlyMap<string, readonly PlayerInput[]>,
): string {
  return sha256(JSON.stringify({
    pattern,
    seed,
    ticks,
    players: [...players],
    inputs: players.map(playerId => inputsByPlayer.get(playerId) ?? []),
  }));
}

/**
 * One player's deterministic wander input. Each player gets a separate derived
 * stream so three bots do not mirror each other, and the direction hold is long
 * enough (0.4-1.4 s) to be visible to a human watching the server snapshots.
 */
function wanderInputs(playerId: string, playerIndex: number, ticks: number, seed: number): PlayerInput[] {
  // Mixing the index into the seed keeps the streams independent but stable.
  const random = seededRandom((seed + Math.imul(playerIndex + 1, 0x9e3779b1)) >>> 0);
  const inputs: PlayerInput[] = [];
  // Alternating start directions avoid every bot stacking on the same spot.
  let direction: -1 | 0 | 1 = playerIndex % 2 === 0 ? 1 : -1;
  let holdUntil = 0;
  for (let tick = 0; tick < ticks; tick++) {
    if (tick >= holdUntil) {
      const roll = random();
      direction = roll < 0.4 ? -1 : roll < 0.8 ? 1 : 0;
      // 24-84 ticks: 0.4-1.4 s at 60 Hz. Never a single-frame flicker.
      holdUntil = tick + 24 + Math.floor(random() * 61);
    }
    const jump = random() < 0.012;
    const punch = random() < 0.03;
    const kick = random() < 0.02;
    inputs.push({
      playerId,
      moveX: direction,
      moveY: 0,
      jump,
      punch,
      kick,
    });
  }
  return inputs;
}

function fixtureInputs(
  players: readonly string[],
  ticks: number,
): { readonly inputsByPlayer: Map<string, PlayerInput[]>; readonly fixtureSha256: string; readonly seed: number } {
  const { fixture, schedule } = loadWsBenchmarkSchedule(ticks);
  const inputsByPlayer = new Map<string, PlayerInput[]>();
  for (const playerId of players) {
    const slice: PlayerInput[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      const input = schedule[tick].find(candidate => candidate.playerId === playerId);
      if (!input) throw new Error(`Fixture lost the input for ${playerId} at tick ${tick}`);
      slice.push({ ...input });
    }
    inputsByPlayer.set(playerId, slice);
  }
  return { inputsByPlayer, fixtureSha256: fixture.fixtureSha256, seed: fixture.seed };
}

/**
 * Builds the schedule this bot will drive. `seed` is only meaningful for
 * `wander`; passing it with `fixture` is an error so a manifest can never show a
 * seed that did not affect the inputs.
 */
export function createBotSchedule(options: {
  pattern: BotInputPattern;
  players: readonly string[];
  ticks: number;
  seed?: number;
}): BotSchedule {
  const { pattern, ticks } = options;
  if (!isBotInputPattern(pattern)) {
    throw new Error(`Invalid input pattern: ${String(pattern)} (expected ${BOT_INPUT_PATTERNS.join(' or ')})`);
  }
  assertBotTicks(ticks);
  const players = validatePlayers(options.players);
  if (pattern === 'fixture') {
    if (options.seed !== undefined) throw new Error('--seed is only valid with --pattern=wander');
    const fixture = fixtureInputs(players, ticks);
    return {
      pattern,
      players,
      ticks,
      seed: fixture.seed,
      fixtureSha256: fixture.fixtureSha256,
      scheduleSha256: scheduleDigest(pattern, players, ticks, fixture.seed, fixture.inputsByPlayer),
      inputsByPlayer: fixture.inputsByPlayer,
    };
  }
  const seed = options.seed ?? DEFAULT_WANDER_SEED;
  assertBotSeed(seed);
  const inputsByPlayer = new Map<string, PlayerInput[]>();
  players.forEach((playerId, index) => {
    inputsByPlayer.set(playerId, wanderInputs(playerId, index, ticks, seed));
  });
  return {
    pattern,
    players,
    ticks,
    seed,
    fixtureSha256: null,
    scheduleSha256: scheduleDigest(pattern, players, ticks, seed, inputsByPlayer),
    inputsByPlayer,
  };
}
