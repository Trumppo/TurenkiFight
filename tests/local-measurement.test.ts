import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_NOT_MEASURED,
  createLocalManifest,
  snapshotSampleCount,
  validateLocalManifest,
  type LocalMeasurementSections,
  type LocalProvenance,
} from '../benchmarks/local/manifest';
import { runLocalMeasurement } from '../benchmarks/local/measure';
import { hasUnignoredWorkingTreeChanges, readWorkingTree } from '../benchmarks/local/provenance';
import { summarizeBytes, summarizeSamples } from '../benchmarks/local/statistics';
import { summaryFileText, writeSummaryFile } from '../benchmarks/local/summary';

/**
 * These tests are deliberately non-vacuous:
 * - the statistics layer rejects empty and non-numeric samples;
 * - the schema rejects missing, substituted or unordered numbers;
 * - network fields cannot be claimed by any numeric value;
 * - two fresh local runs have identical byte results and the same shape, while
 *   timing values are only checked for validity (not for a machine constant).
 */

type Loose = Record<string, any>;

const TEST_TICKS = 600;
const TEST_WARMUP = 60;

async function sections(): Promise<LocalMeasurementSections> {
  return runLocalMeasurement({ ticks: TEST_TICKS, warmupTicks: TEST_WARMUP, eventLoopTicks: 0 });
}

function provenanceFor(run: LocalMeasurementSections): LocalProvenance {
  return {
    command: 'npm run measure:local',
    cliArguments: ['--ticks=600'],
    nodeVersion: process.version,
    platform: 'test-platform',
    osRelease: 'test-release',
    architecture: 'test-arch',
    cpuModel: 'test cpu',
    logicalCores: 4,
    gitCommitSha: 'a'.repeat(40),
    workingTreeDirty: true,
    dirtyExclusions: ['benchmarks/results/'],
    fixtureSha256: run.fixture.fixtureSha256,
    seed: run.fixture.seed,
    measuredTicks: TEST_TICKS,
    warmupTicks: TEST_WARMUP,
    warmupPolicy: 'discarded-separate-state-replay',
    snapshotRatesHz: [10, 20, 30],
    codecVersions: {
      inputFrame: 1,
      stateSnapshot: 1,
      sessionEnvelope: 1,
      wsServerMessage: 1,
    },
  };
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(entry => shape(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, shape((value as Record<string, unknown>)[key])]),
    );
  }
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function expectOrdered(distribution: {
  min: number; mean: number; p50: number; p95: number; p99: number; max: number;
}): void {
  expect(Number.isFinite(distribution.mean)).toBe(true);
  expect(distribution.min).toBeLessThanOrEqual(distribution.p50);
  expect(distribution.p50).toBeLessThanOrEqual(distribution.p95);
  expect(distribution.p95).toBeLessThanOrEqual(distribution.p99);
  expect(distribution.p99).toBeLessThanOrEqual(distribution.max);
  expect(distribution.mean).toBeGreaterThanOrEqual(distribution.min);
  expect(distribution.mean).toBeLessThanOrEqual(distribution.max);
}

describe('local measurement statistics', () => {
  it('rejects absent, non-numeric, negative and fractional samples', () => {
    expect(() => summarizeSamples([], 'microseconds')).toThrow(/empty sample set/);
    expect(() => summarizeSamples([1, Number.NaN], 'microseconds')).toThrow(/finite/);
    expect(() => summarizeSamples([1, Number.POSITIVE_INFINITY], 'microseconds')).toThrow(/finite/);
    expect(() => summarizeSamples([-1, 2], 'microseconds')).toThrow(/non-negative/);
    expect(() => summarizeBytes([])).toThrow(/empty sample set/);
    expect(() => summarizeBytes([1, Number.NaN])).toThrow(/finite/);
    expect(() => summarizeBytes([1, 2.5])).toThrow(/positive safe integers/);
    expect(() => summarizeBytes([1, 0])).toThrow(/positive safe integers/);
    expect(() => summarizeBytes([1, Number.NaN])).toThrow(/finite/);
  });

  it('uses nearest-rank percentiles and keeps byte means exact', () => {
    const durations = summarizeSamples([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 'microseconds');
    expect(durations.sampleCount).toBe(10);
    expect(durations.min).toBe(1);
    expect(durations.p50).toBe(5);
    expect(durations.p95).toBe(10);
    expect(durations.p99).toBe(10);
    expect(durations.max).toBe(10);
    expect(durations.mean).toBe(5.5);

    const bytes = summarizeBytes([10, 20, 30]);
    expect(bytes).toEqual({ unit: 'bytes', sampleCount: 3, min: 10, mean: 20, max: 30 });
  });

  it('derives the documented snapshot sample counts', () => {
    expect(snapshotSampleCount(7200, 10)).toBe(1200);
    expect(snapshotSampleCount(7200, 20)).toBe(2400);
    expect(snapshotSampleCount(7200, 30)).toBe(3600);
    expect(snapshotSampleCount(600, 20)).toBe(200);
  });
});

describe('working tree provenance', () => {
  it('ignores only generated result paths and never a source change', () => {
    expect(hasUnignoredWorkingTreeChanges('')).toBe(false);
    expect(hasUnignoredWorkingTreeChanges('?? benchmarks/results/local-a.json\n')).toBe(false);
    expect(hasUnignoredWorkingTreeChanges(' M benchmarks/results/local-a.json\n')).toBe(false);
    expect(hasUnignoredWorkingTreeChanges('?? benchmarks/results/\n')).toBe(false);
    expect(hasUnignoredWorkingTreeChanges(
      'R  benchmarks/results/old.json -> benchmarks/results/new.json\n',
    )).toBe(false);

    // Any path outside the generated-output directory still marks the run dirty.
    expect(hasUnignoredWorkingTreeChanges(' M src/game/protocol/inputFrame.ts\n')).toBe(true);
    expect(hasUnignoredWorkingTreeChanges(' M src/game/simulation/step.ts\n')).toBe(true);
    expect(hasUnignoredWorkingTreeChanges('?? benchmarks/results-other/local.json\n')).toBe(true);
    // A rename must exclude both sides; moving source into results still counts.
    expect(hasUnignoredWorkingTreeChanges(
      'R  src/game/x.ts -> benchmarks/results/x.ts\n',
    )).toBe(true);
    expect(hasUnignoredWorkingTreeChanges(
      '?? benchmarks/results/local-a.json\r\n M src/game/simulation/step.ts\r\n',
    )).toBe(true);
  });

  it('reads a real repository: result outputs are clean, source edits are dirty', () => {
    const directory = mkdtempSync(joinPath(tmpdir(), 'turenkifight-dirty-'));
    const runGit = (...args: string[]): void => {
      execFileSync('git', [
        '-c', 'user.name=Local Measurement Test',
        '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false',
        ...args,
      ], { cwd: directory, stdio: 'ignore' });
    };
    try {
      runGit('init');
      mkdirSync(joinPath(directory, 'benchmarks', 'results'), { recursive: true });
      mkdirSync(joinPath(directory, 'src', 'game'), { recursive: true });
      writeFileSync(joinPath(directory, 'src', 'game', 'step.ts'), 'export const value = 1;\n');
      writeFileSync(joinPath(directory, 'benchmarks', 'results', 'README.md'), '# results\n');
      runGit('add', '.');
      runGit('commit', '-m', 'base');

      expect(readWorkingTree(directory)).toMatchObject({
        workingTreeDirty: false,
        dirtyExclusions: ['benchmarks/results/'],
      });

      // An untracked generated result must not dirty the run.
      writeFileSync(joinPath(directory, 'benchmarks', 'results', 'local-test.json'), '{}\n');
      expect(readWorkingTree(directory).workingTreeDirty).toBe(false);

      // A modified tracked result must not dirty the run either.
      writeFileSync(joinPath(directory, 'benchmarks', 'results', 'README.md'), '# results\nedited\n');
      expect(readWorkingTree(directory).workingTreeDirty).toBe(false);

      // A modified simulation source file must dirty it.
      writeFileSync(joinPath(directory, 'src', 'game', 'step.ts'), 'export const value = 2;\n');
      expect(readWorkingTree(directory).workingTreeDirty).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('local measurement manifest', () => {
  it('writes exactly one trailing newline and no blank line at EOF', async () => {
    const run = await sections();
    const manifest = createLocalManifest({
      runId: 'local-summary-1',
      provenance: provenanceFor(run),
      sections: run,
    });
    const text = summaryFileText(manifest);
    expect(text).toContain('# Single-machine local measurement `local-summary-1`');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);

    const directory = mkdtempSync(joinPath(tmpdir(), 'turenkifight-summary-'));
    try {
      const path = joinPath(directory, 'local-summary-1.md');
      writeSummaryFile(path, manifest);
      const written = readFileSync(path, 'utf8');
      expect(written).toBe(text);
      expect(written.endsWith('\n')).toBe(true);
      expect(written.endsWith('\n\n')).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records local numbers with network fields untouched and rejects every network claim', async () => {
    const run = await sections();
    const manifest = createLocalManifest({
      runId: 'local-test-1',
      provenance: provenanceFor(run),
      sections: run,
    });
    expect(() => validateLocalManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
    expect(manifest.scope).toEqual({
      measurement: 'single-machine',
      networkAccess: 'none',
      transportSelection: 'NOT_A_TRANSPORT_DECISION',
    });
    expect(manifest.network).toEqual({
      latency: LOCAL_NOT_MEASURED,
      jitter: LOCAL_NOT_MEASURED,
      packetLoss: LOCAL_NOT_MEASURED,
      joinSuccess: LOCAL_NOT_MEASURED,
      turnCost: LOCAL_NOT_MEASURED,
      bandwidth: LOCAL_NOT_MEASURED,
      measuredNetworks: 0,
    });

    const clone = (): Loose => JSON.parse(JSON.stringify(manifest)) as Loose;
    const networkClaims: Array<(value: Loose) => void> = [
      value => { value.network.latency = 12; },
      value => { value.network.jitter = 0; },
      value => { value.network.packetLoss = 0; },
      value => { value.network.joinSuccess = '100%'; },
      value => { value.network.turnCost = 0; },
      value => { value.network.bandwidth = 1000; },
      value => { value.network.measuredNetworks = 1; },
      value => { delete value.network.bandwidth; },
      value => { value.network.extra = LOCAL_NOT_MEASURED; },
      value => { value.scope.networkAccess = 'used'; },
      value => { value.scope.transportSelection = 'ws-central'; },
    ];
    for (const claim of networkClaims) {
      const tampered = clone();
      claim(tampered);
      expect(() => validateLocalManifest(tampered)).toThrow(/Invalid local measurement manifest/);
    }
  });

  it('rejects absent, non-numeric, zero-sample and unordered measurements', async () => {
    const run = await sections();
    const manifest = createLocalManifest({
      runId: 'local-test-2',
      provenance: provenanceFor(run),
      sections: run,
    });
    const clone = (): Loose => JSON.parse(JSON.stringify(manifest)) as Loose;

    const tamper: Array<(value: Loose) => void> = [
      value => { delete value.simulationTicks.p95; },
      value => { value.simulationTicks.p95 = 'fast'; },
      value => { value.simulationTicks.sampleCount = 0; },
      value => { value.simulationTicks.p50 = value.simulationTicks.max + 1; },
      value => { value.simulationTicks.mean = Number.NaN; },
      value => { value.simulationTicks.totalWallClockMicroseconds = 0; },
      value => { value.codecBytes.inputs.perClientEnvelope.sampleCount = 0; },
      value => { value.codecBytes.inputs.perClientEnvelope.mean = 0; },
      value => { value.codecBytes.inputs.perClientCanonicalBytesPerSecond = 0; },
      value => { value.codecBytes.inputs.perClientEnvelopeOverhead.mean = 0; },
      value => { value.codecBytes.inputs.aggregateUpstreamBytesPerSecond = 0; },
      value => { value.codecBytes.snapshots[0].canonical.sampleCount = 0; },
      value => { value.codecBytes.snapshots[1].snapshotHz = 10; },
      value => { value.snapshotTiming[0].encode.sampleCount = 0; },
      value => { value.snapshotTiming[2].decode.p99 = -1; },
      value => { value.processResources.cpuTotalMicroseconds += 1; },
      value => { value.processResources.peakRssBytes = 0; },
      value => { value.provenance.nodeVersion = 'node-22'; },
      value => { value.provenance.gitCommitSha = 'abc'; },
      value => { value.provenance.logicalCores = 0; },
      value => { value.provenance.seed = 0; },
      value => { value.provenance.measuredTicks = 7201; },
      value => { value.provenance.snapshotRatesHz = [10, 20]; },
      value => { value.provenance.workingTreeDirty = 'no'; },
      value => { delete value.provenance.dirtyExclusions; },
      value => { value.provenance.dirtyExclusions = []; },
      value => { value.provenance.dirtyExclusions = ['src/']; },
      value => { value.provenance.dirtyExclusions = ['benchmarks/results/', 'src/']; },
      value => { value.provenance.extra = true; },
      value => { value.methodology.percentiles = 'linear'; },
      value => { value.runId = 'not a run id'; },
      value => { value.schemaVersion = 2; },
    ];
    const accepted: number[] = [];
    tamper.forEach((mutate, index) => {
      const tampered = clone();
      mutate(tampered);
      try {
        validateLocalManifest(tampered);
        accepted.push(index);
      } catch {
        // Rejected as intended.
      }
    });
    expect(accepted).toEqual([]);
  });

  it('requires an explicit event-loop state instead of an absent or untyped sample', async () => {
    const run = await sections();
    const manifest = createLocalManifest({
      runId: 'local-test-3',
      provenance: provenanceFor(run),
      sections: run,
    });
    expect(manifest.eventLoopLag).toEqual({
      status: 'NOT_MEASURED',
      reason: 'disabled by the measurement arguments',
    });
    const clone = (): Loose => JSON.parse(JSON.stringify(manifest)) as Loose;

    const missingMeasurements: Loose[] = [
      { status: 'MEASURED' },
      { status: 'MEASURED', unit: 'nanoseconds', sampleCount: 0 },
      { status: 'NOT_MEASURED' },
      { status: 'NOT_MEASURED', reason: 'off', p50: 1 },
      { status: 'UNKNOWN', reason: 'off' },
    ];
    for (const eventLoopLag of missingMeasurements) {
      const tampered = clone();
      tampered.eventLoopLag = eventLoopLag;
      expect(() => validateLocalManifest(tampered)).toThrow(/Invalid local measurement manifest/);
    }
  });

  it('produces comparable shapes and deterministic bytes across repeated runs', async () => {
    const first = await sections();
    const second = await sections();
    const firstManifest = createLocalManifest({
      runId: 'local-repeat-1',
      provenance: provenanceFor(first),
      sections: first,
    });
    const secondManifest = createLocalManifest({
      runId: 'local-repeat-2',
      provenance: provenanceFor(second),
      sections: second,
    });

    expect(shape(firstManifest)).toEqual(shape(secondManifest));
    // Byte counts and the fixture are deterministic; timings are not asserted.
    expect(firstManifest.codecBytes).toEqual(secondManifest.codecBytes);
    expect(firstManifest.provenance.fixtureSha256).toBe(secondManifest.provenance.fixtureSha256);
    expect(firstManifest.provenance.seed).toBe(secondManifest.provenance.seed);
    expect(firstManifest.network).toEqual(secondManifest.network);

    expect(firstManifest.simulationTicks.sampleCount).toBe(TEST_TICKS);
    expect(firstManifest.processResources.tickCount).toBe(TEST_TICKS);
    expectOrdered(firstManifest.simulationTicks);
    for (const timing of firstManifest.snapshotTiming) {
      expect(timing.sampleCount).toBe(snapshotSampleCount(TEST_TICKS, timing.snapshotHz));
      expectOrdered(timing.encode);
      expectOrdered(timing.decode);
    }
    for (const snapshot of firstManifest.codecBytes.snapshots) {
      expect(snapshot.sampleCount).toBe(snapshotSampleCount(TEST_TICKS, snapshot.snapshotHz));
      expect(snapshot.canonical.sampleCount).toBe(snapshot.sampleCount);
      expect(snapshot.serverMessage.mean).toBeGreaterThan(snapshot.canonical.mean);
      expect(snapshot.serverMessageOverhead.mean).toBeGreaterThan(0);
    }
    expect(firstManifest.codecBytes.inputs.perClientEnvelope.mean)
      .toBeGreaterThan(firstManifest.codecBytes.inputs.perClientCanonical.mean);
    expect(firstManifest.codecBytes.inputs.perClientEnvelopeOverhead.mean).toBeGreaterThan(0);
  });

  it('validates every committed result file and keeps its network fields unclaimed', () => {
    const directory = resolve(process.cwd(), 'benchmarks/results');
    const files = readdirSync(directory).filter(file => /^local-.+\.json$/.test(file));
    // A fresh checkout may contain no result files; every one that is present
    // must validate, so a hand-edited or fabricated result cannot slip through.
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(joinPath(directory, file), 'utf8')) as Loose;
      expect(() => validateLocalManifest(parsed)).not.toThrow();
      expect(parsed.network.latency).toBe(LOCAL_NOT_MEASURED);
      expect(parsed.network.measuredNetworks).toBe(0);
      expect(parsed.provenance.command).toBe('npm run measure:local');
      expect(parsed.provenance.measuredTicks).toBe(7200);
      expect(parsed.provenance.warmupTicks).toBe(600);
      expect(parsed.provenance.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.provenance.seed).toBe(12345);
    }
  });
});
