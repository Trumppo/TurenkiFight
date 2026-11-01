import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isSessionIdentifier } from '../../src/game/session/sessionEnvelope';
import { SUPPORTED_SNAPSHOT_HZ, type SnapshotHz } from '../../src/game/networking/wsMessages';
import { MAX_TICKS } from '../ws/benchmarkSetup';
import type { BotInputPattern } from './botInput';
import {
  MEASURED,
  NOT_MEASURED,
  type BotBandwidth,
  type BotDisconnects,
  type BotDistribution,
  type BotInputCounts,
  type BotMetricsSnapshot,
  type BotNotMeasured,
  type BotPerSecondSample,
  type BotSnapshotInterArrival,
} from './botMetrics';

/**
 * Manifest for one headless bot run (`npm run bot`).
 *
 * Honesty contract:
 * - every metric block is either `MEASURED` from this client's own socket or
 *   `NOT_MEASURED` with a reason; there is no placeholder number;
 * - byte rates are derived from counted frames and the same process's monotonic
 *   window, never from an assumed bandwidth;
 * - `clientViewNote` states in the file that the bot sees only its own view and
 *   cannot observe server-internal tick timing or queueing;
 * - the command line is redacted unless the operator explicitly opted into
 *   recording the server address, so a shared manifest carries no private
 *   address or hostname;
 * - one process writes exactly one manifest, its own.
 *
 * This schema is not a performance report and selects no transport.
 */

export const BOT_MANIFEST_VERSION = 1 as const;
export const BOT_MANIFEST_KIND = 'bot-client-run' as const;
export const BOT_ROLE = 'bot-client' as const;
export const BOT_COMMAND = 'npm run bot' as const;
export const BOT_NOT_MEASURED = NOT_MEASURED;
export const BOT_MEASURED = MEASURED;
export const BOT_ADDRESS_NOT_RECORDED = 'NOT_RECORDED' as const;
export const BOT_FIXTURE_NOT_APPLICABLE = 'NOT_APPLICABLE' as const;

export const BOT_CLIENT_VIEW_NOTE =
  'Measured on the bot client alone: RTT, snapshot inter-arrival and byte counts describe this ' +
  "client's own socket view. Server-internal tick timing, server queueing, packet loss at other " +
  'hops and any other player\'s connection are not visible here and are not claimed.';

export const BOT_NO_PREDICTION_NOTE =
  'No client prediction or reconciliation: input is consumed by the authoritative server, and the ' +
  'observed input latency is therefore RTT plus up to one snapshot interval.';

export const BOT_NETWORK_PATHS = ['loopback', 'lan', 'vm', 'internet'] as const;
export type BotNetworkPath = (typeof BOT_NETWORK_PATHS)[number] | 'NOT_SUPPLIED';

export const BOT_NETWORK_PATH_SOURCES = ['operator', 'loopback-url-default', 'not-supplied'] as const;
export type BotNetworkPathSource = (typeof BOT_NETWORK_PATH_SOURCES)[number];

export type BotCompletion =
  /** The authoritative simulation reached its own result (a full match). */
  | 'completed-match'
  /** The client stopped after the requested `--ticks` bound. */
  | 'tick-bound'
  /** A benchmark server's bounded `run-complete`. */
  | 'run-complete';

export type BotScope = {
  readonly measurement: 'client-socket-view';
  readonly authority: 'remote-authoritative-server';
  readonly prediction: 'none';
  readonly clientViewNote: typeof BOT_CLIENT_VIEW_NOTE;
  readonly noPredictionNote: typeof BOT_NO_PREDICTION_NOTE;
};

export type BotProvenance = {
  readonly command: typeof BOT_COMMAND;
  /** Sanitised argv; the server URL is redacted unless explicitly recorded. */
  readonly cliArguments: string[];
  readonly role: typeof BOT_ROLE;
  readonly pattern: BotInputPattern;
  readonly playerIds: string[];
  readonly plannedTicks: number;
  readonly achievedTicks: number;
  readonly seed: number;
  /** Committed fixture hash for `fixture`, otherwise `NOT_APPLICABLE`. */
  readonly fixtureSha256: string;
  /** SHA-256 of the exact schedule this bot drove, for both patterns. */
  readonly scheduleSha256: string;
  readonly networkPath: BotNetworkPath;
  readonly networkPathSource: BotNetworkPathSource;
  /** `NOT_RECORDED` unless the operator passed `--record-address`. */
  readonly serverAddress: string;
  readonly snapshotHz: SnapshotHz | typeof NOT_MEASURED;
  readonly serverTickRate: number | typeof NOT_MEASURED;
  readonly pingIntervalMs: number;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly osRelease: string;
  readonly architecture: string;
  readonly gitCommitSha: string;
};

export type BotResult = {
  readonly status: BotCompletion;
  readonly finalTick: number;
};

export type BotManifest = {
  readonly schemaVersion: typeof BOT_MANIFEST_VERSION;
  readonly kind: typeof BOT_MANIFEST_KIND;
  readonly runId: string;
  readonly scope: BotScope;
  readonly provenance: BotProvenance;
  readonly metrics: BotMetricsSnapshot;
  readonly result: BotResult;
};

export type BotManifestInput = {
  readonly runId: string;
  readonly provenance: BotProvenance;
  readonly metrics: BotMetricsSnapshot;
  readonly result: BotResult;
};

const RUN_ID = /^[A-Za-z0-9_-]{1,100}$/;
const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NODE_VERSION = /^v\d+\.\d+\.\d+/;
const ERROR_CODE = /^[a-z][a-z0-9-]{0,63}$/;
const WS_URL = /^ws:\/\/\S{1,253}$/;
const EPSILON = 1e-6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const nonEmptyString = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegativeNumber = (value: unknown): value is number => finiteNumber(value) && value >= 0;
const positiveInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max;
const nonnegativeInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const closeEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= Math.max(EPSILON, Math.abs(expected) * 1e-9);

function validDistribution(value: unknown): value is BotDistribution {
  if (!isRecord(value) ||
      !exactKeys(value, ['status', 'unit', 'sampleCount', 'min', 'mean', 'p50', 'p95', 'p99', 'max']) ||
      value.status !== MEASURED || value.unit !== 'milliseconds' || !positiveInteger(value.sampleCount) ||
      !['min', 'mean', 'p50', 'p95', 'p99', 'max'].every(key => nonnegativeNumber(value[key]))) {
    return false;
  }
  const min = value.min as number;
  const mean = value.mean as number;
  const p50 = value.p50 as number;
  const p95 = value.p95 as number;
  const p99 = value.p99 as number;
  const max = value.max as number;
  if (!(min <= p50 && p50 <= p95 && p95 <= p99 && p99 <= max)) return false;
  if (!(mean >= min - EPSILON && mean <= max + EPSILON)) return false;
  // Nearest-rank percentiles are observed samples: n samples cannot report more
  // than n distinct values. This rejects an impossible block with n = 1.
  return new Set([min, p50, p95, p99, max]).size <= (value.sampleCount as number);
}

function validNotMeasured(value: unknown): value is BotNotMeasured {
  return isRecord(value) && exactKeys(value, ['status', 'reason']) &&
    value.status === NOT_MEASURED && nonEmptyString(value.reason, 500);
}

function validSnapshotInterArrival(value: unknown): value is BotSnapshotInterArrival {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'maxGapMs')) return false;
  const { maxGapMs, ...distribution } = value;
  return validDistribution(distribution) && nonnegativeNumber(maxGapMs) && maxGapMs === distribution.max;
}

function validPerSecond(value: unknown): value is BotPerSecondSample {
  return isRecord(value) &&
    exactKeys(value, [
      'second', 'sentBytes', 'receivedBytes', 'sentMessages', 'receivedMessages', 'snapshots', 'pongs',
      'inputsSubmitted',
    ]) &&
    nonnegativeInteger(value.second) &&
    nonnegativeInteger(value.sentBytes) &&
    nonnegativeInteger(value.receivedBytes) &&
    nonnegativeInteger(value.sentMessages) &&
    nonnegativeInteger(value.receivedMessages) &&
    nonnegativeInteger(value.snapshots) &&
    nonnegativeInteger(value.pongs) &&
    nonnegativeInteger(value.inputsSubmitted);
}

function validBandwidth(value: unknown): value is BotBandwidth {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'status', 'windowMs', 'sentBytes', 'receivedBytes', 'sentBytesPerSecond',
        'receivedBytesPerSecond', 'sentMessages', 'receivedMessages', 'perSecond',
      ]) ||
      value.status !== MEASURED || !(finiteNumber(value.windowMs) && (value.windowMs as number) > 0) ||
      !nonnegativeInteger(value.sentBytes) || !nonnegativeInteger(value.receivedBytes) ||
      !positiveInteger(value.sentMessages) || !positiveInteger(value.receivedMessages) ||
      !nonnegativeNumber(value.sentBytesPerSecond) || !nonnegativeNumber(value.receivedBytesPerSecond)) {
    return false;
  }
  const windowMs = value.windowMs as number;
  // A published rate must be reproducible from its own counted bytes and window.
  if (!closeEnough(value.sentBytesPerSecond as number, ((value.sentBytes as number) * 1000) / windowMs) ||
      !closeEnough(value.receivedBytesPerSecond as number, ((value.receivedBytes as number) * 1000) / windowMs)) {
    return false;
  }
  const perSecond = value.perSecond;
  if (!Array.isArray(perSecond) || perSecond.length !== Math.max(1, Math.ceil(windowMs / 1000)) ||
      !perSecond.every((sample, index) => validPerSecond(sample) && sample.second === index)) {
    return false;
  }
  const sum = (pick: (sample: BotPerSecondSample) => number): number =>
    perSecond.reduce((total, sample) => total + pick(sample), 0);
  return sum(sample => sample.sentBytes) === value.sentBytes &&
    sum(sample => sample.receivedBytes) === value.receivedBytes &&
    sum(sample => sample.sentMessages) === value.sentMessages &&
    sum(sample => sample.receivedMessages) === value.receivedMessages;
}

function validInputs(value: unknown): value is BotInputCounts {
  if (!isRecord(value) ||
      !exactKeys(value, ['submitted', 'accepted', 'acceptedBasis', 'lateTicks', 'denied', 'denials']) ||
      !nonnegativeInteger(value.submitted) || !nonnegativeInteger(value.accepted) ||
      value.acceptedBasis !== 'submitted-minus-observed-denials' ||
      !nonnegativeInteger(value.lateTicks) || !nonnegativeInteger(value.denied)) {
    return false;
  }
  const submitted = value.submitted as number;
  const denied = value.denied as number;
  if ((value.accepted as number) !== submitted - denied) return false;
  if ((value.lateTicks as number) > denied) return false;
  const denials = value.denials;
  if (!isRecord(denials)) return false;
  let total = 0;
  for (const [code, count] of Object.entries(denials)) {
    if (!ERROR_CODE.test(code) || !positiveInteger(count)) return false;
    total += count as number;
  }
  return total === denied;
}

function validDisconnects(value: unknown): value is BotDisconnects {
  if (!isRecord(value) ||
      !exactKeys(value, ['observed', 'sessionClosedReasons', 'transportClosed', 'transportErrors']) ||
      !nonnegativeInteger(value.observed) || !Array.isArray(value.sessionClosedReasons) ||
      typeof value.transportClosed !== 'boolean' || !nonnegativeInteger(value.transportErrors)) {
    return false;
  }
  const reasons = value.sessionClosedReasons;
  if (!reasons.every(reason => reason === 'host-lost' || reason === 'match-complete')) return false;
  return value.observed === reasons.length + (value.transportClosed ? 1 : 0);
}

function validateScope(value: unknown): value is BotScope {
  return isRecord(value) &&
    exactKeys(value, ['measurement', 'authority', 'prediction', 'clientViewNote', 'noPredictionNote']) &&
    value.measurement === 'client-socket-view' &&
    value.authority === 'remote-authoritative-server' &&
    value.prediction === 'none' &&
    value.clientViewNote === BOT_CLIENT_VIEW_NOTE &&
    value.noPredictionNote === BOT_NO_PREDICTION_NOTE;
}

function validNetworkPath(value: unknown): value is BotNetworkPath {
  return value === 'NOT_SUPPLIED' || BOT_NETWORK_PATHS.includes(value as (typeof BOT_NETWORK_PATHS)[number]);
}

function validPathSource(value: unknown): value is BotNetworkPathSource {
  return BOT_NETWORK_PATH_SOURCES.includes(value as BotNetworkPathSource);
}

function validateProvenance(value: unknown): value is BotProvenance {
  if (!isRecord(value) ||
      !exactKeys(value, [
        'command', 'cliArguments', 'role', 'pattern', 'playerIds', 'plannedTicks', 'achievedTicks',
        'seed', 'fixtureSha256', 'scheduleSha256', 'networkPath', 'networkPathSource', 'serverAddress',
        'snapshotHz', 'serverTickRate', 'pingIntervalMs', 'nodeVersion', 'platform', 'osRelease',
        'architecture', 'gitCommitSha',
      ]) ||
      value.command !== BOT_COMMAND || value.role !== BOT_ROLE ||
      (value.pattern !== 'fixture' && value.pattern !== 'wander') ||
      !Array.isArray(value.cliArguments) ||
      !value.cliArguments.every(argument => typeof argument === 'string' && argument.length <= 200)) {
    return false;
  }
  const playerIds = value.playerIds;
  if (!Array.isArray(playerIds) || playerIds.length < 1 || playerIds.length > 4 ||
      new Set(playerIds).size !== playerIds.length || !playerIds.every(isSessionIdentifier)) {
    return false;
  }
  if (!positiveInteger(value.plannedTicks, MAX_TICKS) || !nonnegativeInteger(value.achievedTicks, MAX_TICKS)) {
    return false;
  }
  if (!positiveInteger(value.seed, 0xffffffff)) return false;
  if (typeof value.fixtureSha256 !== 'string') return false;
  if (value.pattern === 'fixture'
    ? !HASH.test(value.fixtureSha256)
    : value.fixtureSha256 !== BOT_FIXTURE_NOT_APPLICABLE) {
    return false;
  }
  if (typeof value.scheduleSha256 !== 'string' || !HASH.test(value.scheduleSha256)) return false;
  if (!validNetworkPath(value.networkPath) || !validPathSource(value.networkPathSource)) return false;
  // Path and its source must describe the same fact.
  if (value.networkPathSource === 'operator' && value.networkPath === 'NOT_SUPPLIED') return false;
  if (value.networkPathSource === 'loopback-url-default' && value.networkPath !== 'loopback') return false;
  if (value.networkPathSource === 'not-supplied' && value.networkPath !== 'NOT_SUPPLIED') return false;
  if (value.serverAddress !== BOT_ADDRESS_NOT_RECORDED &&
      (typeof value.serverAddress !== 'string' || !WS_URL.test(value.serverAddress))) {
    return false;
  }
  // Without an explicitly recorded address, no argument may smuggle one back in.
  if (value.serverAddress === BOT_ADDRESS_NOT_RECORDED &&
      value.cliArguments.some(argument => /wss?:\/\//i.test(argument))) {
    return false;
  }
  const snapshotHz = value.snapshotHz;
  if (snapshotHz !== NOT_MEASURED && !SUPPORTED_SNAPSHOT_HZ.includes(snapshotHz as SnapshotHz)) return false;
  if (value.serverTickRate !== NOT_MEASURED && !positiveInteger(value.serverTickRate, 1000)) return false;
  if (!positiveInteger(value.pingIntervalMs, 60000)) return false;
  if (typeof value.nodeVersion !== 'string' || !NODE_VERSION.test(value.nodeVersion)) return false;
  if (!nonEmptyString(value.platform, 64) || !nonEmptyString(value.osRelease, 200) ||
      !nonEmptyString(value.architecture, 64)) {
    return false;
  }
  return value.gitCommitSha === NOT_MEASURED ||
    (typeof value.gitCommitSha === 'string' && COMMIT.test(value.gitCommitSha));
}

function validateMetrics(value: unknown): value is BotMetricsSnapshot {
  if (!isRecord(value) ||
      !exactKeys(value, ['rtt', 'snapshotInterArrival', 'bandwidth', 'inputs', 'disconnects'])) {
    return false;
  }
  const rtt = value.rtt;
  if (!(validDistribution(rtt) || validNotMeasured(rtt))) return false;
  const interArrival = value.snapshotInterArrival;
  if (!(validSnapshotInterArrival(interArrival) || validNotMeasured(interArrival))) return false;
  const bandwidth = value.bandwidth;
  if (!(validBandwidth(bandwidth) || validNotMeasured(bandwidth))) return false;
  return validInputs(value.inputs) && validDisconnects(value.disconnects);
}

function validateResult(value: unknown): value is BotResult {
  return isRecord(value) && exactKeys(value, ['status', 'finalTick']) &&
    (value.status === 'completed-match' || value.status === 'tick-bound' || value.status === 'run-complete') &&
    nonnegativeInteger(value.finalTick, MAX_TICKS);
}

export function createBotManifest(input: BotManifestInput): BotManifest {
  if (!isRecord(input)) throw new Error('Invalid bot manifest input');
  const manifest: BotManifest = {
    schemaVersion: BOT_MANIFEST_VERSION,
    kind: BOT_MANIFEST_KIND,
    runId: input.runId,
    scope: {
      measurement: 'client-socket-view',
      authority: 'remote-authoritative-server',
      prediction: 'none',
      clientViewNote: BOT_CLIENT_VIEW_NOTE,
      noPredictionNote: BOT_NO_PREDICTION_NOTE,
    },
    provenance: { ...input.provenance },
    metrics: input.metrics,
    result: { ...input.result },
  };
  validateBotManifest(manifest);
  return manifest;
}

export function validateBotManifest(value: unknown): asserts value is BotManifest {
  if (!isRecord(value) ||
      !exactKeys(value, ['schemaVersion', 'kind', 'runId', 'scope', 'provenance', 'metrics', 'result']) ||
      value.schemaVersion !== BOT_MANIFEST_VERSION || value.kind !== BOT_MANIFEST_KIND ||
      typeof value.runId !== 'string' || !RUN_ID.test(value.runId) ||
      !validateScope(value.scope) || !validateProvenance(value.provenance) ||
      !validateMetrics(value.metrics) || !validateResult(value.result)) {
    throw new Error('Invalid bot manifest');
  }
  const provenance = value.provenance as BotProvenance;
  const result = value.result as BotResult;
  if (result.finalTick !== provenance.achievedTicks) throw new Error('Invalid bot manifest');
  // A tick-bound completion cannot claim fewer ticks than the operator requested.
  if (result.status === 'tick-bound' && provenance.achievedTicks < provenance.plannedTicks) {
    throw new Error('Invalid bot manifest');
  }
}

/** Writes exactly this run's manifest; refuses to clobber an existing file. */
export function writeBotManifest(path: string, manifest: BotManifest): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('Manifest path is required');
  validateBotManifest(manifest);
  const resolved = resolve(process.cwd(), path);
  if (existsSync(resolved)) throw new Error(`Refusing to overwrite an existing file: ${resolved}`);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return resolved;
}
