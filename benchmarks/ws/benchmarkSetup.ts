import { decodeInputFrame } from '../../src/game/protocol/inputFrame';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import { TICK_RATE } from '../../src/game/simulation/step';
import type { PlayerInput } from '../../src/game/simulation/types';
import type { SnapshotHz } from '../../src/game/networking/wsMessages';
import { SUPPORTED_SNAPSHOT_HZ } from '../../src/game/networking/wsMessages';
import { InMemoryBenchmarkAdapter } from '../inMemory';
import { createRoster, generateFixture, sha256, type BenchmarkFixture } from '../scenarios';
import type { WsBenchmarkTickMode } from './wsManifest';

/**
 * Shared, transport-independent setup for every WebSocket benchmark role.
 *
 * The loopback runner, the networkable server role and the remote client role
 * must decode the exact same fixture slice and use the same bounds. Keeping
 * these constants and parsers in one module is what makes the split roles
 * comparable with the single-process default; it measures nothing.
 */

export const WS_BENCHMARK_SCENARIO_ID = 'BASE-4-60-20' as const;
export const WS_BENCHMARK_PLAYER_COUNT = 4;
export const WS_BENCHMARK_ROSTER: readonly string[] = createRoster(WS_BENCHMARK_PLAYER_COUNT);
export type WsBenchmarkPlayerCount = 4 | 8;
export function wsBenchmarkRoster(playerCount: WsBenchmarkPlayerCount): readonly string[] {
  return createRoster(playerCount);
}
export function wsBenchmarkScenarioId(playerCount: WsBenchmarkPlayerCount): 'BASE-4-60-20' | 'BASE-8-60-20' {
  return playerCount === 8 ? 'BASE-8-60-20' : WS_BENCHMARK_SCENARIO_ID;
}

export const DEFAULT_TICKS = 300;
export const MAX_TICKS = 7200;
export const MAX_LEAD_TICKS = 8;
export const START_DELAY_MS = 400;
export const FIRST_TICK_DELAY_MS = 250;
/**
 * Wall-clock guard only. A 7200-tick interval run legitimately needs 120 s, so
 * the default is derived from the tick count instead of a fixed 30 s.
 */
export const RUN_TIMEOUT_BASE_MS = 30000;
export const MANUAL_TICK_BUDGET_MS = 5;
export const MAX_RUN_TIMEOUT_MS = 30 * 60 * 1000;

export type WsBenchmarkSchedule = {
  readonly fixture: BenchmarkFixture;
  readonly players: string[];
  /** Fixture inputs for every tick, keyed by the full roster. */
  readonly schedule: PlayerInput[][];
};

export function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(entry => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function positiveInteger(raw: string | undefined, fallback: number, max: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${label}: ${raw}`);
  return value;
}

export function snapshotRate(raw: string | undefined): SnapshotHz {
  if (raw === undefined) return 20;
  const value = Number(raw);
  if (!SUPPORTED_SNAPSHOT_HZ.includes(value as SnapshotHz)) {
    throw new Error(`Unsupported snapshot rate: ${raw}`);
  }
  return value as SnapshotHz;
}

export function tickModeArgument(raw: string | undefined): WsBenchmarkTickMode {
  if (raw === undefined) return 'interval';
  if (raw !== 'interval' && raw !== 'manual') throw new Error(`Invalid tick mode: ${raw}`);
  return raw;
}

/** Hang guard derived from the tick count, never a measured duration. */
export function defaultRunTimeoutMs(tickMode: WsBenchmarkTickMode, ticks: number): number {
  return tickMode === 'interval'
    ? RUN_TIMEOUT_BASE_MS + Math.ceil((ticks * 1000) / TICK_RATE)
    : RUN_TIMEOUT_BASE_MS + ticks * MANUAL_TICK_BUDGET_MS;
}

export function decodeFixtureSchedule(
  frames: readonly (readonly string[])[],
  players: readonly string[],
  ticks: number,
): PlayerInput[][] {
  if (frames.length !== MAX_TICKS) throw new Error('Invalid fixture');
  const schedule: PlayerInput[][] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const tickFrames = frames[tick];
    if (tickFrames.length !== 1) throw new Error('Invalid BASE fixture framing');
    const frame = decodeInputFrame(tickFrames[0]);
    if (frame.tick !== tick || frame.inputs.length !== players.length) throw new Error('Invalid fixture tick');
    for (const playerId of players) {
      if (!frame.inputs.some(input => input.playerId === playerId)) throw new Error('Invalid fixture roster');
    }
    schedule.push(frame.inputs);
  }
  return schedule;
}

/** The deterministic fixture slice every role drives for the same tick bound. */
export function loadWsBenchmarkSchedule(ticks: number): WsBenchmarkSchedule {
  return loadWsBenchmarkScheduleForPlayers(ticks, WS_BENCHMARK_PLAYER_COUNT);
}

export function loadWsBenchmarkScheduleForPlayers(ticks: number, playerCount: WsBenchmarkPlayerCount): WsBenchmarkSchedule {
  const players = wsBenchmarkRoster(playerCount);
  const fixture = generateFixture(wsBenchmarkScenarioId(playerCount));
  return {
    fixture,
    players: [...players],
    schedule: decodeFixtureSchedule(fixture.framesByTick, players, ticks),
  };
}

export type ReferenceFingerprints = {
  readonly finalTick: number;
  readonly finalStateSha256: string;
  readonly orderedEventsSha256: string;
};

/** In-memory BASE-4 reference for the same bounded range; no sockets involved. */
export function inMemoryReferenceFingerprints(ticks: number): ReferenceFingerprints {
  return inMemoryReferenceFingerprintsForPlayers(ticks, WS_BENCHMARK_PLAYER_COUNT);
}

export function inMemoryReferenceFingerprintsForPlayers(ticks: number, playerCount: WsBenchmarkPlayerCount): ReferenceFingerprints {
  const scenarioId = wsBenchmarkScenarioId(playerCount);
  const roster = wsBenchmarkRoster(playerCount);
  const fixture = generateFixture(scenarioId);
  const reference = new InMemoryBenchmarkAdapter();
  reference.connect({ scenarioId });
  reference.join([...roster]);
  for (let tick = 0; tick < ticks; tick++) reference.sendInput(fixture.framesByTick[tick][0]);
  const finalStateSha256 = sha256(encodeStateSnapshot(reference.observeSnapshot()));
  const orderedEventsSha256 = sha256(JSON.stringify(reference.observeEvents()));
  const finalTick = reference.observeState().tick;
  reference.close();
  return { finalTick, finalStateSha256, orderedEventsSha256 };
}
