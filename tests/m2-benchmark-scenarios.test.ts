import { describe, expect, it } from 'vitest';
import { decodeInputFrame, encodeInputFrame, neutralPlayerInput, MAX_PLAYERS_PER_FRAME } from '../src/game/protocol/inputFrame';
import { MAX_SNAPSHOT_FIGHTERS } from '../src/game/protocol/stateSnapshot';
import { InMemoryBenchmarkAdapter, replayScenario } from '../benchmarks/inMemory';
import { replayLifecycleScenario } from '../benchmarks/lifecycle';
import { NOT_MEASURED, createUnmeasuredManifest, validateManifest } from '../benchmarks/manifest';
import {
  BENCHMARK_SCENARIOS,
  BENCHMARK_TICKS,
  FIXTURE_SEED,
  createRoster,
  generateFixture,
  requireScenario,
  type BenchmarkFixture,
  type BenchmarkScenarioId,
} from '../benchmarks/scenarios';

const COMMIT = 'a'.repeat(40);
const SIMULATION_SCENARIOS: BenchmarkScenarioId[] = [
  'BASE-4-60-20',
  'BASE-8-60-20',
  'RATE-4-30-10',
  'LAT-4-60-20-R60-L1',
  'JIT-4-60-20-R120-J30-L3',
];

const manifestFor = (fixture: BenchmarkFixture) => {
  const replay = fixture.scenarioId.startsWith('FAIL-')
    ? replayLifecycleScenario(fixture).replay
    : replayScenario(fixture);
  return createUnmeasuredManifest(fixture, replay, COMMIT, `${fixture.scenarioId}-memory-001`);
};

describe('M2 benchmark scenario coverage', () => {
  it('declares every documented scenario with explicit roster, rate and impairment metadata', () => {
    expect(BENCHMARK_SCENARIOS.map(scenario => scenario.id)).toEqual([
      'BASE-4-60-20',
      'BASE-8-60-20',
      'RATE-4-30-10',
      'LAT-4-60-20-R60-L1',
      'JIT-4-60-20-R120-J30-L3',
      'FAIL-4-HOST-EXIT',
      'FAIL-4-RECONNECT',
      'NAT-4-TURN',
    ]);
    for (const scenario of BENCHMARK_SCENARIOS) {
      expect(scenario.version).toBe(1);
      expect(scenario.simulationHz).toBe(60);
      expect(scenario.ticks).toBe(BENCHMARK_TICKS);
      expect(scenario.ticks).toBe(7200);
      expect(scenario.matchSeconds).toBe(120);
      expect(scenario.impairmentMode).toBe('configuration-metadata');
      expect([4, 8]).toContain(scenario.players);
      for (const value of Object.values(scenario.impairment)) {
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    expect(requireScenario('BASE-8-60-20').players).toBe(8);
    expect(requireScenario('RATE-4-30-10').inputHz).toBe(30);
    expect(requireScenario('RATE-4-30-10').snapshotHz).toBe(10);
    expect(requireScenario('LAT-4-60-20-R60-L1').impairment).toEqual({ rttMs: 60, jitterMs: 0, lossPercent: 1 });
    expect(requireScenario('JIT-4-60-20-R120-J30-L3').impairment).toEqual({ rttMs: 120, jitterMs: 30, lossPercent: 3 });
    expect(requireScenario('FAIL-4-HOST-EXIT').lifecycle).toEqual({ hostExitTick: 3600 });
    expect(requireScenario('FAIL-4-RECONNECT').lifecycle).toEqual({ disconnectTick: 2400, reconnectTick: 2460 });
    // A transport-specific scenario must fail explicitly in memory.
    expect(requireScenario('NAT-4-TURN').kind).toBe('transport-required');
    expect(() => generateFixture('NAT-4-TURN')).toThrow(/real transport/);
    expect(() => requireScenario('BASE-6-60-20')).toThrow(/Unsupported benchmark scenario/);
  });

  it('generates deterministic, bounded fixtures and never silently resizes the roster', () => {
    const expectedFrames: Record<string, number> = {
      'BASE-4-60-20': 7200,
      'BASE-8-60-20': 7200,
      'RATE-4-30-10': 3600,
      'LAT-4-60-20-R60-L1': 7200,
      'JIT-4-60-20-R120-J30-L3': 7200,
    };
    for (const fixture of SIMULATION_SCENARIOS.map(id => generateFixture(id))) {
      expect(fixture.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.seed).toBe(FIXTURE_SEED);
      expect(fixture.frames).toHaveLength(expectedFrames[fixture.scenarioId]);
      expect(fixture.framesByTick).toHaveLength(7200);
      expect(fixture.framesByTick.flat()).toEqual(fixture.frames);
      expect(decodeInputFrame(fixture.frames[0]).tick).toBe(0);
      // No fixture may exceed the canonical frame cap.
      for (const tick of [0, 1, 3599, 7199]) {
        for (const frame of fixture.framesByTick[tick]) {
          expect(decodeInputFrame(frame).inputs.length).toBeLessThanOrEqual(MAX_PLAYERS_PER_FRAME);
        }
      }
      const again = generateFixture(fixture.scenarioId);
      expect(again.frames).toEqual(fixture.frames);
      expect(again.fixtureSha256).toBe(fixture.fixtureSha256);
    }
    // The independently recorded baseline fixture must not drift.
    expect(generateFixture('BASE-4-60-20').fixtureSha256)
      .toBe('7fddf007fc1910d9944d409864fad101e70d0956d864f60a700135f6205b1790');
    expect(generateFixture('BASE-4-60-20', FIXTURE_SEED + 1).fixtureSha256)
      .not.toBe(generateFixture('BASE-4-60-20').fixtureSha256);

    expect(createRoster(4)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(createRoster(8)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    for (const unsupported of [0, 1, 3, 5, 6, 7, 9]) {
      expect(() => createRoster(unsupported)).toThrow(/Unsupported benchmark player count/);
    }
    expect(() => generateFixture('BASE-6-60-20' as BenchmarkScenarioId)).toThrow();
    expect(() => generateFixture('BASE-4-60-20', 0)).toThrow(/seed/);
  });

  it('replays every simulation scenario twice to identical bounded fingerprints', () => {
    for (const id of SIMULATION_SCENARIOS) {
      const fixture = generateFixture(id);
      const first = replayScenario(fixture);
      const second = replayScenario(fixture);
      expect(first).toEqual(second);
      expect(first.finalTick).toBe(7200);
      expect(first.result).toBe(NOT_MEASURED);
      expect(first.players).toBe(fixture.players);
      expect(first.finalStateSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(first.orderedEventsSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(first.lifecycleSha256).toBeNull();
      expect(first.finalStateEncoding).toBe(
        fixture.players <= MAX_SNAPSHOT_FIGHTERS ? 'state-snapshot-v1' : 'harness-state-json-v1',
      );
      // Every supported roster (4 and 8) now fits the snapshot codec.
      expect(first.finalStateEncoding).toBe('state-snapshot-v1');
    }
  });

  it('records impairment as metadata only: LAT/JIT reuse the deterministic base frame stream', () => {
    const base = replayScenario(generateFixture('BASE-4-60-20'));
    for (const id of ['LAT-4-60-20-R60-L1', 'JIT-4-60-20-R120-J30-L3'] as const) {
      const fixture = generateFixture(id);
      expect(fixture.fixtureSha256).toBe(generateFixture('BASE-4-60-20').fixtureSha256);
      const replay = replayScenario(fixture);
      expect(replay.finalStateSha256).toBe(base.finalStateSha256);
      expect(replay.orderedEventsSha256).toBe(base.orderedEventsSha256);
      expect(requireScenario(id).impairment).not.toEqual(requireScenario('BASE-4-60-20').impairment);
    }
  });

  it('carries a full eight-player tick in one canonical frame', () => {
    const fixture = generateFixture('BASE-8-60-20');
    const adapter = new InMemoryBenchmarkAdapter();
    adapter.connect({ scenarioId: 'BASE-8-60-20' });
    adapter.join(createRoster(8));
    const [first] = fixture.framesByTick[0];
    expect(decodeInputFrame(first).inputs).toHaveLength(8);

    adapter.sendInput(first);
    expect(adapter.observeState().tick).toBe(1);
    expect(() => adapter.sendInput(first)).toThrow(/Non-contiguous/);
    // A denied mixed frame must not stage its authorized player.
    expect(() => adapter.sendInput(encodeInputFrame({
      version: 1, tick: 1,
      inputs: [neutralPlayerInput('P1'), neutralPlayerInput('P9')],
    }))).toThrow(/Unauthorized/);
    expect(() => adapter.sendInput(encodeInputFrame({
      version: 1, tick: 1, inputs: [neutralPlayerInput('P1')],
    }))).not.toThrow();
    expect(() => adapter.advanceTick()).toThrow(/Incomplete/);
    adapter.sendInput(encodeInputFrame({
      version: 1, tick: 1,
      inputs: ['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map(neutralPlayerInput),
    }));
    expect(adapter.observeState().tick).toBe(2);
    // The cap now covers a full roster, so the canonical snapshot encodes.
    expect(adapter.observeSnapshot().state.fighters).toHaveLength(8);
    adapter.close();

    const short = new InMemoryBenchmarkAdapter();
    short.connect({ scenarioId: 'BASE-8-60-20' });
    expect(() => short.join(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])).toThrow(/Invalid benchmark roster/);
    expect(() => short.join(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'])).toThrow(/Invalid benchmark roster/);
    short.close();
    const rejected = new InMemoryBenchmarkAdapter();
    expect(() => rejected.connect({ scenarioId: 'FAIL-4-HOST-EXIT' })).toThrow(/lifecycle/);
  });

  it('revokes host authority without migration and rejects stale host input', () => {
    const fixture = generateFixture('FAIL-4-HOST-EXIT');
    const first = replayLifecycleScenario(fixture);
    const second = replayLifecycleScenario(fixture);
    expect(first.replay).toEqual(second.replay);
    expect(first.outcome).toEqual(second.outcome);
    expect(first.replay.finalTick).toBe(7200);
    expect(first.replay.lifecycleSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.replay.result).toBe(NOT_MEASURED);
    expect(first.outcome).toMatchObject({
      scenarioId: 'FAIL-4-HOST-EXIT',
      hostAuthority: 'not-transferred',
      authoritySuccessor: null,
      revokedSlots: ['P1'],
      reconnectedConnectionId: null,
      neutralPlayerTicks: 3600,
    });
    expect(first.outcome.denials).toEqual([
      { tick: 3600, connectionId: 'conn-1', code: 'not-joined' },
      { tick: 3600, connectionId: 'conn-2', code: 'already-joined' },
    ]);
  });

  it('treats reconnect as a fresh join and rejects old ownership and replay', () => {
    const fixture = generateFixture('FAIL-4-RECONNECT');
    const first = replayLifecycleScenario(fixture);
    const second = replayLifecycleScenario(fixture);
    expect(first.replay).toEqual(second.replay);
    expect(first.outcome).toEqual(second.outcome);
    expect(first.replay.finalTick).toBe(7200);
    expect(first.replay.result).toBe(NOT_MEASURED);
    expect(first.outcome).toMatchObject({
      scenarioId: 'FAIL-4-RECONNECT',
      hostAuthority: 'not-transferred',
      authoritySuccessor: null,
      revokedSlots: ['P2'],
      reconnectedConnectionId: 'conn-2-b',
      neutralPlayerTicks: 60,
    });
    expect(first.outcome.denials).toEqual([
      { tick: 2400, connectionId: 'conn-2', code: 'not-joined' },
      { tick: 2460, connectionId: 'conn-2-b', code: 'not-joined' },
      { tick: 2460, connectionId: 'conn-2', code: 'not-joined' },
    ]);
  });
});

describe('M2 benchmark scenario manifests', () => {
  it('validates eight-player, impairment and lifecycle manifests as NOT_MEASURED', () => {
    for (const id of ['BASE-8-60-20', 'JIT-4-60-20-R120-J30-L3'] as const) {
      const manifest = manifestFor(generateFixture(id));
      validateManifest(JSON.parse(JSON.stringify(manifest)) as unknown);
      expect(manifest.result).toBe(NOT_MEASURED);
      expect(manifest.players).toBe(requireScenario(id).players);
      expect(manifest.localSlotsPerClient).toEqual(Array.from({ length: manifest.players }, () => 1));
      expect(manifest.impairment).toEqual(requireScenario(id).impairment);
      expect(manifest.environment).toEqual({
        network: 'in-process',
        os: NOT_MEASURED,
        browser: NOT_MEASURED,
        cpu: NOT_MEASURED,
        turn: false,
      });
    }

    for (const id of ['FAIL-4-HOST-EXIT', 'FAIL-4-RECONNECT'] as const) {
      const manifest = manifestFor(generateFixture(id));
      validateManifest(JSON.parse(JSON.stringify(manifest)) as unknown);
      expect(manifest.result).toBe(NOT_MEASURED);
      expect(manifest.replay.lifecycleSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.replay.finalTick).toBe(7200);
    }
  });

  it('rejects rosters, rates, impairment and replay encodings that do not match the scenario', () => {
    const base = manifestFor(generateFixture('BASE-8-60-20'));
    expect(() => validateManifest({ ...base, players: 4 })).toThrow();
    expect(() => validateManifest({
      ...base,
      localSlotsPerClient: [1, 1, 1, 1],
    })).toThrow();
    expect(() => validateManifest({ ...base, inputHz: 30 })).toThrow();
    expect(() => validateManifest({ ...base, snapshotHz: 10 })).toThrow();
    expect(() => validateManifest({ ...base, scenarioId: 'BASE-6-60-20' })).toThrow();
    expect(() => validateManifest({ ...base, impairment: { rttMs: 1, jitterMs: 0, lossPercent: 0 } })).toThrow();
    expect(() => validateManifest({
      ...base,
      replay: { ...base.replay, finalStateEncoding: 'harness-state-json-v1' },
    })).toThrow();
    expect(() => validateManifest({ ...base, result: 0 })).toThrow();

    const jitter = manifestFor(generateFixture('JIT-4-60-20-R120-J30-L3'));
    expect(() => validateManifest({
      ...jitter,
      impairment: { rttMs: 0, jitterMs: 0, lossPercent: 0 },
    })).toThrow();
    expect(() => validateManifest({
      ...jitter,
      replay: { ...jitter.replay, impairment: { rttMs: 0, jitterMs: 0, lossPercent: 0 } },
    })).toThrow();

    const hostExit = manifestFor(generateFixture('FAIL-4-HOST-EXIT'));
    expect(() => validateManifest({
      ...hostExit,
      replay: { ...hostExit.replay, lifecycleSha256: null },
    })).toThrow();
    expect(() => validateManifest({
      ...hostExit,
      impairmentMode: 'measured',
    })).toThrow();
  });
});
