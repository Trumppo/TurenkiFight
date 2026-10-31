import { createHash } from 'node:crypto';
import { createState, step, MATCH_TICKS, TICK_RATE } from '../src/game/simulation/step';
import { decodeInputFrame, encodeInputFrame, type InputFrame } from '../src/game/protocol/inputFrame';
import { encodeStateSnapshot, type StateSnapshot } from '../src/game/protocol/stateSnapshot';
import type { GameEvent, GameState, PlayerInput } from '../src/game/simulation/types';

/** No sockets, wall-clock or external randomness. A 4-player 60 Hz baseline only. */
export const BASELINE_SCENARIO = 'BASE-4-60-20' as const;
export const FIXTURE_SEED = 12345;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function nextRandom(seed: number): number {
  let x = seed >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return x >>> 0;
}

export type BenchmarkFixture = {
  scenarioId: typeof BASELINE_SCENARIO;
  seed: number;
  frames: string[];
  fixtureSha256: string;
};

/** Canonical encoded frames are shared unchanged by all future adapters. */
export function generateBaselineFixture(seed = FIXTURE_SEED): BenchmarkFixture {
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) throw new Error('Invalid fixture seed');
  const frames: string[] = [];
  let random = seed >>> 0;
  for (let tick = 0; tick < MATCH_TICKS; tick++) {
    const inputs: PlayerInput[] = [];
    for (let slot = 1; slot <= 4; slot++) {
      random = nextRandom(random);
      const value = random;
      inputs.push({
        playerId: 'P' + slot,
        moveX: (value % 3 - 1) as -1 | 0 | 1,
        moveY: (Math.floor(value / 3) % 3 - 1) as -1 | 0 | 1,
        jump: value % 29 === 0,
        punch: value % 17 === 0,
        kick: value % 23 === 0,
        jumpkick: value % 37 === 0,
      });
    }
    frames.push(encodeInputFrame({ version: 1, tick, inputs }));
  }
  return { scenarioId: BASELINE_SCENARIO, seed, frames, fixtureSha256: sha256(frames.join('\n')) };
}

export type BenchmarkConnection = { scenarioId: typeof BASELINE_SCENARIO };
export interface BenchmarkAdapter {
  connect(config: BenchmarkConnection): void;
  join(slots: readonly string[]): void;
  sendInput(encodedCanonicalFrame: string): void;
  observeSnapshot(): StateSnapshot;
  observeEvents(): readonly GameEvent[];
  disconnect(playerId: string): void;
  close(): void;
}

/** In-memory authority boundary: no transport claims, latency or real authentication. */
export class InMemoryBenchmarkAdapter implements BenchmarkAdapter {
  private state: GameState | null = null;
  private owners = new Set<string>();
  private events: GameEvent[] = [];
  private connected = false;
  connect(config: BenchmarkConnection): void {
    if (this.connected || config.scenarioId !== BASELINE_SCENARIO) throw new Error('Invalid benchmark connection');
    this.connected = true;
    this.state = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
    this.owners.clear();
    this.events = [];
  }
  join(slots: readonly string[]): void {
    if (!this.connected || !this.state || slots.length !== 4 ||
        new Set(slots).size !== 4 || !['P1','P2','P3','P4'].every(id => slots.includes(id))) {
      throw new Error('Invalid benchmark roster');
    }
    this.owners = new Set(slots);
  }
  sendInput(encodedCanonicalFrame: string): void {
    if (!this.connected || !this.state || this.owners.size === 0) throw new Error('Benchmark not joined');
    const frame: InputFrame = decodeInputFrame(encodedCanonicalFrame);
    if (frame.tick !== this.state.tick) throw new Error('Non-contiguous benchmark tick');
    if (frame.inputs.some(input => !this.owners.has(input.playerId))) throw new Error('Unauthorized benchmark input');
    this.state = step(this.state, frame.inputs);
    this.events.push(...this.state.events);
  }
  observeSnapshot(): StateSnapshot {
    if (!this.connected || !this.state) throw new Error('Benchmark not connected');
    const snapshot: StateSnapshot = { version: 1, state: this.state };
    return JSON.parse(encodeStateSnapshot(snapshot)) as StateSnapshot;
  }
  observeEvents(): readonly GameEvent[] { return this.events.map(event => ({ ...event })); }
  disconnect(playerId: string): void {
    if (!this.connected || !this.owners.delete(playerId)) throw new Error('Unknown benchmark slot');
  }
  close(): void { this.connected = false; this.state = null; this.owners.clear(); this.events = []; }
}

export type BenchmarkReplay = {
  scenarioId: typeof BASELINE_SCENARIO;
  seed: number;
  fixtureSha256: string;
  finalStateSha256: string;
  orderedEventsSha256: string;
  finalTick: number;
  result: 'NOT_MEASURED';
};

/** Correctness fingerprints, not network or performance measurements. */
export function replayBaseline(fixture: BenchmarkFixture, adapter: BenchmarkAdapter = new InMemoryBenchmarkAdapter()): BenchmarkReplay {
  if (fixture.scenarioId !== BASELINE_SCENARIO || fixture.frames.length !== MATCH_TICKS ||
      fixture.fixtureSha256 !== sha256(fixture.frames.join('\n'))) throw new Error('Invalid fixture');
  adapter.connect({ scenarioId: BASELINE_SCENARIO });
  try {
    adapter.join(['P1','P2','P3','P4']);
    for (const frame of fixture.frames) adapter.sendInput(frame);
    const snapshot = adapter.observeSnapshot();
    const events = adapter.observeEvents();
    if (snapshot.state.tick !== MATCH_TICKS || snapshot.state.phase !== 'results') throw new Error('Incomplete match');
    return {
      scenarioId: BASELINE_SCENARIO, seed: fixture.seed, fixtureSha256: fixture.fixtureSha256,
      finalStateSha256: sha256(encodeStateSnapshot(snapshot)),
      orderedEventsSha256: sha256(JSON.stringify(events)),
      finalTick: snapshot.state.tick, result: 'NOT_MEASURED',
    };
  } finally { adapter.close(); }
}

export const BENCHMARK_SIMULATION_HZ = TICK_RATE;
