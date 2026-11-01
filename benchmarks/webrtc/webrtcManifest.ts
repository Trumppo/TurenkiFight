import { NOT_MEASURED } from '../manifest';
import { SUPPORTED_SNAPSHOT_HZ, type SnapshotHz } from '../../src/game/networking/wsMessages';

/**
 * Machine-readable manifest for the bounded WebRTC architecture-B prototype.
 *
 * Only bounded-tick correctness fingerprints are recorded. The transport is an
 * in-memory ordered DataChannel emulation: there is no ICE, DTLS, TURN or real
 * network path, so latency, bandwidth, CPU and tick pacing stay NOT_MEASURED.
 * This is not a transport comparison and must not be read as one.
 */
export type WebrtcPrototypeManifest = {
  schemaVersion: 1;
  kind: 'webrtc-prototype-run';
  runId: string;
  scenarioId: 'BASE-4-60-20';
  scenarioVersion: 1;
  commitSha: string;
  architecture: 'architecture-b';
  authority: 'browser-host';
  transport: 'webrtc-datachannel-emulated';
  protocolVersion: 1;
  serverMessageVersion: 1;
  players: 4;
  simulationHz: 60;
  inputHz: 60;
  snapshotHz: SnapshotHz;
  maxLeadTicks: number;
  boundedTicks: number;
  fixtureSha256: string;
  seed: number;
  environment: {
    signaling: 'in-memory';
    tls: false;
    turn: false;
    natTraversal: 'not-attempted';
    os: typeof NOT_MEASURED;
    browser: typeof NOT_MEASURED;
    cpu: typeof NOT_MEASURED;
  };
  result: typeof NOT_MEASURED;
  measurements: {
    latency: typeof NOT_MEASURED;
    bandwidth: typeof NOT_MEASURED;
    cpu: typeof NOT_MEASURED;
    tickPacing: typeof NOT_MEASURED;
  };
  correctness: {
    finalTick: number;
    matchesInMemoryReference: boolean;
    finalStateSha256: string;
    referenceFinalStateSha256: string;
    orderedEventsSha256: string;
    referenceOrderedEventsSha256: string;
    lateTicks: number;
    deniedMessages: number;
  };
};

export type WebrtcPrototypeManifestInput = {
  runId: string;
  commitSha: string;
  fixtureSha256: string;
  seed: number;
  snapshotHz: SnapshotHz;
  maxLeadTicks: number;
  boundedTicks: number;
  correctness: WebrtcPrototypeManifest['correctness'];
};

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,100}$/;
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value);

function validateCorrectness(value: unknown): asserts value is WebrtcPrototypeManifest['correctness'] {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'finalTick', 'matchesInMemoryReference', 'finalStateSha256', 'referenceFinalStateSha256',
        'orderedEventsSha256', 'referenceOrderedEventsSha256', 'lateTicks', 'deniedMessages',
      ]) ||
      !nonnegative(value.finalTick) || typeof value.matchesInMemoryReference !== 'boolean' ||
      !hash(value.finalStateSha256) || !hash(value.referenceFinalStateSha256) ||
      !hash(value.orderedEventsSha256) || !hash(value.referenceOrderedEventsSha256) ||
      !nonnegative(value.lateTicks) || !nonnegative(value.deniedMessages)) {
    throw new Error('Invalid WebRTC prototype manifest');
  }
}

export function createWebrtcPrototypeManifest(
  input: WebrtcPrototypeManifestInput,
): WebrtcPrototypeManifest {
  const manifest: WebrtcPrototypeManifest = {
    schemaVersion: 1,
    kind: 'webrtc-prototype-run',
    runId: input.runId,
    scenarioId: 'BASE-4-60-20',
    scenarioVersion: 1,
    commitSha: input.commitSha,
    architecture: 'architecture-b',
    authority: 'browser-host',
    transport: 'webrtc-datachannel-emulated',
    protocolVersion: 1,
    serverMessageVersion: 1,
    players: 4,
    simulationHz: 60,
    inputHz: 60,
    snapshotHz: input.snapshotHz,
    maxLeadTicks: input.maxLeadTicks,
    boundedTicks: input.boundedTicks,
    fixtureSha256: input.fixtureSha256,
    seed: input.seed,
    environment: {
      signaling: 'in-memory',
      tls: false,
      turn: false,
      natTraversal: 'not-attempted',
      os: NOT_MEASURED,
      browser: NOT_MEASURED,
      cpu: NOT_MEASURED,
    },
    result: NOT_MEASURED,
    measurements: {
      latency: NOT_MEASURED,
      bandwidth: NOT_MEASURED,
      cpu: NOT_MEASURED,
      tickPacing: NOT_MEASURED,
    },
    correctness: { ...input.correctness },
  };
  validateWebrtcPrototypeManifest(manifest);
  return manifest;
}

export function validateWebrtcPrototypeManifest(
  value: unknown,
): asserts value is WebrtcPrototypeManifest {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'schemaVersion', 'kind', 'runId', 'scenarioId', 'scenarioVersion', 'commitSha', 'architecture',
        'authority', 'transport', 'protocolVersion', 'serverMessageVersion', 'players', 'simulationHz',
        'inputHz', 'snapshotHz', 'maxLeadTicks', 'boundedTicks', 'fixtureSha256', 'seed', 'environment',
        'result', 'measurements', 'correctness',
      ]) ||
      value.schemaVersion !== 1 || value.kind !== 'webrtc-prototype-run' ||
      typeof value.runId !== 'string' || !RUN_ID.test(value.runId) ||
      value.scenarioId !== 'BASE-4-60-20' || value.scenarioVersion !== 1 ||
      typeof value.commitSha !== 'string' || !COMMIT.test(value.commitSha) ||
      value.architecture !== 'architecture-b' || value.authority !== 'browser-host' ||
      value.transport !== 'webrtc-datachannel-emulated' ||
      value.protocolVersion !== 1 || value.serverMessageVersion !== 1 ||
      value.players !== 4 || value.simulationHz !== 60 || value.inputHz !== 60 ||
      !SUPPORTED_SNAPSHOT_HZ.includes(value.snapshotHz as SnapshotHz) ||
      !nonnegative(value.maxLeadTicks) || (value.maxLeadTicks as number) < 1 ||
      !nonnegative(value.boundedTicks) || (value.boundedTicks as number) < 1 ||
      (value.boundedTicks as number) > 7200 ||
      typeof value.fixtureSha256 !== 'string' || !HASH.test(value.fixtureSha256) ||
      !nonnegative(value.seed) || (value.seed as number) < 1 || (value.seed as number) > 0xffffffff) {
    throw new Error('Invalid WebRTC prototype manifest');
  }

  const environment = value.environment;
  if (!isRecord(environment) ||
      !exactKeys(environment, ['signaling', 'tls', 'turn', 'natTraversal', 'os', 'browser', 'cpu']) ||
      environment.signaling !== 'in-memory' || environment.tls !== false || environment.turn !== false ||
      environment.natTraversal !== 'not-attempted' ||
      environment.os !== NOT_MEASURED || environment.browser !== NOT_MEASURED ||
      environment.cpu !== NOT_MEASURED) {
    throw new Error('Invalid WebRTC prototype manifest');
  }

  // Missing performance data must stay explicit; zero is not a substitute.
  if (value.result !== NOT_MEASURED) throw new Error('Invalid WebRTC prototype manifest');
  const measurements = value.measurements;
  if (!isRecord(measurements) ||
      !exactKeys(measurements, ['latency', 'bandwidth', 'cpu', 'tickPacing']) ||
      measurements.latency !== NOT_MEASURED || measurements.bandwidth !== NOT_MEASURED ||
      measurements.cpu !== NOT_MEASURED || measurements.tickPacing !== NOT_MEASURED) {
    throw new Error('Invalid WebRTC prototype manifest');
  }

  validateCorrectness(value.correctness);
  const correctness = value.correctness as WebrtcPrototypeManifest['correctness'];
  if (correctness.finalTick > (value.boundedTicks as number)) {
    throw new Error('Invalid WebRTC prototype manifest');
  }
  if (correctness.matchesInMemoryReference !==
      (correctness.finalStateSha256 === correctness.referenceFinalStateSha256 &&
       correctness.orderedEventsSha256 === correctness.referenceOrderedEventsSha256)) {
    throw new Error('Invalid WebRTC prototype manifest');
  }
}
