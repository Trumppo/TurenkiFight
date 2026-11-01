import { createState, step, MATCH_TICKS } from '../src/game/simulation/step';
import { decodeInputFrame } from '../src/game/protocol/inputFrame';
import { MAX_SNAPSHOT_FIGHTERS, encodeStateSnapshot, type StateSnapshot } from '../src/game/protocol/stateSnapshot';
import type { GameEvent, GameState, PlayerInput } from '../src/game/simulation/types';
import {
  FIXTURE_SEED,
  assertFixtureIntegrity,
  createRoster,
  generateFixture,
  requireScenario,
  sha256,
  type BenchmarkFixture,
  type BenchmarkImpairment,
  type BenchmarkScenarioId,
} from './scenarios';

export {
  BENCHMARK_SIMULATION_HZ,
  BENCHMARK_TICKS,
  FIXTURE_SEED,
  SCENARIO_VERSION,
  type BenchmarkFixture,
  type BenchmarkImpairment,
  type BenchmarkScenario,
  type BenchmarkScenarioId,
} from './scenarios';

/** @deprecated Prefer `requireScenario('BASE-4-60-20')`; kept for existing imports. */
export const BASELINE_SCENARIO = 'BASE-4-60-20' as const;

export type BenchmarkConnection = { scenarioId: BenchmarkScenarioId };

export interface BenchmarkAdapter {
  connect(config: BenchmarkConnection): void;
  join(slots: readonly string[]): void;
  /**
   * Delivers one canonical frame for the current tick. Multi-slice rosters
   * advance only when every roster player has supplied input for that tick.
   */
  sendInput(encodedCanonicalFrame: string): void;
  /** Advances one authoritative tick with neutral input (rate-limited fixtures). */
  advanceTick(): void;
  /**
   * Canonical v1 snapshot. The protocol codec caps a snapshot at four
   * fighters, so eight-player scenarios must inspect `observeState` instead.
   */
  observeSnapshot(): StateSnapshot;
  /** Deterministic raw state for hashing; not a protocol message. */
  observeState(): GameState;
  observeEvents(): readonly GameEvent[];
  disconnect(playerId: string): void;
  close(): void;
}

/** Canonical encoded frames are shared unchanged by all future adapters. */
export function generateBaselineFixture(seed = FIXTURE_SEED): BenchmarkFixture {
  return generateFixture(BASELINE_SCENARIO, seed);
}

/**
 * In-memory authority boundary: no transport claims, latency or real
 * authentication. Deterministic input assembly only; impairment metadata is
 * never applied here.
 */
export class InMemoryBenchmarkAdapter implements BenchmarkAdapter {
  private state: GameState | null = null;
  private roster: readonly string[] = [];
  private owners = new Set<string>();
  private pending = new Map<string, PlayerInput>();
  private events: GameEvent[] = [];
  private connected = false;

  connect(config: BenchmarkConnection): void {
    if (this.connected) throw new Error('Invalid benchmark connection');
    const scenario = requireScenario(config?.scenarioId);
    if (scenario.kind !== 'simulation') {
      throw new Error(`Scenario ${scenario.id} requires the lifecycle scenario runner`);
    }
    this.connected = true;
    this.roster = createRoster(scenario.players);
    this.state = createState([...this.roster], 'fighting');
    this.owners.clear();
    this.pending.clear();
    this.events = [];
  }

  join(slots: readonly string[]): void {
    if (!this.connected || !this.state) throw new Error('Benchmark not connected');
    if (!Array.isArray(slots) || slots.length !== this.roster.length ||
        new Set(slots).size !== this.roster.length ||
        !this.roster.every(playerId => slots.includes(playerId))) {
      throw new Error('Invalid benchmark roster');
    }
    this.owners = new Set(slots);
  }

  sendInput(encodedCanonicalFrame: string): void {
    if (!this.connected || !this.state || this.owners.size === 0) throw new Error('Benchmark not joined');
    if (this.state.tick >= MATCH_TICKS) throw new Error('Benchmark match complete');
    const frame = decodeInputFrame(encodedCanonicalFrame);
    if (frame.tick !== this.state.tick) throw new Error('Non-contiguous benchmark tick');
    if (frame.inputs.length === 0) throw new Error('Empty benchmark frame; use advanceTick');
    // Validate the whole frame before mutating, matching the session ingress
    // atomicity rule: a denied frame must not leave partial input staged.
    for (const input of frame.inputs) {
      if (!this.owners.has(input.playerId)) throw new Error('Unauthorized benchmark input');
      if (this.pending.has(input.playerId)) throw new Error('Duplicate benchmark input');
    }
    for (const input of frame.inputs) this.pending.set(input.playerId, input);
    if (this.pending.size === this.roster.length) this.commitTick();
  }

  advanceTick(): void {
    if (!this.connected || !this.state) throw new Error('Benchmark not connected');
    if (this.pending.size !== 0) throw new Error('Incomplete benchmark tick');
    if (this.state.tick >= MATCH_TICKS) throw new Error('Benchmark match complete');
    this.commitTick();
  }

  observeSnapshot(): StateSnapshot {
    if (!this.connected || !this.state) throw new Error('Benchmark not connected');
    const snapshot: StateSnapshot = { version: 1, state: this.state };
    return JSON.parse(encodeStateSnapshot(snapshot)) as StateSnapshot;
  }

  observeState(): GameState {
    if (!this.connected || !this.state) throw new Error('Benchmark not connected');
    return JSON.parse(JSON.stringify(this.state)) as GameState;
  }

  observeEvents(): readonly GameEvent[] { return this.events.map(event => ({ ...event })); }

  disconnect(playerId: string): void {
    if (!this.connected || !this.owners.delete(playerId)) throw new Error('Unknown benchmark slot');
    this.pending.delete(playerId);
  }

  close(): void {
    this.connected = false;
    this.state = null;
    this.roster = [];
    this.owners.clear();
    this.pending.clear();
    this.events = [];
  }

  private commitTick(): void {
    if (!this.state) throw new Error('Benchmark not connected');
    const inputs = [...this.roster]
      .filter(playerId => this.pending.has(playerId))
      .map(playerId => this.pending.get(playerId) as PlayerInput);
    this.state = step(this.state, inputs);
    this.events.push(...this.state.events);
    this.pending.clear();
  }
}

export type BenchmarkStateEncoding = 'state-snapshot-v1' | 'harness-state-json-v1';

export type BenchmarkReplay = {
  scenarioId: BenchmarkScenarioId;
  scenarioVersion: 1;
  players: number;
  inputHz: number;
  snapshotHz: number;
  impairment: BenchmarkImpairment;
  seed: number;
  fixtureSha256: string;
  finalStateSha256: string;
  /** How the final state was serialized before hashing. */
  finalStateEncoding: BenchmarkStateEncoding;
  orderedEventsSha256: string;
  /** Present only for lifecycle scenarios; null for pure simulation replays. */
  lifecycleSha256: string | null;
  finalTick: number;
  result: 'NOT_MEASURED';
};

/**
 * Correctness fingerprints, not network or performance measurements. The
 * fixture's scheduled messages drive the adapter tick by tick; ticks without a
 * scheduled input are advanced with neutral input.
 */
export function replayScenario(
  fixture: BenchmarkFixture,
  adapter: BenchmarkAdapter = new InMemoryBenchmarkAdapter(),
): BenchmarkReplay {
  const scenario = assertFixtureIntegrity(fixture);
  if (scenario.kind !== 'simulation') {
    throw new Error(`Scenario ${scenario.id} requires replayLifecycleScenario`);
  }
  adapter.connect({ scenarioId: scenario.id });
  try {
    adapter.join(createRoster(scenario.players));
    for (let tick = 0; tick < scenario.ticks; tick++) {
      const frames = fixture.framesByTick[tick];
      if (frames.length === 0) {
        adapter.advanceTick();
      } else {
        for (const frame of frames) adapter.sendInput(frame);
      }
    }
    return replayResult(fixture, adapter, null);
  } finally {
    adapter.close();
  }
}

/** @deprecated Prefer `replayScenario`; kept for existing imports. */
export function replayBaseline(
  fixture: BenchmarkFixture,
  adapter: BenchmarkAdapter = new InMemoryBenchmarkAdapter(),
): BenchmarkReplay {
  if (fixture.scenarioId !== BASELINE_SCENARIO) throw new Error('Invalid fixture');
  return replayScenario(fixture, adapter);
}

export function replayResult(
  fixture: BenchmarkFixture,
  adapter: BenchmarkAdapter,
  lifecycleSha256: string | null,
): BenchmarkReplay {
  const state = adapter.observeState();
  if (state.tick !== fixture.ticks || state.phase !== 'results') throw new Error('Incomplete match');
  // The canonical v1 snapshot codec intentionally caps a snapshot at four
  // fighters. Eight-player exploration therefore hashes the deterministic raw
  // state and reports the encoding instead of silently exceeding the protocol.
  const finalStateEncoding: BenchmarkStateEncoding =
    fixture.players <= MAX_SNAPSHOT_FIGHTERS ? 'state-snapshot-v1' : 'harness-state-json-v1';
  const finalStateSha256 = finalStateEncoding === 'state-snapshot-v1'
    ? sha256(encodeStateSnapshot(adapter.observeSnapshot()))
    : sha256(JSON.stringify(state));
  return {
    scenarioId: fixture.scenarioId,
    scenarioVersion: fixture.scenarioVersion,
    players: fixture.players,
    inputHz: fixture.inputHz,
    snapshotHz: fixture.snapshotHz,
    impairment: fixture.impairment,
    seed: fixture.seed,
    fixtureSha256: fixture.fixtureSha256,
    finalStateSha256,
    finalStateEncoding,
    orderedEventsSha256: sha256(JSON.stringify(adapter.observeEvents())),
    lifecycleSha256,
    finalTick: state.tick,
    result: 'NOT_MEASURED',
  };
}
