import { createHash } from 'node:crypto';
import { MAX_PLAYERS_PER_FRAME, encodeInputFrame } from '../src/game/protocol/inputFrame';
import { MATCH_TICKS, TICK_RATE } from '../src/game/simulation/step';
import type { PlayerInput } from '../src/game/simulation/types';

/**
 * Scenario declarations for the transport-independent benchmark harness.
 *
 * Everything here is correctness metadata: no sockets, no wall-clock, no
 * simulated latency/jitter/loss and no measured performance. Impairment values
 * are configuration metadata that a future real adapter must apply and record;
 * the in-memory harness neither applies nor measures them.
 */
export const FIXTURE_SEED = 12345;
export const SCENARIO_VERSION = 1 as const;
export const BENCHMARK_SIMULATION_HZ = TICK_RATE;
export const BENCHMARK_MATCH_SECONDS = 120;
export const BENCHMARK_TICKS = MATCH_TICKS;

export type BenchmarkImpairment = {
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly lossPercent: number;
};

export type BenchmarkScenarioId =
  | 'BASE-4-60-20'
  | 'BASE-8-60-20'
  | 'RATE-4-30-10'
  | 'LAT-4-60-20-R60-L1'
  | 'JIT-4-60-20-R120-J30-L3'
  | 'FAIL-4-HOST-EXIT'
  | 'FAIL-4-RECONNECT'
  | 'NAT-4-TURN';

export type BenchmarkScenarioKind = 'simulation' | 'lifecycle' | 'transport-required';

export type BenchmarkScenario = {
  readonly id: BenchmarkScenarioId;
  readonly version: typeof SCENARIO_VERSION;
  readonly kind: BenchmarkScenarioKind;
  readonly players: number;
  readonly simulationHz: typeof BENCHMARK_SIMULATION_HZ;
  readonly inputHz: number;
  readonly snapshotHz: number;
  readonly matchSeconds: typeof BENCHMARK_MATCH_SECONDS;
  readonly ticks: typeof BENCHMARK_TICKS;
  readonly impairment: BenchmarkImpairment;
  readonly impairmentMode: 'configuration-metadata';
  readonly description: string;
  /** Explicit lifecycle ticks; absent for pure simulation scenarios. */
  readonly lifecycle?: {
    readonly hostExitTick?: number;
    readonly disconnectTick?: number;
    readonly reconnectTick?: number;
  };
};

/** Player counts the deterministic simulation fixture supports explicitly. */
export const SUPPORTED_PLAYER_COUNTS = [4, 8] as const;

const noImpairment: BenchmarkImpairment = { rttMs: 0, jitterMs: 0, lossPercent: 0 };

const scenarios: readonly BenchmarkScenario[] = [
  {
    id: 'BASE-4-60-20',
    version: SCENARIO_VERSION,
    kind: 'simulation',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: noImpairment,
    impairmentMode: 'configuration-metadata',
    description: 'Four-player 60 Hz input and 20 Hz snapshot correctness baseline.',
  },
  {
    id: 'BASE-8-60-20',
    version: SCENARIO_VERSION,
    kind: 'simulation',
    players: 8,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: noImpairment,
    impairmentMode: 'configuration-metadata',
    description: 'Eight-player exploratory roster; not an approved M1 product capacity.',
  },
  {
    id: 'RATE-4-30-10',
    version: SCENARIO_VERSION,
    kind: 'simulation',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 30,
    snapshotHz: 10,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: noImpairment,
    impairmentMode: 'configuration-metadata',
    description: 'Four players, 30 Hz input and 10 Hz snapshots over a 60 Hz simulation.',
  },
  {
    id: 'LAT-4-60-20-R60-L1',
    version: SCENARIO_VERSION,
    kind: 'simulation',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: { rttMs: 60, jitterMs: 0, lossPercent: 1 },
    impairmentMode: 'configuration-metadata',
    description: 'Declared 60 ms RTT and 1% loss metadata; not applied or measured in memory.',
  },
  {
    id: 'JIT-4-60-20-R120-J30-L3',
    version: SCENARIO_VERSION,
    kind: 'simulation',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: { rttMs: 120, jitterMs: 30, lossPercent: 3 },
    impairmentMode: 'configuration-metadata',
    description: 'Declared 120 ms RTT, 30 ms jitter and 3% loss metadata; not applied or measured.',
  },
  {
    id: 'FAIL-4-HOST-EXIT',
    version: SCENARIO_VERSION,
    kind: 'lifecycle',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: noImpairment,
    impairmentMode: 'configuration-metadata',
    description: 'Host connection disconnects at tick 3600; authority is revoked, not migrated.',
    lifecycle: { hostExitTick: 3600 },
  },
  {
    id: 'FAIL-4-RECONNECT',
    version: SCENARIO_VERSION,
    kind: 'lifecycle',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: noImpairment,
    impairmentMode: 'configuration-metadata',
    description: 'Player disconnects at tick 2400 and rejoins at 2460 under a new connection identity.',
    lifecycle: { disconnectTick: 2400, reconnectTick: 2460 },
  },
  {
    id: 'NAT-4-TURN',
    version: SCENARIO_VERSION,
    kind: 'transport-required',
    players: 4,
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60,
    snapshotHz: 20,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    ticks: BENCHMARK_TICKS,
    impairment: noImpairment,
    impairmentMode: 'configuration-metadata',
    description: 'Forced TURN relay comparison; requires a real WebRTC transport and is unavailable in memory.',
  },
];

export const BENCHMARK_SCENARIOS = scenarios;
export const BENCHMARK_SCENARIO_IDS = scenarios.map(scenario => scenario.id);

export function isBenchmarkScenarioId(value: unknown): value is BenchmarkScenarioId {
  return typeof value === 'string' && BENCHMARK_SCENARIO_IDS.includes(value as BenchmarkScenarioId);
}

/** Explicit failure for unknown or unsupported scenario IDs; never a silent fallback. */
export function requireScenario(scenarioId: unknown): BenchmarkScenario {
  if (!isBenchmarkScenarioId(scenarioId)) throw new Error('Unsupported benchmark scenario');
  return scenarios.find(scenario => scenario.id === scenarioId) as BenchmarkScenario;
}

/** Fails closed for any roster size the fixture generator does not define. */
export function createRoster(players: number): string[] {
  if (!SUPPORTED_PLAYER_COUNTS.includes(players as (typeof SUPPORTED_PLAYER_COUNTS)[number])) {
    throw new Error(`Unsupported benchmark player count: ${String(players)}`);
  }
  return Array.from({ length: players }, (_, index) => `P${index + 1}`);
}

export const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export function assertFixtureSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) throw new Error('Invalid fixture seed');
}

export type BenchmarkFixture = {
  readonly scenarioId: BenchmarkScenarioId;
  readonly scenarioVersion: typeof SCENARIO_VERSION;
  readonly seed: number;
  readonly players: number;
  readonly inputHz: number;
  readonly snapshotHz: number;
  readonly ticks: number;
  readonly matchSeconds: number;
  readonly impairment: BenchmarkImpairment;
  readonly impairmentMode: 'configuration-metadata';
  /** Canonical encoded frames in deterministic delivery order. */
  readonly frames: readonly string[];
  /** Frames scheduled for each simulation tick; empty means "no input message". */
  readonly framesByTick: readonly (readonly string[])[];
  readonly fixtureSha256: string;
};

function nextRandom(seed: number): number {
  let x = seed >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return x >>> 0;
}

function generateInput(value: number, playerId: string): PlayerInput {
  return {
    playerId,
    moveX: (value % 3 - 1) as -1 | 0 | 1,
    moveY: (Math.floor(value / 3) % 3 - 1) as -1 | 0 | 1,
    jump: value % 29 === 0,
    punch: value % 17 === 0,
    kick: value % 23 === 0,
    jumpkick: value % 37 === 0,
  };
}

function inputStride(scenario: BenchmarkScenario): number {
  if (BENCHMARK_SIMULATION_HZ % scenario.inputHz !== 0) {
    throw new Error(`Unsupported input rate for ${scenario.id}`);
  }
  return BENCHMARK_SIMULATION_HZ / scenario.inputHz;
}

/**
 * Deterministic canonical v1 fixture for one declared scenario.
 *
 * Simulation scenarios use one frame per `MAX_PLAYERS_PER_FRAME` slice. Since
 * the supported roster (eight) now fits one canonical frame, an eight-player
 * tick is a single message; four-player frames are unchanged. Lifecycle
 * scenarios use one frame per connection so the session envelope can wrap the
 * canonical payload unchanged.
 */
export function generateFixture(scenarioId: BenchmarkScenarioId, seed = FIXTURE_SEED): BenchmarkFixture {
  const scenario = requireScenario(scenarioId);
  if (scenario.kind === 'transport-required') {
    throw new Error(`Scenario ${scenario.id} requires a real transport adapter`);
  }
  assertFixtureSeed(seed);
  const roster = createRoster(scenario.players);
  const stride = inputStride(scenario);
  const framesByTick: string[][] = [];
  let random = seed >>> 0;

  for (let tick = 0; tick < scenario.ticks; tick++) {
    if (tick % stride !== 0) {
      framesByTick.push([]);
      continue;
    }
    const inputs = roster.map(playerId => {
      random = nextRandom(random);
      return generateInput(random, playerId);
    });
    if (scenario.kind === 'lifecycle') {
      framesByTick.push(inputs.map(input => encodeInputFrame({ version: 1, tick, inputs: [input] })));
      continue;
    }
    const frames: string[] = [];
    for (let index = 0; index < inputs.length; index += MAX_PLAYERS_PER_FRAME) {
      frames.push(encodeInputFrame({ version: 1, tick, inputs: inputs.slice(index, index + MAX_PLAYERS_PER_FRAME) }));
    }
    framesByTick.push(frames);
  }

  const frames = framesByTick.flat();
  return {
    scenarioId: scenario.id,
    scenarioVersion: SCENARIO_VERSION,
    seed,
    players: scenario.players,
    inputHz: scenario.inputHz,
    snapshotHz: scenario.snapshotHz,
    ticks: scenario.ticks,
    matchSeconds: scenario.matchSeconds,
    impairment: scenario.impairment,
    impairmentMode: 'configuration-metadata',
    frames,
    framesByTick,
    fixtureSha256: sha256(frames.join('\n')),
  };
}

/** Rejects altered, truncated or metadata-mismatched fixtures before replay. */
export function assertFixtureIntegrity(fixture: BenchmarkFixture): BenchmarkScenario {
  const scenario = requireScenario(fixture.scenarioId);
  if (scenario.kind === 'transport-required') throw new Error('Invalid fixture');
  if (fixture.scenarioVersion !== scenario.version || fixture.seed < 1 || fixture.seed > 0xffffffff ||
      !Number.isSafeInteger(fixture.seed) || fixture.players !== scenario.players ||
      fixture.inputHz !== scenario.inputHz || fixture.snapshotHz !== scenario.snapshotHz ||
      fixture.ticks !== scenario.ticks || fixture.matchSeconds !== scenario.matchSeconds ||
      fixture.impairmentMode !== 'configuration-metadata' ||
      JSON.stringify(fixture.impairment) !== JSON.stringify(scenario.impairment)) {
    throw new Error('Invalid fixture');
  }
  if (!Array.isArray(fixture.framesByTick) || fixture.framesByTick.length !== scenario.ticks ||
      !Array.isArray(fixture.frames) || fixture.frames.length === 0 ||
      fixture.framesByTick.flat().length !== fixture.frames.length ||
      fixture.framesByTick.flat().some((frame, index) => frame !== fixture.frames[index]) ||
      fixture.fixtureSha256 !== sha256(fixture.frames.join('\n'))) {
    throw new Error('Invalid fixture');
  }
  return scenario;
}
