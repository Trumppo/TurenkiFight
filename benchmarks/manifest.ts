import type { BenchmarkFixture, BenchmarkReplay } from './inMemory';
import { BASELINE_SCENARIO, BENCHMARK_SIMULATION_HZ } from './inMemory';

export const NOT_MEASURED = 'NOT_MEASURED' as const;
export type BenchmarkManifest = {
  schemaVersion: 1;
  runId: string;
  scenarioId: typeof BASELINE_SCENARIO;
  commitSha: string;
  transport: 'in-memory';
  authority: 'in-process';
  protocolVersion: 1;
  fixtureSha256: string;
  seed: number;
  players: 4;
  localSlotsPerClient: [1, 1, 1, 1];
  simulationHz: 60;
  inputHz: 60;
  snapshotHz: 20;
  matchSeconds: 120;
  impairment: { rttMs: 0; jitterMs: 0; lossPercent: 0 };
  environment: { network: 'in-process'; os: typeof NOT_MEASURED; browser: typeof NOT_MEASURED; cpu: typeof NOT_MEASURED; turn: false };
  result: typeof NOT_MEASURED;
  replay: BenchmarkReplay;
};

const hash = /^[0-9a-f]{64}$/;
const commit = /^[0-9a-f]{40}$/;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(k => allowed.includes(k));

/** No invented latency, throughput, hardware or transport metrics. */
export function createUnmeasuredManifest(fixture: BenchmarkFixture, replay: BenchmarkReplay, commitSha: string, runId: string): BenchmarkManifest {
  const manifest: BenchmarkManifest = {
    schemaVersion: 1, runId, scenarioId: BASELINE_SCENARIO, commitSha,
    transport: 'in-memory', authority: 'in-process', protocolVersion: 1,
    fixtureSha256: fixture.fixtureSha256, seed: fixture.seed, players: 4,
    localSlotsPerClient: [1, 1, 1, 1], simulationHz: BENCHMARK_SIMULATION_HZ,
    inputHz: 60, snapshotHz: 20, matchSeconds: 120,
    impairment: { rttMs: 0, jitterMs: 0, lossPercent: 0 },
    environment: { network: 'in-process', os: NOT_MEASURED, browser: NOT_MEASURED, cpu: NOT_MEASURED, turn: false },
    result: NOT_MEASURED, replay,
  };
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(value: unknown): asserts value is BenchmarkManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid benchmark manifest');
  const m = value as Record<string, unknown>;
  if (!keys(m, ['schemaVersion','runId','scenarioId','commitSha','transport','authority','protocolVersion','fixtureSha256','seed','players','localSlotsPerClient','simulationHz','inputHz','snapshotHz','matchSeconds','impairment','environment','result','replay']) ||
      m.schemaVersion !== 1 || typeof m.runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(m.runId) ||
      typeof m.commitSha !== 'string' || !commit.test(m.commitSha) ||
      m.scenarioId !== BASELINE_SCENARIO || m.transport !== 'in-memory' || m.authority !== 'in-process' ||
      m.protocolVersion !== 1 || typeof m.fixtureSha256 !== 'string' || !hash.test(m.fixtureSha256) ||
      !Number.isSafeInteger(m.seed) || (m.seed as number) < 1 || (m.seed as number) > 0xffffffff ||
      m.players !== 4 || !Array.isArray(m.localSlotsPerClient) ||
      JSON.stringify(m.localSlotsPerClient) !== '[1,1,1,1]' ||
      m.simulationHz !== 60 || m.inputHz !== 60 || m.snapshotHz !== 20 || m.matchSeconds !== 120 ||
      m.result !== NOT_MEASURED) throw new Error('Invalid benchmark manifest');
  const impairment = m.impairment as Record<string, unknown> | null;
  const env = m.environment as Record<string, unknown> | null;
  const replay = m.replay as Record<string, unknown> | null;
  if (!impairment || typeof impairment !== 'object' || Array.isArray(impairment) ||
      !keys(impairment, ['rttMs','jitterMs','lossPercent']) ||
      impairment.rttMs !== 0 || impairment.jitterMs !== 0 || impairment.lossPercent !== 0 ||
      !env || typeof env !== 'object' || Array.isArray(env) ||
      !keys(env, ['network','os','browser','cpu','turn']) ||
      env.network !== 'in-process' || env.os !== NOT_MEASURED || env.browser !== NOT_MEASURED ||
      env.cpu !== NOT_MEASURED || env.turn !== false ||
      !replay || typeof replay !== 'object' || Array.isArray(replay) ||
      !keys(replay, ['scenarioId','seed','fixtureSha256','finalStateSha256','orderedEventsSha256','finalTick','result']) ||
      replay.scenarioId !== m.scenarioId || replay.seed !== m.seed ||
      replay.fixtureSha256 !== m.fixtureSha256 ||
      typeof replay.finalStateSha256 !== 'string' || !hash.test(replay.finalStateSha256) ||
      typeof replay.orderedEventsSha256 !== 'string' || !hash.test(replay.orderedEventsSha256) ||
      replay.finalTick !== 7200 || replay.result !== NOT_MEASURED) throw new Error('Invalid benchmark manifest');
}
