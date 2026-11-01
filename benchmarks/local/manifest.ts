/**
 * Schema for a single-machine local measurement.
 *
 * This schema deliberately has a different `kind` from the WebSocket and
 * in-memory benchmark manifests. A local measurement describes codec bytes,
 * simulation cost and process resources on one machine; it is not a network
 * measurement and it selects no transport. Every network field is a literal
 * `NOT_MEASURED`, and the validator rejects a number in its place.
 *
 * The validator is strict on purpose: every published number must be present,
 * finite, internally consistent and traceable to the committed command. A
 * missing sample cannot be replaced with zero and a byte rate must match its
 * own sample mean and frequency.
 */
import type { ByteSummary, DurationUnit, SampleDistribution } from './statistics';

export const LOCAL_MANIFEST_VERSION = 1 as const;
export const LOCAL_MANIFEST_KIND = 'single-machine-local-measurement' as const;
export const LOCAL_NOT_MEASURED = 'NOT_MEASURED' as const;
export const LOCAL_SIMULATION_HZ = 60;
export const LOCAL_SNAPSHOT_RATES = [10, 20, 30] as const;
export type LocalSnapshotHz = (typeof LOCAL_SNAPSHOT_RATES)[number];

/**
 * The only paths a local measurement run may ignore when deciding whether the
 * working tree is dirty. These are generated outputs; any source, test or
 * harness change outside this directory still marks the run dirty. The manifest
 * records the exact list and the validator requires it to be this literal, so a
 * result cannot quietly exclude its own code.
 */
export const LOCAL_DIRTY_EXCLUSIONS = ['benchmarks/results/'] as const;
export type LocalDirtyExclusion = (typeof LOCAL_DIRTY_EXCLUSIONS)[number];

/**
 * Fixed interpretation note attached to measured event-loop blocks. It is a
 * factual caveat, not a measurement or a claim about browsers.
 */
export const LOCAL_EVENT_LOOP_INTERPRETATION =
  'Paced harness timer measurement: p50 is dominated by the platform timer floor (about 15.6 ms on legacy Windows timers); not browser frame pacing.';

export type LocalScope = {
  measurement: 'single-machine';
  networkAccess: 'none';
  transportSelection: 'NOT_A_TRANSPORT_DECISION';
};

export type LocalProvenance = {
  command: 'npm run measure:local';
  cliArguments: string[];
  nodeVersion: string;
  platform: string;
  osRelease: string;
  architecture: string;
  cpuModel: string;
  logicalCores: number;
  gitCommitSha: string;
  workingTreeDirty: boolean;
  /** Generated paths ignored by the dirty check; exactly one literal entry. */
  dirtyExclusions: ['benchmarks/results/'];
  fixtureSha256: string;
  seed: number;
  measuredTicks: number;
  warmupTicks: number;
  warmupPolicy: 'discarded-separate-state-replay';
  snapshotRatesHz: [10, 20, 30];
  codecVersions: {
    inputFrame: 1;
    stateSnapshot: 1;
    sessionEnvelope: 1;
    wsServerMessage: 1;
  };
};

export type LocalMethodology = {
  tickTimer: 'process.hrtime.bigint';
  percentiles: 'nearest-rank';
  byteCounting: 'utf8-byte-length-of-canonical-encoding';
  inputEnvelopeSampling: 'one-envelope-per-client-per-tick';
  snapshotSampling: 'encode-and-decode-once-per-emitted-snapshot';
  processResources: 'process.cpuUsage-and-process.resourceUsage.maxRSS';
};

export type LocalInputBytes = {
  scenarioId: 'BASE-4-60-20';
  players: 4;
  inputHz: 60;
  sequencePolicy: 'tick+1-per-client';
  /** One canonical InputFrame containing all four players for one tick. */
  bundledCanonicalPerTick: ByteSummary;
  bundledCanonicalBytesPerTick: number;
  bundledCanonicalBytesPerSecond: number;
  /** One canonical InputFrame for one player, one message per client per tick. */
  perClientCanonical: ByteSummary;
  perClientCanonicalBytesPerTick: number;
  perClientCanonicalBytesPerSecond: number;
  /** The same single-player frame wrapped in a session envelope v1. */
  perClientEnvelope: ByteSummary;
  perClientEnvelopeOverhead: ByteSummary;
  perClientEnvelopeBytesPerTick: number;
  perClientEnvelopeBytesPerSecond: number;
  aggregateUpstreamBytesPerSecond: number;
};

export type LocalSnapshotBytes = {
  snapshotHz: LocalSnapshotHz;
  sampleCount: number;
  canonical: ByteSummary;
  serverMessage: ByteSummary;
  serverMessageOverhead: ByteSummary;
  bytesPerSimulationTickPerClient: number;
  bytesPerSecondPerClient: number;
  bytesPerSecondServerAggregate: number;
};

export type LocalSimulationTicks = {
  unit: 'microseconds';
  sampleCount: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  totalWallClockMicroseconds: number;
  ticksPerSecondWallClock: number;
};

export type LocalSnapshotTiming = {
  snapshotHz: LocalSnapshotHz;
  sampleCount: number;
  iterationsPerSnapshot: 1;
  encode: SampleDistribution;
  decode: SampleDistribution;
};

export type LocalProcessResources = {
  scope: 'measured-tick-loop';
  tickCount: number;
  wallClockMicroseconds: number;
  cpuUserMicroseconds: number;
  cpuSystemMicroseconds: number;
  cpuTotalMicroseconds: number;
  peakRssBytes: number;
  rssAfterRunBytes: number;
};

export type LocalEventLoopLag =
  | { status: 'NOT_MEASURED'; reason: string }
  | {
      status: 'MEASURED';
      unit: 'nanoseconds';
      sampleCount: number;
      min: number;
      mean: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      probeTicks: number;
      probeIntervalMicroseconds: number;
      histogramResolutionMilliseconds: number;
      /** Optional for backwards compatibility with committed schema-v1 results. */
      interpretation?: typeof LOCAL_EVENT_LOOP_INTERPRETATION;
    };

export type LocalNetworkFields = {
  latency: typeof LOCAL_NOT_MEASURED;
  jitter: typeof LOCAL_NOT_MEASURED;
  packetLoss: typeof LOCAL_NOT_MEASURED;
  joinSuccess: typeof LOCAL_NOT_MEASURED;
  turnCost: typeof LOCAL_NOT_MEASURED;
  bandwidth: typeof LOCAL_NOT_MEASURED;
  measuredNetworks: 0;
};

export type LocalMeasurementSections = {
  fixture: { fixtureSha256: string; seed: number };
  codecBytes: {
    inputs: LocalInputBytes;
    snapshots: LocalSnapshotBytes[];
  };
  simulationTicks: LocalSimulationTicks;
  snapshotTiming: LocalSnapshotTiming[];
  processResources: LocalProcessResources;
  eventLoopLag: LocalEventLoopLag;
};

export type LocalMeasurementManifest = {
  schemaVersion: typeof LOCAL_MANIFEST_VERSION;
  kind: typeof LOCAL_MANIFEST_KIND;
  runId: string;
  scope: LocalScope;
  provenance: LocalProvenance;
  methodology: LocalMethodology;
  codecBytes: LocalMeasurementSections['codecBytes'];
  simulationTicks: LocalSimulationTicks;
  snapshotTiming: LocalSnapshotTiming[];
  processResources: LocalProcessResources;
  eventLoopLag: LocalEventLoopLag;
  network: LocalNetworkFields;
};

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,100}$/;
const NODE_VERSION = /^v\d+\.\d+\.\d+/;
const EPSILON = 1e-6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));

const nonEmptyString = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonnegativeNumber = (value: unknown): value is number => finiteNumber(value) && value >= 0;

const positiveInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max;

const nonnegativeInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

const hash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value);
const commit = (value: unknown): value is string => typeof value === 'string' && COMMIT.test(value);

const closeEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= Math.max(EPSILON, Math.abs(expected) * 1e-9);

const validDistribution = (value: unknown, unit: DurationUnit): value is SampleDistribution => {
  if (!isRecord(value) ||
      !exactKeys(value, ['unit', 'sampleCount', 'min', 'mean', 'p50', 'p95', 'p99', 'max']) ||
      value.unit !== unit || !positiveInteger(value.sampleCount) ||
      !['min', 'mean', 'p50', 'p95', 'p99', 'max'].every(key => nonnegativeNumber(value[key]))) {
    return false;
  }
  const min = value.min as number;
  const mean = value.mean as number;
  const p50 = value.p50 as number;
  const p95 = value.p95 as number;
  const p99 = value.p99 as number;
  const max = value.max as number;
  if (!(min <= p50 && p50 <= p95 && p95 <= p99 && p99 <= max &&
      mean >= min - EPSILON && mean <= max + EPSILON)) {
    return false;
  }
  // `min` and the nearest-rank percentiles are observed samples, so a sample
  // set of size n can contain at most n distinct reported values. This rejects
  // impossible blocks such as `sampleCount: 1` with four distinct percentiles,
  // while still accepting a genuinely tiny distribution whose values are equal.
  const observedValues = new Set([min, p50, p95, p99, max]);
  return observedValues.size <= (value.sampleCount as number);
};

const validByteSummary = (value: unknown): value is ByteSummary => {
  if (!isRecord(value) ||
      !exactKeys(value, ['unit', 'sampleCount', 'min', 'mean', 'max']) ||
      value.unit !== 'bytes' || !positiveInteger(value.sampleCount) ||
      !positiveInteger(value.min) || !positiveInteger(value.max) ||
      !nonnegativeNumber(value.mean)) {
    return false;
  }
  const min = value.min as number;
  const mean = value.mean as number;
  const max = value.max as number;
  return min <= max && mean >= min - EPSILON && mean <= max + EPSILON;
};

export function snapshotSampleCount(ticks: number, snapshotHz: LocalSnapshotHz): number {
  return Math.floor((ticks * snapshotHz) / LOCAL_SIMULATION_HZ);
}

function validateScope(value: unknown): value is LocalScope {
  return isRecord(value) &&
    exactKeys(value, ['measurement', 'networkAccess', 'transportSelection']) &&
    value.measurement === 'single-machine' &&
    value.networkAccess === 'none' &&
    value.transportSelection === 'NOT_A_TRANSPORT_DECISION';
}

function validateProvenance(value: unknown): value is LocalProvenance {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'command', 'cliArguments', 'nodeVersion', 'platform', 'osRelease', 'architecture', 'cpuModel',
        'logicalCores', 'gitCommitSha', 'workingTreeDirty', 'dirtyExclusions', 'fixtureSha256', 'seed', 'measuredTicks',
        'warmupTicks', 'warmupPolicy', 'snapshotRatesHz', 'codecVersions',
      ]) ||
      value.command !== 'npm run measure:local' ||
      !Array.isArray(value.cliArguments) ||
      !value.cliArguments.every(argument => typeof argument === 'string' && argument.length <= 200) ||
      typeof value.nodeVersion !== 'string' || !NODE_VERSION.test(value.nodeVersion) ||
      !nonEmptyString(value.platform, 64) || !nonEmptyString(value.osRelease, 200) ||
      !nonEmptyString(value.architecture, 64) || !nonEmptyString(value.cpuModel, 200) ||
      !positiveInteger(value.logicalCores, 4096) ||
      !commit(value.gitCommitSha) || typeof value.workingTreeDirty !== 'boolean' ||
      !Array.isArray(value.dirtyExclusions) ||
      value.dirtyExclusions.length !== LOCAL_DIRTY_EXCLUSIONS.length ||
      value.dirtyExclusions.some((path, index) => path !== LOCAL_DIRTY_EXCLUSIONS[index]) ||
      !hash(value.fixtureSha256) ||
      !positiveInteger(value.seed, 0xffffffff) ||
      !positiveInteger(value.measuredTicks, 7200) ||
      !nonnegativeInteger(value.warmupTicks, 7200) ||
      value.warmupPolicy !== 'discarded-separate-state-replay' ||
      !Array.isArray(value.snapshotRatesHz) || value.snapshotRatesHz.length !== 3 ||
      value.snapshotRatesHz.some((rate, index) => rate !== LOCAL_SNAPSHOT_RATES[index])) {
    return false;
  }
  const codec = value.codecVersions;
  return isRecord(codec) &&
    exactKeys(codec, ['inputFrame', 'stateSnapshot', 'sessionEnvelope', 'wsServerMessage']) &&
    codec.inputFrame === 1 && codec.stateSnapshot === 1 &&
    codec.sessionEnvelope === 1 && codec.wsServerMessage === 1;
}

function validateMethodology(value: unknown): value is LocalMethodology {
  return isRecord(value) &&
    exactKeys(value, [
      'tickTimer', 'percentiles', 'byteCounting', 'inputEnvelopeSampling', 'snapshotSampling',
      'processResources',
    ]) &&
    value.tickTimer === 'process.hrtime.bigint' &&
    value.percentiles === 'nearest-rank' &&
    value.byteCounting === 'utf8-byte-length-of-canonical-encoding' &&
    value.inputEnvelopeSampling === 'one-envelope-per-client-per-tick' &&
    value.snapshotSampling === 'encode-and-decode-once-per-emitted-snapshot' &&
    value.processResources === 'process.cpuUsage-and-process.resourceUsage.maxRSS';
}

function validateInputBytes(value: unknown, ticks: number): value is LocalInputBytes {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'scenarioId', 'players', 'inputHz', 'sequencePolicy', 'bundledCanonicalPerTick',
        'bundledCanonicalBytesPerTick', 'bundledCanonicalBytesPerSecond', 'perClientCanonical',
        'perClientCanonicalBytesPerTick', 'perClientCanonicalBytesPerSecond', 'perClientEnvelope',
        'perClientEnvelopeOverhead', 'perClientEnvelopeBytesPerTick',
        'perClientEnvelopeBytesPerSecond', 'aggregateUpstreamBytesPerSecond',
      ]) ||
      value.scenarioId !== 'BASE-4-60-20' || value.players !== 4 || value.inputHz !== 60 ||
      value.sequencePolicy !== 'tick+1-per-client' ||
      !validByteSummary(value.bundledCanonicalPerTick) ||
      !validByteSummary(value.perClientCanonical) ||
      !validByteSummary(value.perClientEnvelope) ||
      !validByteSummary(value.perClientEnvelopeOverhead) ||
      !nonnegativeNumber(value.bundledCanonicalBytesPerTick) ||
      !nonnegativeNumber(value.bundledCanonicalBytesPerSecond) ||
      !nonnegativeNumber(value.perClientCanonicalBytesPerTick) ||
      !nonnegativeNumber(value.perClientCanonicalBytesPerSecond) ||
      !nonnegativeNumber(value.perClientEnvelopeBytesPerTick) ||
      !nonnegativeNumber(value.perClientEnvelopeBytesPerSecond) ||
      !nonnegativeNumber(value.aggregateUpstreamBytesPerSecond)) {
    return false;
  }
  const bundled = value.bundledCanonicalPerTick as ByteSummary;
  const canonical = value.perClientCanonical as ByteSummary;
  const envelope = value.perClientEnvelope as ByteSummary;
  const overhead = value.perClientEnvelopeOverhead as ByteSummary;
  if (bundled.sampleCount !== ticks ||
      canonical.sampleCount !== ticks * 4 ||
      envelope.sampleCount !== ticks * 4 ||
      overhead.sampleCount !== ticks * 4) {
    return false;
  }
  // The published rates must agree with their own byte distributions.
  if (!closeEnough(value.bundledCanonicalBytesPerTick as number, bundled.mean) ||
      !closeEnough(value.bundledCanonicalBytesPerSecond as number, bundled.mean * 60) ||
      !closeEnough(value.perClientCanonicalBytesPerTick as number, canonical.mean) ||
      !closeEnough(value.perClientCanonicalBytesPerSecond as number, canonical.mean * 60) ||
      !closeEnough(value.perClientEnvelopeBytesPerTick as number, envelope.mean) ||
      !closeEnough(value.perClientEnvelopeBytesPerSecond as number, envelope.mean * 60) ||
      !closeEnough(value.aggregateUpstreamBytesPerSecond as number, envelope.mean * 4 * 60)) {
    return false;
  }
  // Envelope overhead is measured from paired samples, so the means must agree.
  return closeEnough(overhead.mean, envelope.mean - canonical.mean) && overhead.mean > 0;
}

function validateSnapshotBytes(value: unknown, ticks: number, index: number): value is LocalSnapshotBytes {
  const expectedHz = LOCAL_SNAPSHOT_RATES[index];
  if (!isRecord(value) ||
      !exactKeys(value, [
        'snapshotHz', 'sampleCount', 'canonical', 'serverMessage', 'serverMessageOverhead',
        'bytesPerSimulationTickPerClient', 'bytesPerSecondPerClient', 'bytesPerSecondServerAggregate',
      ]) ||
      value.snapshotHz !== expectedHz ||
      !positiveInteger(value.sampleCount) ||
      !validByteSummary(value.canonical) ||
      !validByteSummary(value.serverMessage) ||
      !validByteSummary(value.serverMessageOverhead) ||
      !nonnegativeNumber(value.bytesPerSimulationTickPerClient) ||
      !nonnegativeNumber(value.bytesPerSecondPerClient) ||
      !nonnegativeNumber(value.bytesPerSecondServerAggregate)) {
    return false;
  }
  const expectedSamples = snapshotSampleCount(ticks, expectedHz);
  const canonical = value.canonical as ByteSummary;
  const serverMessage = value.serverMessage as ByteSummary;
  const overhead = value.serverMessageOverhead as ByteSummary;
  if (canonical.sampleCount !== expectedSamples ||
      serverMessage.sampleCount !== expectedSamples ||
      overhead.sampleCount !== expectedSamples ||
      value.sampleCount !== expectedSamples) {
    return false;
  }
  return closeEnough(value.bytesPerSimulationTickPerClient as number, canonical.mean * expectedHz / LOCAL_SIMULATION_HZ) &&
    closeEnough(value.bytesPerSecondPerClient as number, canonical.mean * expectedHz) &&
    closeEnough(value.bytesPerSecondServerAggregate as number, canonical.mean * expectedHz * 4) &&
    closeEnough(overhead.mean, serverMessage.mean - canonical.mean) && overhead.mean > 0;
}

function validateSimulationTicks(value: unknown, ticks: number): value is LocalSimulationTicks {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'unit', 'sampleCount', 'min', 'mean', 'p50', 'p95', 'p99', 'max',
        'totalWallClockMicroseconds', 'ticksPerSecondWallClock',
      ]) ||
      value.unit !== 'microseconds' || value.sampleCount !== ticks ||
      !['min', 'mean', 'p50', 'p95', 'p99', 'max'].every(key => nonnegativeNumber(value[key])) ||
      !nonnegativeNumber(value.totalWallClockMicroseconds) ||
      !nonnegativeNumber(value.ticksPerSecondWallClock)) {
    return false;
  }
  const min = value.min as number;
  const mean = value.mean as number;
  const p50 = value.p50 as number;
  const p95 = value.p95 as number;
  const p99 = value.p99 as number;
  const max = value.max as number;
  const wall = value.totalWallClockMicroseconds as number;
  return min <= p50 && p50 <= p95 && p95 <= p99 && p99 <= max &&
    mean >= min - EPSILON && mean <= max + EPSILON &&
    wall > 0 && closeEnough(value.ticksPerSecondWallClock as number, ticks * 1_000_000 / wall);
}

function validateSnapshotTiming(value: unknown, ticks: number, index: number): value is LocalSnapshotTiming {
  const expectedHz = LOCAL_SNAPSHOT_RATES[index];
  if (!isRecord(value) ||
      !exactKeys(value, ['snapshotHz', 'sampleCount', 'iterationsPerSnapshot', 'encode', 'decode']) ||
      value.snapshotHz !== expectedHz || value.iterationsPerSnapshot !== 1 ||
      !validDistribution(value.encode, 'microseconds') ||
      !validDistribution(value.decode, 'microseconds')) {
    return false;
  }
  const expectedSamples = snapshotSampleCount(ticks, expectedHz);
  const encode = value.encode as SampleDistribution;
  const decode = value.decode as SampleDistribution;
  return value.sampleCount === expectedSamples &&
    encode.sampleCount === expectedSamples &&
    decode.sampleCount === expectedSamples;
}

function validateProcessResources(value: unknown, ticks: number): value is LocalProcessResources {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'scope', 'tickCount', 'wallClockMicroseconds', 'cpuUserMicroseconds', 'cpuSystemMicroseconds',
        'cpuTotalMicroseconds', 'peakRssBytes', 'rssAfterRunBytes',
      ]) ||
      value.scope !== 'measured-tick-loop' || value.tickCount !== ticks ||
      !nonnegativeNumber(value.wallClockMicroseconds) ||
      !nonnegativeInteger(value.cpuUserMicroseconds) ||
      !nonnegativeInteger(value.cpuSystemMicroseconds) ||
      !nonnegativeInteger(value.cpuTotalMicroseconds) ||
      !positiveInteger(value.peakRssBytes) || !positiveInteger(value.rssAfterRunBytes)) {
    return false;
  }
  return value.cpuTotalMicroseconds ===
      (value.cpuUserMicroseconds as number) + (value.cpuSystemMicroseconds as number) &&
    (value.wallClockMicroseconds as number) > 0;
}

/**
 * `monitorEventLoopDelay` samples roughly once per histogram resolution, while
 * the probe schedules one simulation tick per `probeIntervalMicroseconds`.
 * Those are independent timers, so the observer can collect more samples than
 * there are probe ticks: the committed 300-tick runs at 10 ms resolution and a
 * 16.67 ms interval report 320-323 samples. A duration/resolution bound plus a
 * two-sample boundary tolerance is therefore used instead of `probeTicks + 2`,
 * which would reject the actual measured results. This is a plausibility bound,
 * not an observed rate.
 */
const EVENT_LOOP_SAMPLE_TOLERANCE = 2;

function maxPlausibleEventLoopSamples(
  probeTicks: number,
  probeIntervalMicroseconds: number,
  histogramResolutionMilliseconds: number,
): number {
  const probeDurationMicroseconds = probeTicks * probeIntervalMicroseconds;
  const resolutionMicroseconds = histogramResolutionMilliseconds * 1000;
  return Math.ceil(probeDurationMicroseconds / resolutionMicroseconds) + EVENT_LOOP_SAMPLE_TOLERANCE;
}

function validateEventLoopLag(value: unknown): value is LocalEventLoopLag {
  if (!isRecord(value)) return false;
  if (value.status === 'NOT_MEASURED') {
    return exactKeys(value, ['status', 'reason']) && nonEmptyString(value.reason);
  }
  if (value.status !== 'MEASURED') return false;
  const baseKeys = [
    'status', 'unit', 'sampleCount', 'min', 'mean', 'p50', 'p95', 'p99', 'max',
    'probeTicks', 'probeIntervalMicroseconds', 'histogramResolutionMilliseconds',
  ];
  // The interpretation note is optional so schema-v1 results committed before
  // it existed still validate; when present it must be the exact factual note.
  if (!exactKeys(value, baseKeys) && !exactKeys(value, [...baseKeys, 'interpretation'])) return false;
  if (value.interpretation !== undefined &&
      value.interpretation !== LOCAL_EVENT_LOOP_INTERPRETATION) {
    return false;
  }
  if (!validDistribution(
    {
      unit: value.unit,
      sampleCount: value.sampleCount,
      min: value.min,
      mean: value.mean,
      p50: value.p50,
      p95: value.p95,
      p99: value.p99,
      max: value.max,
    },
    'nanoseconds',
  ) ||
      !positiveInteger(value.probeTicks, 7200) ||
      !positiveInteger(value.probeIntervalMicroseconds, 1_000_000) ||
      !positiveInteger(value.histogramResolutionMilliseconds, 1000)) {
    return false;
  }
  const maximumSamples = maxPlausibleEventLoopSamples(
    value.probeTicks as number,
    value.probeIntervalMicroseconds as number,
    value.histogramResolutionMilliseconds as number,
  );
  return (value.sampleCount as number) <= maximumSamples;
}

function validateNetwork(value: unknown): value is LocalNetworkFields {
  return isRecord(value) &&
    exactKeys(value, [
      'latency', 'jitter', 'packetLoss', 'joinSuccess', 'turnCost', 'bandwidth', 'measuredNetworks',
    ]) &&
    value.latency === LOCAL_NOT_MEASURED &&
    value.jitter === LOCAL_NOT_MEASURED &&
    value.packetLoss === LOCAL_NOT_MEASURED &&
    value.joinSuccess === LOCAL_NOT_MEASURED &&
    value.turnCost === LOCAL_NOT_MEASURED &&
    value.bandwidth === LOCAL_NOT_MEASURED &&
    value.measuredNetworks === 0;
}

export function createLocalManifest(input: {
  runId: string;
  provenance: LocalProvenance;
  sections: LocalMeasurementSections;
}): LocalMeasurementManifest {
  const manifest: LocalMeasurementManifest = {
    schemaVersion: LOCAL_MANIFEST_VERSION,
    kind: LOCAL_MANIFEST_KIND,
    runId: input.runId,
    scope: {
      measurement: 'single-machine',
      networkAccess: 'none',
      transportSelection: 'NOT_A_TRANSPORT_DECISION',
    },
    provenance: {
      ...input.provenance,
      fixtureSha256: input.sections.fixture.fixtureSha256,
      seed: input.sections.fixture.seed,
    },
    methodology: {
      tickTimer: 'process.hrtime.bigint',
      percentiles: 'nearest-rank',
      byteCounting: 'utf8-byte-length-of-canonical-encoding',
      inputEnvelopeSampling: 'one-envelope-per-client-per-tick',
      snapshotSampling: 'encode-and-decode-once-per-emitted-snapshot',
      processResources: 'process.cpuUsage-and-process.resourceUsage.maxRSS',
    },
    codecBytes: input.sections.codecBytes,
    simulationTicks: input.sections.simulationTicks,
    snapshotTiming: input.sections.snapshotTiming,
    processResources: input.sections.processResources,
    eventLoopLag: input.sections.eventLoopLag,
    network: {
      latency: LOCAL_NOT_MEASURED,
      jitter: LOCAL_NOT_MEASURED,
      packetLoss: LOCAL_NOT_MEASURED,
      joinSuccess: LOCAL_NOT_MEASURED,
      turnCost: LOCAL_NOT_MEASURED,
      bandwidth: LOCAL_NOT_MEASURED,
      measuredNetworks: 0,
    },
  };
  validateLocalManifest(manifest);
  return manifest;
}

export function validateLocalManifest(value: unknown): asserts value is LocalMeasurementManifest {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'schemaVersion', 'kind', 'runId', 'scope', 'provenance', 'methodology', 'codecBytes',
        'simulationTicks', 'snapshotTiming', 'processResources', 'eventLoopLag', 'network',
      ]) ||
      value.schemaVersion !== LOCAL_MANIFEST_VERSION || value.kind !== LOCAL_MANIFEST_KIND ||
      typeof value.runId !== 'string' || !RUN_ID.test(value.runId) ||
      !validateScope(value.scope) || !validateProvenance(value.provenance) ||
      !validateMethodology(value.methodology)) {
    throw new Error('Invalid local measurement manifest');
  }

  const provenance = value.provenance as LocalProvenance;
  const ticks = provenance.measuredTicks;
  const codec = value.codecBytes;
  if (!isRecord(codec) || !exactKeys(codec, ['inputs', 'snapshots'])) {
    throw new Error('Invalid local measurement manifest');
  }
  if (!validateInputBytes(codec.inputs, ticks)) {
    throw new Error('Invalid local measurement manifest');
  }
  const snapshots = codec.snapshots;
  if (!Array.isArray(snapshots) ||
      snapshots.length !== LOCAL_SNAPSHOT_RATES.length ||
      !snapshots.every((snapshot, index) => validateSnapshotBytes(snapshot, ticks, index))) {
    throw new Error('Invalid local measurement manifest');
  }

  const simulationTicks = value.simulationTicks;
  if (!validateSimulationTicks(simulationTicks, ticks)) {
    throw new Error('Invalid local measurement manifest');
  }
  const timing = value.snapshotTiming;
  if (!Array.isArray(timing) ||
      timing.length !== LOCAL_SNAPSHOT_RATES.length ||
      !timing.every((entry, index) => validateSnapshotTiming(entry, ticks, index))) {
    throw new Error('Invalid local measurement manifest');
  }
  const processResources = value.processResources;
  if (!validateProcessResources(processResources, ticks) ||
      processResources.wallClockMicroseconds !== simulationTicks.totalWallClockMicroseconds) {
    throw new Error('Invalid local measurement manifest');
  }
  if (!validateEventLoopLag(value.eventLoopLag) || !validateNetwork(value.network)) {
    throw new Error('Invalid local measurement manifest');
  }
}
