/**
 * Single-machine local measurement of the deterministic simulation and protocol
 * codecs.
 *
 * Nothing here opens a socket, runs a browser, applies impairment or imitates a
 * network. Every reported number comes from the committed command
 * `npm run measure:local` on the recorded machine. Network fields are owned by
 * `manifest.ts` and stay `NOT_MEASURED`.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { decodeInputFrame, encodeInputFrame } from '../../src/game/protocol/inputFrame';
import { decodeStateSnapshot, encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import { SESSION_ENVELOPE_VERSION, encodeClientEnvelope } from '../../src/game/session/sessionEnvelope';
import { encodeWsServerMessage } from '../../src/game/networking/wsMessages';
import { MATCH_TICKS, TICK_RATE, createState, step } from '../../src/game/simulation/step';
import type { GameState, PlayerInput } from '../../src/game/simulation/types';
import { generateFixture } from '../scenarios';
import {
  LOCAL_EVENT_LOOP_INTERPRETATION,
  LOCAL_SNAPSHOT_RATES,
  snapshotSampleCount,
  type LocalEventLoopLag,
  type LocalInputBytes,
  type LocalMeasurementSections,
  type LocalProcessResources,
  type LocalSimulationTicks,
  type LocalSnapshotBytes,
  type LocalSnapshotTiming,
} from './manifest';
import { summarizeBytes, summarizeSamples } from './statistics';

export const LOCAL_SCENARIO_ID = 'BASE-4-60-20' as const;
export const LOCAL_ROSTER = ['P1', 'P2', 'P3', 'P4'] as const;
export const DEFAULT_MEASURED_TICKS = MATCH_TICKS;
export const DEFAULT_WARMUP_TICKS = 600;
export const DEFAULT_EVENT_LOOP_TICKS = 300;
export const SNAPSHOT_CODEC_WARMUP_ITERATIONS = 200;
export const EVENT_LOOP_HISTOGRAM_RESOLUTION_MS = 10;

export type LocalMeasurementOptions = {
  ticks?: number;
  warmupTicks?: number;
  /** `0` disables the paced event-loop probe and reports `NOT_MEASURED`. */
  eventLoopTicks?: number;
};

type LoadedFixture = {
  fixtureSha256: string;
  seed: number;
  framesByTick: readonly (readonly string[])[];
  schedule: readonly PlayerInput[][];
};

const utf8 = new TextEncoder();
const byteLength = (text: string): number => utf8.encode(text).byteLength;
const microseconds = (nanoseconds: bigint): number => Number(nanoseconds) / 1000;

function positiveBound(value: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return value;
}

function nonnegativeBound(value: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return value;
}

/**
 * Decodes the committed BASE-4 fixture. The canonical frames come from
 * `scenarios.ts`, so a local measurement cannot invent its own input stream.
 */
function loadFixture(ticks: number): LoadedFixture {
  const fixture = generateFixture(LOCAL_SCENARIO_ID);
  if (fixture.ticks !== MATCH_TICKS || fixture.framesByTick.length !== MATCH_TICKS) {
    throw new Error('Unexpected BASE-4 fixture length');
  }
  const schedule: PlayerInput[][] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const frames = fixture.framesByTick[tick];
    if (frames.length !== 1) throw new Error('Unexpected BASE-4 fixture framing');
    const decoded = decodeInputFrame(frames[0]);
    if (decoded.tick !== tick || decoded.inputs.length !== LOCAL_ROSTER.length) {
      throw new Error('Unexpected BASE-4 fixture tick');
    }
    for (const playerId of LOCAL_ROSTER) {
      if (!decoded.inputs.some(input => input.playerId === playerId)) {
        throw new Error('Unexpected BASE-4 fixture roster');
      }
    }
    schedule.push(decoded.inputs);
  }
  return {
    fixtureSha256: fixture.fixtureSha256,
    seed: fixture.seed,
    framesByTick: fixture.framesByTick,
    schedule,
  };
}

function freshState(): GameState {
  return createState([...LOCAL_ROSTER], 'fighting');
}

function measureTicks(loaded: LoadedFixture, ticks: number, warmupTicks: number): {
  distribution: LocalSimulationTicks;
  resources: LocalProcessResources;
} {
  // Warm-up replays the fixture from its start on a separate state. The
  // measured loop then starts from a fresh state, so no warm-up tick is counted.
  let warmState = freshState();
  for (let tick = 0; tick < warmupTicks; tick++) warmState = step(warmState, loaded.schedule[tick]);

  let state = freshState();
  const samples: number[] = [];
  const wallStart = process.hrtime.bigint();
  const cpuBefore = process.cpuUsage();
  for (let tick = 0; tick < ticks; tick++) {
    const start = process.hrtime.bigint();
    state = step(state, loaded.schedule[tick]);
    samples.push(microseconds(process.hrtime.bigint() - start));
  }
  const wallEnd = process.hrtime.bigint();
  const cpu = process.cpuUsage(cpuBefore);
  const usage = process.resourceUsage();
  const memory = process.memoryUsage();

  const distribution = summarizeSamples(samples, 'microseconds');
  const totalWallClockMicroseconds = microseconds(wallEnd - wallStart);
  return {
    distribution: {
      ...distribution,
      unit: 'microseconds',
      sampleCount: ticks,
      totalWallClockMicroseconds,
      ticksPerSecondWallClock: (ticks * 1_000_000) / totalWallClockMicroseconds,
    },
    resources: {
      scope: 'measured-tick-loop',
      tickCount: ticks,
      wallClockMicroseconds: totalWallClockMicroseconds,
      cpuUserMicroseconds: cpu.user,
      cpuSystemMicroseconds: cpu.system,
      cpuTotalMicroseconds: cpu.user + cpu.system,
      // Node reports maxRSS in kilobytes; the manifest records bytes explicitly.
      peakRssBytes: usage.maxRSS * 1024,
      rssAfterRunBytes: memory.rss,
    },
  };
}

function measureInputBytes(loaded: LoadedFixture, ticks: number): LocalInputBytes {
  const bundled: number[] = [];
  const canonical: number[] = [];
  const envelopes: number[] = [];
  const overhead: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    bundled.push(byteLength(loaded.framesByTick[tick][0]));
    for (const input of loaded.schedule[tick]) {
      const frame = { version: 1 as const, tick, inputs: [input] };
      const canonicalText = encodeInputFrame(frame);
      const envelopeText = encodeClientEnvelope({
        version: SESSION_ENVELOPE_VERSION,
        kind: 'input',
        sequence: tick + 1,
        targetTick: tick,
        frame,
      });
      const canonicalBytes = byteLength(canonicalText);
      const envelopeBytes = byteLength(envelopeText);
      canonical.push(canonicalBytes);
      envelopes.push(envelopeBytes);
      overhead.push(envelopeBytes - canonicalBytes);
    }
  }

  const bundledCanonicalPerTick = summarizeBytes(bundled);
  const perClientCanonical = summarizeBytes(canonical);
  const perClientEnvelope = summarizeBytes(envelopes);
  const perClientEnvelopeOverhead = summarizeBytes(overhead);
  return {
    scenarioId: LOCAL_SCENARIO_ID,
    players: 4,
    inputHz: 60,
    sequencePolicy: 'tick+1-per-client',
    bundledCanonicalPerTick,
    bundledCanonicalBytesPerTick: bundledCanonicalPerTick.mean,
    bundledCanonicalBytesPerSecond: bundledCanonicalPerTick.mean * TICK_RATE,
    perClientCanonical,
    perClientCanonicalBytesPerTick: perClientCanonical.mean,
    perClientCanonicalBytesPerSecond: perClientCanonical.mean * TICK_RATE,
    perClientEnvelope,
    perClientEnvelopeOverhead,
    perClientEnvelopeBytesPerTick: perClientEnvelope.mean,
    perClientEnvelopeBytesPerSecond: perClientEnvelope.mean * TICK_RATE,
    aggregateUpstreamBytesPerSecond: perClientEnvelope.mean * LOCAL_ROSTER.length * TICK_RATE,
  };
}

function measureSnapshotBytesAndTiming(loaded: LoadedFixture, ticks: number): {
  snapshots: LocalSnapshotBytes[];
  timing: LocalSnapshotTiming[];
} {
  // Warm the codec paths once with a separate state; the iterations are not
  // counted in any snapshot sample.
  const warmState = freshState();
  for (let iteration = 0; iteration < SNAPSHOT_CODEC_WARMUP_ITERATIONS; iteration++) {
    const json = encodeStateSnapshot({ version: 1, state: warmState });
    decodeStateSnapshot(json);
  }

  const snapshots: LocalSnapshotBytes[] = [];
  const timing: LocalSnapshotTiming[] = [];
  for (const snapshotHz of LOCAL_SNAPSHOT_RATES) {
    const stride = TICK_RATE / snapshotHz;
    let state = freshState();
    const canonicalBytes: number[] = [];
    const messageBytes: number[] = [];
    const messageOverhead: number[] = [];
    const encodeMicroseconds: number[] = [];
    const decodeMicroseconds: number[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      state = step(state, loaded.schedule[tick]);
      // The prototype server emits after ticks 3, 6, 9... for 20 Hz.
      if (state.tick % stride !== 0) continue;
      const snapshot = { version: 1 as const, state };
      const encodeStart = process.hrtime.bigint();
      const json = encodeStateSnapshot(snapshot);
      const encodeEnd = process.hrtime.bigint();
      decodeStateSnapshot(json);
      const decodeEnd = process.hrtime.bigint();
      encodeMicroseconds.push(microseconds(encodeEnd - encodeStart));
      decodeMicroseconds.push(microseconds(decodeEnd - encodeEnd));

      const canonical = byteLength(json);
      const message = encodeWsServerMessage({ version: 1, kind: 'snapshot', snapshot });
      const messageSize = byteLength(message);
      canonicalBytes.push(canonical);
      messageBytes.push(messageSize);
      messageOverhead.push(messageSize - canonical);
    }

    const canonical = summarizeBytes(canonicalBytes);
    const serverMessage = summarizeBytes(messageBytes);
    const serverMessageOverhead = summarizeBytes(messageOverhead);
    const expectedSamples = snapshotSampleCount(ticks, snapshotHz);
    if (canonical.sampleCount !== expectedSamples) {
      throw new Error(`Unexpected snapshot sample count at ${snapshotHz} Hz`);
    }
    snapshots.push({
      snapshotHz,
      sampleCount: canonical.sampleCount,
      canonical,
      serverMessage,
      serverMessageOverhead,
      bytesPerSimulationTickPerClient: canonical.mean * snapshotHz / TICK_RATE,
      bytesPerSecondPerClient: canonical.mean * snapshotHz,
      bytesPerSecondServerAggregate: canonical.mean * snapshotHz * LOCAL_ROSTER.length,
    });
    timing.push({
      snapshotHz,
      sampleCount: canonical.sampleCount,
      iterationsPerSnapshot: 1,
      encode: summarizeSamples(encodeMicroseconds, 'microseconds'),
      decode: summarizeSamples(decodeMicroseconds, 'microseconds'),
    });
  }
  return { snapshots, timing };
}

/**
 * Opt-in paced probe. It steps one fixture tick every 1/60 s through a fresh
 * state and lets the event loop schedule the next callback. The reported lag is
 * the delay histogram of that harness loop, not a browser frame-pacing result.
 */
async function measureEventLoopLag(loaded: LoadedFixture, ticks: number): Promise<LocalEventLoopLag> {
  if (ticks === 0) {
    return { status: 'NOT_MEASURED', reason: 'disabled by the measurement arguments' };
  }
  const intervalMs = 1000 / TICK_RATE;
  const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_HISTOGRAM_RESOLUTION_MS });
  let state = freshState();
  let index = 0;
  let expected = performance.now();
  const deadline = expected + ticks * intervalMs * 4 + 5000;
  histogram.enable();
  try {
    await new Promise<void>((resolve, reject) => {
      const scheduleNext = (): void => {
        if (index >= ticks) {
          resolve();
          return;
        }
        try {
          state = step(state, loaded.schedule[index]);
          index++;
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        expected += intervalMs;
        if (performance.now() > deadline) {
          reject(new Error('Event loop probe did not finish before its wall-clock guard'));
          return;
        }
        setTimeout(scheduleNext, Math.max(0, expected - performance.now()));
      };
      setTimeout(scheduleNext, intervalMs);
    });
  } finally {
    histogram.disable();
  }
  if (histogram.count === 0) throw new Error('Event loop probe collected no samples');
  return {
    status: 'MEASURED',
    unit: 'nanoseconds',
    sampleCount: histogram.count,
    min: histogram.min,
    mean: histogram.mean,
    p50: histogram.percentile(50),
    p95: histogram.percentile(95),
    p99: histogram.percentile(99),
    max: histogram.max,
    probeTicks: ticks,
    probeIntervalMicroseconds: Math.round(intervalMs * 1000),
    histogramResolutionMilliseconds: EVENT_LOOP_HISTOGRAM_RESOLUTION_MS,
    interpretation: LOCAL_EVENT_LOOP_INTERPRETATION,
  };
}

/**
 * Runs every local measurement phase and returns the schema sections. Callers
 * add provenance and a run ID, then validate the assembled manifest.
 */
export async function runLocalMeasurement(
  options: LocalMeasurementOptions = {},
): Promise<LocalMeasurementSections> {
  const ticks = positiveBound(options.ticks ?? DEFAULT_MEASURED_TICKS, MATCH_TICKS, 'tick count');
  const warmupTicks = nonnegativeBound(options.warmupTicks ?? DEFAULT_WARMUP_TICKS, MATCH_TICKS, 'warm-up count');
  const eventLoopTicks = nonnegativeBound(
    options.eventLoopTicks ?? DEFAULT_EVENT_LOOP_TICKS,
    MATCH_TICKS,
    'event-loop probe tick count',
  );

  const loaded = loadFixture(Math.max(ticks, warmupTicks, eventLoopTicks));
  // Tick cost and process resources are measured first, before the byte and
  // codec phases allocate their own sample arrays.
  const { distribution, resources } = measureTicks(loaded, ticks, warmupTicks);
  const inputs = measureInputBytes(loaded, ticks);
  const { snapshots, timing } = measureSnapshotBytesAndTiming(loaded, ticks);
  const eventLoopLag = await measureEventLoopLag(loaded, eventLoopTicks);

  return {
    fixture: { fixtureSha256: loaded.fixtureSha256, seed: loaded.seed },
    codecBytes: { inputs, snapshots },
    simulationTicks: distribution,
    snapshotTiming: timing,
    processResources: resources,
    eventLoopLag,
  };
}
