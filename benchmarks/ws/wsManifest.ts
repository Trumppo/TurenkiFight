import { NOT_MEASURED } from '../manifest';
import { SUPPORTED_SNAPSHOT_HZ, type SnapshotHz } from '../../src/game/networking/wsMessages';
import { WS_BENCHMARK_PLAYER_COUNT, type WsBenchmarkPlayerCount } from './benchmarkSetup';

/**
 * Machine-readable manifest for the WebSocket prototype run.
 *
 * Only bounded-tick correctness fingerprints and explicit topology metadata are
 * recorded. Latency, bandwidth, CPU and tick pacing are explicitly
 * NOT_MEASURED: the default run is one process on a loopback ephemeral port and
 * a split run only proves that the roles can be executed on separate machines.
 * Neither variant is a transport comparison or a performance report.
 *
 * `tickMode` and `pacing` make the difference between a timer-driven run and an
 * on-demand correctness run explicit, so a fast 7200-tick pass can never be
 * mistaken for a real-time pacing measurement.
 *
 * Schema 3 adds the `topology` block. Schema 1 manifests had no tick mode and
 * schema 2 manifests had no topology; both are rejected.
 */
export type WsBenchmarkTickMode = 'interval' | 'manual';

/**
 * `timer-driven-approximation` uses real 60 Hz timers but still records no
 * pacing number; `unsynchronized-correctness` steps as fast as loopback I/O
 * allows and is a correctness mode only.
 */
export type WsBenchmarkPacing = 'timer-driven-approximation' | 'unsynchronized-correctness';

/** Who wrote this manifest. Only the coordinator role writes one. */
export type WsBenchmarkTopologyRole = 'loopback' | 'server-coordinator';

/**
 * `loopback` is the single-process default. `network` records that the server
 * and client roles ran as separate processes over sockets; it does not claim
 * that the run crossed a LAN or the internet, and it is not a measurement.
 */
export type WsBenchmarkTopologyMode = 'loopback' | 'network';

export type WsBenchmarkTopology = {
  role: WsBenchmarkTopologyRole;
  mode: WsBenchmarkTopologyMode;
  /** True when the operator supplied an explicit `--host`. */
  bindHostProvided: boolean;
  /** True when the operator supplied an explicit `--port`. */
  bindPortProvided: boolean;
  /** Synthetic client connections that fed fixture input for this run. */
  clientCount: number;
  /** True only for the single-process loopback role. */
  clientsInProcess: boolean;
  /** The prototype transport is plain `ws`; no TLS anywhere. */
  tls: false;
};

export type WsPrototypeManifest = {
  schemaVersion: 3;
  kind: 'ws-prototype-run';
  runId: string;
  scenarioId: 'BASE-4-60-20' | 'BASE-8-60-20';
  scenarioVersion: 1;
  commitSha: string;
  architecture: 'architecture-a';
  authority: 'authoritative-server';
  transport: 'ws-central';
  protocolVersion: 1;
  serverMessageVersion: 1;
  players: WsBenchmarkPlayerCount;
  simulationHz: 60;
  inputHz: 60;
  snapshotHz: SnapshotHz;
  maxLeadTicks: number;
  boundedTicks: number;
  tickMode: WsBenchmarkTickMode;
  pacing: WsBenchmarkPacing;
  fixtureSha256: string;
  seed: number;
  topology: WsBenchmarkTopology;
  environment: {
    /** Loopback address for the default role; the bind host is never recorded. */
    bindAddress: '127.0.0.1' | 'NOT_RECORDED';
    tls: false;
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

/**
 * Topology is derived from the role, not from free-form input, so a created
 * manifest cannot describe itself inconsistently. The validator still checks
 * every field because a manifest may come from disk.
 */
export type WsPrototypeManifestTopologyInput = {
  role: WsBenchmarkTopologyRole;
  /** Required (and required to be true) for the `server-coordinator` role. */
  bindHostProvided?: boolean;
  bindPortProvided?: boolean;
};

export type WsPrototypeManifestInput = {
  runId: string;
  commitSha: string;
  fixtureSha256: string;
  seed: number;
  snapshotHz: SnapshotHz;
  maxLeadTicks: number;
  boundedTicks: number;
  tickMode: WsBenchmarkTickMode;
  playerCount?: WsBenchmarkPlayerCount;
  /** Defaults to the single-process loopback topology. */
  topology?: WsPrototypeManifestTopologyInput;
  correctness: WsPrototypeManifest['correctness'];
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

export function pacingForTickMode(tickMode: WsBenchmarkTickMode): WsBenchmarkPacing {
  return tickMode === 'interval' ? 'timer-driven-approximation' : 'unsynchronized-correctness';
}

function topologyFor(input: WsPrototypeManifestTopologyInput, playerCount: WsBenchmarkPlayerCount): WsBenchmarkTopology {
  if (!isRecord(input) || (input.role !== 'loopback' && input.role !== 'server-coordinator')) {
    throw new Error('Invalid WS prototype manifest');
  }
  const bindHostProvided = input.bindHostProvided ?? false;
  const bindPortProvided = input.bindPortProvided ?? false;
  if (typeof bindHostProvided !== 'boolean' || typeof bindPortProvided !== 'boolean') {
    throw new Error('Invalid WS prototype manifest');
  }
  if (input.role === 'loopback') {
    // The default role always binds 127.0.0.1 on an ephemeral port; an explicit
    // bind would make it something else and must not be recorded as loopback.
    if (bindHostProvided || bindPortProvided) throw new Error('Invalid WS prototype manifest');
    return {
      role: 'loopback',
      mode: 'loopback',
      bindHostProvided: false,
      bindPortProvided: false,
      clientCount: playerCount,
      clientsInProcess: true,
      tls: false,
    };
  }
  // A network run must be addressable from another machine: both bind inputs
  // are explicit, and the client count is the full roster in separate processes.
  if (!bindHostProvided || !bindPortProvided) throw new Error('Invalid WS prototype manifest');
  return {
    role: 'server-coordinator',
    mode: 'network',
    bindHostProvided: true,
    bindPortProvided: true,
    clientCount: playerCount,
    clientsInProcess: false,
    tls: false,
  };
}

function validateCorrectness(value: unknown): asserts value is WsPrototypeManifest['correctness'] {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'finalTick', 'matchesInMemoryReference', 'finalStateSha256', 'referenceFinalStateSha256',
        'orderedEventsSha256', 'referenceOrderedEventsSha256', 'lateTicks', 'deniedMessages',
      ]) ||
      !nonnegative(value.finalTick) || typeof value.matchesInMemoryReference !== 'boolean' ||
      !hash(value.finalStateSha256) || !hash(value.referenceFinalStateSha256) ||
      !hash(value.orderedEventsSha256) || !hash(value.referenceOrderedEventsSha256) ||
      !nonnegative(value.lateTicks) || !nonnegative(value.deniedMessages)) {
    throw new Error('Invalid WS prototype manifest');
  }
}

function validateTopology(value: unknown, playerCount: WsBenchmarkPlayerCount): asserts value is WsBenchmarkTopology {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'role', 'mode', 'bindHostProvided', 'bindPortProvided', 'clientCount', 'clientsInProcess', 'tls',
      ]) ||
      (value.role !== 'loopback' && value.role !== 'server-coordinator') ||
      (value.mode !== 'loopback' && value.mode !== 'network') ||
      typeof value.bindHostProvided !== 'boolean' || typeof value.bindPortProvided !== 'boolean' ||
      value.clientCount !== playerCount ||
      typeof value.clientsInProcess !== 'boolean' || value.tls !== false) {
    throw new Error('Invalid WS prototype manifest');
  }
  // Role, mode and bind inputs must describe the same topology.
  const expected = value.role === 'loopback'
    ? {
        mode: 'loopback',
        bindHostProvided: false,
        bindPortProvided: false,
        clientsInProcess: true,
      }
    : {
        mode: 'network',
        bindHostProvided: true,
        bindPortProvided: true,
        clientsInProcess: false,
      };
  if (value.mode !== expected.mode ||
      value.bindHostProvided !== expected.bindHostProvided ||
      value.bindPortProvided !== expected.bindPortProvided ||
      value.clientsInProcess !== expected.clientsInProcess) {
    throw new Error('Invalid WS prototype manifest');
  }
}

export function createWsPrototypeManifest(input: WsPrototypeManifestInput): WsPrototypeManifest {
  const playerCount = input.playerCount ?? WS_BENCHMARK_PLAYER_COUNT;
  const topology = topologyFor(input.topology ?? { role: 'loopback' }, playerCount);
  const manifest: WsPrototypeManifest = {
    schemaVersion: 3,
    kind: 'ws-prototype-run',
    runId: input.runId,
    scenarioId: playerCount === 8 ? 'BASE-8-60-20' : 'BASE-4-60-20',
    scenarioVersion: 1,
    commitSha: input.commitSha,
    architecture: 'architecture-a',
    authority: 'authoritative-server',
    transport: 'ws-central',
    protocolVersion: 1,
    serverMessageVersion: 1,
    players: playerCount,
    simulationHz: 60,
    inputHz: 60,
    snapshotHz: input.snapshotHz,
    maxLeadTicks: input.maxLeadTicks,
    boundedTicks: input.boundedTicks,
    tickMode: input.tickMode,
    pacing: pacingForTickMode(input.tickMode),
    fixtureSha256: input.fixtureSha256,
    seed: input.seed,
    topology,
    environment: {
      bindAddress: topology.role === 'loopback' ? '127.0.0.1' : 'NOT_RECORDED',
      tls: false,
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
  validateWsPrototypeManifest(manifest);
  return manifest;
}

export function validateWsPrototypeManifest(value: unknown): asserts value is WsPrototypeManifest {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'schemaVersion', 'kind', 'runId', 'scenarioId', 'scenarioVersion', 'commitSha', 'architecture',
        'authority', 'transport', 'protocolVersion', 'serverMessageVersion', 'players', 'simulationHz',
        'inputHz', 'snapshotHz', 'maxLeadTicks', 'boundedTicks', 'tickMode', 'pacing', 'fixtureSha256',
        'seed', 'topology', 'environment', 'result', 'measurements', 'correctness',
      ]) ||
      value.schemaVersion !== 3 || value.kind !== 'ws-prototype-run' ||
      typeof value.runId !== 'string' || !RUN_ID.test(value.runId) ||
      (value.scenarioId !== 'BASE-4-60-20' && value.scenarioId !== 'BASE-8-60-20') ||
      value.scenarioVersion !== 1 ||
      typeof value.commitSha !== 'string' || !COMMIT.test(value.commitSha) ||
      value.architecture !== 'architecture-a' || value.authority !== 'authoritative-server' ||
      value.transport !== 'ws-central' || value.protocolVersion !== 1 || value.serverMessageVersion !== 1 ||
      (value.players !== 4 && value.players !== 8) ||
      value.scenarioId !== (value.players === 8 ? 'BASE-8-60-20' : 'BASE-4-60-20') ||
      value.simulationHz !== 60 || value.inputHz !== 60 ||
      !SUPPORTED_SNAPSHOT_HZ.includes(value.snapshotHz as SnapshotHz) ||
      !nonnegative(value.maxLeadTicks) || (value.maxLeadTicks as number) < 1 ||
      !nonnegative(value.boundedTicks) || (value.boundedTicks as number) < 1 ||
      (value.boundedTicks as number) > 7200 ||
      (value.tickMode !== 'interval' && value.tickMode !== 'manual') ||
      value.pacing !== pacingForTickMode(value.tickMode) ||
      typeof value.fixtureSha256 !== 'string' || !HASH.test(value.fixtureSha256) ||
      !nonnegative(value.seed) || (value.seed as number) < 1 || (value.seed as number) > 0xffffffff) {
    throw new Error('Invalid WS prototype manifest');
  }

  validateTopology(value.topology, value.players as WsBenchmarkPlayerCount);

  const environment = value.environment;
  if (!isRecord(environment) ||
      !exactKeys(environment, ['bindAddress', 'tls', 'os', 'browser', 'cpu']) ||
      environment.tls !== false ||
      environment.os !== NOT_MEASURED || environment.browser !== NOT_MEASURED || environment.cpu !== NOT_MEASURED) {
    throw new Error('Invalid WS prototype manifest');
  }
  // The default role may record its loopback address; a split run must not
  // disclose the operator's bind address at all.
  const expectedBindAddress = value.topology.role === 'loopback' ? '127.0.0.1' : 'NOT_RECORDED';
  if (environment.bindAddress !== expectedBindAddress) throw new Error('Invalid WS prototype manifest');

  // Missing performance data must stay explicit; zero is not a substitute.
  if (value.result !== NOT_MEASURED) throw new Error('Invalid WS prototype manifest');
  const measurements = value.measurements;
  if (!isRecord(measurements) ||
      !exactKeys(measurements, ['latency', 'bandwidth', 'cpu', 'tickPacing']) ||
      measurements.latency !== NOT_MEASURED || measurements.bandwidth !== NOT_MEASURED ||
      measurements.cpu !== NOT_MEASURED || measurements.tickPacing !== NOT_MEASURED) {
    throw new Error('Invalid WS prototype manifest');
  }

  validateCorrectness(value.correctness);
  const correctness = value.correctness as WsPrototypeManifest['correctness'];
  if (correctness.finalTick > (value.boundedTicks as number)) throw new Error('Invalid WS prototype manifest');
  if (correctness.matchesInMemoryReference !==
      (correctness.finalStateSha256 === correctness.referenceFinalStateSha256 &&
       correctness.orderedEventsSha256 === correctness.referenceOrderedEventsSha256)) {
    throw new Error('Invalid WS prototype manifest');
  }
}
