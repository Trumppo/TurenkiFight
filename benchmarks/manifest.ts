import type { BenchmarkReplay } from './inMemory';
import { MAX_SNAPSHOT_FIGHTERS } from '../src/game/protocol/stateSnapshot';
import {
  BENCHMARK_MATCH_SECONDS,
  BENCHMARK_SIMULATION_HZ,
  SCENARIO_VERSION,
  requireScenario,
  type BenchmarkFixture,
  type BenchmarkImpairment,
  type BenchmarkScenarioId,
} from './scenarios';

export const NOT_MEASURED = 'NOT_MEASURED' as const;
export const IMPAIRMENT_MODE = 'configuration-metadata' as const;

export type BenchmarkManifest = {
  schemaVersion: 1;
  runId: string;
  scenarioId: BenchmarkScenarioId;
  scenarioVersion: typeof SCENARIO_VERSION;
  commitSha: string;
  transport: 'in-memory';
  authority: 'in-process';
  protocolVersion: 1;
  fixtureSha256: string;
  seed: number;
  players: number;
  localSlotsPerClient: number[];
  simulationHz: typeof BENCHMARK_SIMULATION_HZ;
  inputHz: number;
  snapshotHz: number;
  matchSeconds: typeof BENCHMARK_MATCH_SECONDS;
  impairment: BenchmarkImpairment;
  /** Declared configuration only: the in-memory harness never applies or measures it. */
  impairmentMode: typeof IMPAIRMENT_MODE;
  environment: {
    network: 'in-process';
    os: typeof NOT_MEASURED;
    browser: typeof NOT_MEASURED;
    cpu: typeof NOT_MEASURED;
    turn: false;
  };
  result: typeof NOT_MEASURED;
  replay: BenchmarkReplay;
};

const hash = /^[0-9a-f]{64}$/;
const commit = /^[0-9a-f]{40}$/;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(k => allowed.includes(k));
const sameImpairment = (a: Record<string, unknown>, b: BenchmarkImpairment) =>
  a.rttMs === b.rttMs && a.jitterMs === b.jitterMs && a.lossPercent === b.lossPercent;

/** No invented latency, throughput, hardware or transport metrics. */
export function createUnmeasuredManifest(
  fixture: BenchmarkFixture,
  replay: BenchmarkReplay,
  commitSha: string,
  runId: string,
): BenchmarkManifest {
  const scenario = requireScenario(fixture.scenarioId);
  const manifest: BenchmarkManifest = {
    schemaVersion: 1,
    runId,
    scenarioId: scenario.id,
    scenarioVersion: SCENARIO_VERSION,
    commitSha,
    transport: 'in-memory',
    authority: 'in-process',
    protocolVersion: 1,
    fixtureSha256: fixture.fixtureSha256,
    seed: fixture.seed,
    players: scenario.players,
    localSlotsPerClient: Array.from({ length: scenario.players }, () => 1),
    simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: scenario.inputHz,
    snapshotHz: scenario.snapshotHz,
    matchSeconds: BENCHMARK_MATCH_SECONDS,
    impairment: { ...scenario.impairment },
    impairmentMode: IMPAIRMENT_MODE,
    environment: {
      network: 'in-process',
      os: NOT_MEASURED,
      browser: NOT_MEASURED,
      cpu: NOT_MEASURED,
      turn: false,
    },
    result: NOT_MEASURED,
    replay: {
      scenarioId: replay.scenarioId,
      scenarioVersion: replay.scenarioVersion,
      players: replay.players,
      inputHz: replay.inputHz,
      snapshotHz: replay.snapshotHz,
      impairment: { ...replay.impairment },
      seed: replay.seed,
      fixtureSha256: replay.fixtureSha256,
      finalStateSha256: replay.finalStateSha256,
      finalStateEncoding: replay.finalStateEncoding,
      orderedEventsSha256: replay.orderedEventsSha256,
      lifecycleSha256: replay.lifecycleSha256,
      finalTick: replay.finalTick,
      result: NOT_MEASURED,
    },
  };
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(value: unknown): asserts value is BenchmarkManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid benchmark manifest');
  const m = value as Record<string, unknown>;
  if (!keys(m, [
    'schemaVersion', 'runId', 'scenarioId', 'scenarioVersion', 'commitSha', 'transport', 'authority',
    'protocolVersion', 'fixtureSha256', 'seed', 'players', 'localSlotsPerClient', 'simulationHz',
    'inputHz', 'snapshotHz', 'matchSeconds', 'impairment', 'impairmentMode', 'environment', 'result', 'replay',
  ]) ||
      m.schemaVersion !== 1 || m.scenarioVersion !== SCENARIO_VERSION ||
      typeof m.runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(m.runId) ||
      typeof m.commitSha !== 'string' || !commit.test(m.commitSha) ||
      typeof m.scenarioId !== 'string' || m.transport !== 'in-memory' || m.authority !== 'in-process' ||
      m.protocolVersion !== 1 || typeof m.fixtureSha256 !== 'string' || !hash.test(m.fixtureSha256) ||
      !Number.isSafeInteger(m.seed) || (m.seed as number) < 1 || (m.seed as number) > 0xffffffff ||
      m.simulationHz !== BENCHMARK_SIMULATION_HZ || m.matchSeconds !== BENCHMARK_MATCH_SECONDS ||
      m.impairmentMode !== IMPAIRMENT_MODE || m.result !== NOT_MEASURED) {
    throw new Error('Invalid benchmark manifest');
  }

  let scenario: ReturnType<typeof requireScenario>;
  try {
    scenario = requireScenario(m.scenarioId);
  } catch {
    throw new Error('Invalid benchmark manifest');
  }
  if (scenario.kind === 'transport-required' || m.players !== scenario.players ||
      m.inputHz !== scenario.inputHz || m.snapshotHz !== scenario.snapshotHz ||
      !Array.isArray(m.localSlotsPerClient) ||
      m.localSlotsPerClient.length !== scenario.players ||
      m.localSlotsPerClient.some(slot => slot !== 1)) {
    throw new Error('Invalid benchmark manifest');
  }

  const impairment = m.impairment as Record<string, unknown> | null;
  const env = m.environment as Record<string, unknown> | null;
  const replay = m.replay as Record<string, unknown> | null;
  if (!impairment || typeof impairment !== 'object' || Array.isArray(impairment) ||
      !keys(impairment, ['rttMs', 'jitterMs', 'lossPercent']) ||
      !sameImpairment(impairment, scenario.impairment) ||
      !env || typeof env !== 'object' || Array.isArray(env) ||
      !keys(env, ['network', 'os', 'browser', 'cpu', 'turn']) ||
      env.network !== 'in-process' || env.os !== NOT_MEASURED || env.browser !== NOT_MEASURED ||
      env.cpu !== NOT_MEASURED || env.turn !== false ||
      !replay || typeof replay !== 'object' || Array.isArray(replay) ||
      !keys(replay, [
        'scenarioId', 'scenarioVersion', 'players', 'inputHz', 'snapshotHz', 'impairment', 'seed',
        'fixtureSha256', 'finalStateSha256', 'finalStateEncoding', 'orderedEventsSha256',
        'lifecycleSha256', 'finalTick', 'result',
      ]) ||
      replay.scenarioId !== m.scenarioId || replay.scenarioVersion !== SCENARIO_VERSION ||
      replay.players !== m.players || replay.inputHz !== m.inputHz || replay.snapshotHz !== m.snapshotHz ||
      replay.seed !== m.seed || replay.fixtureSha256 !== m.fixtureSha256 ||
      replay.finalStateEncoding !== (scenario.players <= MAX_SNAPSHOT_FIGHTERS
        ? 'state-snapshot-v1'
        : 'harness-state-json-v1') ||
      !replay.impairment || typeof replay.impairment !== 'object' || Array.isArray(replay.impairment) ||
      !sameImpairment(replay.impairment as Record<string, unknown>, scenario.impairment) ||
      typeof replay.finalStateSha256 !== 'string' || !hash.test(replay.finalStateSha256) ||
      typeof replay.orderedEventsSha256 !== 'string' || !hash.test(replay.orderedEventsSha256) ||
      (scenario.kind === 'lifecycle'
        ? typeof replay.lifecycleSha256 !== 'string' || !hash.test(replay.lifecycleSha256)
        : replay.lifecycleSha256 !== null) ||
      replay.finalTick !== scenario.ticks || replay.result !== NOT_MEASURED) {
    throw new Error('Invalid benchmark manifest');
  }
}
