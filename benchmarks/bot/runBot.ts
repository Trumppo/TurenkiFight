import {
  MAX_TICKS,
  WS_BENCHMARK_ROSTER,
  isBotInputPattern,
  type BotInputPattern,
} from './botInput';
import { defaultRunTimeoutMs } from '../ws/benchmarkSetup';
import { BOT_NETWORK_PATHS, writeBotManifest, type BotNetworkPath } from './botManifest';
import { describeBotFailure, runBotClient } from './botClient';

/**
 * CLI entry for `npm run bot`.
 *
 * One process = one socket = one bot. It joins the requested slots against a
 * running match server, plays a deterministic input schedule and writes exactly
 * one manifest it owns. Nothing here measures the server, and no browser is
 * involved.
 *
 * Exit codes:
 *   0  the match completed or the `--ticks` bound was reached;
 *   2  invalid arguments (usage is printed);
 *   1  failed join, wrong grant, connect error, timeout or any other run failure,
 *      with one stderr line and no manifest.
 */

export const DEFAULT_BOT_TICKS = MAX_TICKS;
export const DEFAULT_PING_INTERVAL_MS = 250;

export type BotCliOptions = {
  readonly url: string | null;
  readonly playerIds: readonly string[];
  readonly pattern: BotInputPattern;
  readonly ticks: number;
  readonly seed: number | null;
  readonly pingIntervalMs: number;
  readonly timeoutMs: number;
  readonly outPath: string | null;
  readonly networkPath: BotNetworkPath | null;
  readonly recordAddress: boolean;
  readonly help: boolean;
};

export type BotCliIo = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
};

const defaultIo: BotCliIo = {
  stdout: line => process.stdout.write(`${line}\n`),
  stderr: line => process.stderr.write(`${line}\n`),
};

function positiveInteger(raw: string, maximum: number, label: string, minimum = 1): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${label}: ${raw}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label}: ${raw} (expected ${minimum}..${maximum})`);
  }
  return value;
}

function parsePlayers(raw: string): readonly string[] {
  const entries = raw.split(',').map(entry => entry.trim());
  if (entries.length < 1 || entries.length > 4) throw new Error(`--players requires 1..4 slots: ${raw}`);
  if (entries.some(entry => entry.length === 0)) throw new Error(`--players contains an empty slot: ${raw}`);
  if (new Set(entries).size !== entries.length) throw new Error(`--players contains a duplicate slot: ${raw}`);
  for (const entry of entries) {
    if (!WS_BENCHMARK_ROSTER.includes(entry)) {
      throw new Error(`Unknown player slot: ${entry} (expected ${WS_BENCHMARK_ROSTER.join(', ')})`);
    }
  }
  return entries;
}

function parseNetworkPath(raw: string): BotNetworkPath {
  if (!BOT_NETWORK_PATHS.includes(raw as (typeof BOT_NETWORK_PATHS)[number])) {
    throw new Error(`Invalid --path: ${raw} (expected ${BOT_NETWORK_PATHS.join(', ')})`);
  }
  return raw as BotNetworkPath;
}

function validateUrl(raw: string): string {
  if (!raw.startsWith('ws://')) throw new Error('--url must be a ws:// URL (TLS is not implemented)');
  if (/\s/.test(raw)) throw new Error('--url must not contain whitespace');
  return raw;
}

/** Pure argument parser so every usage error is testable without a socket. */
export function parseBotArgs(argv: readonly string[]): BotCliOptions {
  let url: string | null = null;
  let playerIds: readonly string[] = [];
  let pattern: BotInputPattern = 'fixture';
  let ticks = DEFAULT_BOT_TICKS;
  let seed: number | null = null;
  let pingIntervalMs = DEFAULT_PING_INTERVAL_MS;
  let timeoutMs: number | null = null;
  let outPath: string | null = null;
  let networkPath: BotNetworkPath | null = null;
  let recordAddress = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--record-address') {
      recordAddress = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const separator = arg.indexOf('=');
    if (separator < 0) throw new Error(`Argument must be --name=value: ${arg}`);
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    switch (name) {
      case 'url':
        url = validateUrl(value);
        break;
      case 'players':
        playerIds = parsePlayers(value);
        break;
      case 'pattern':
        if (!isBotInputPattern(value)) throw new Error(`Invalid --pattern: ${value} (expected fixture or wander)`);
        pattern = value;
        break;
      case 'ticks':
        ticks = positiveInteger(value, MAX_TICKS, 'tick count');
        break;
      case 'seed':
        seed = positiveInteger(value, 0xffffffff, 'seed');
        break;
      case 'ping-interval-ms':
        pingIntervalMs = positiveInteger(value, 60000, 'ping interval');
        break;
      case 'timeout-ms':
        timeoutMs = positiveInteger(value, 30 * 60 * 1000, 'run timeout');
        break;
      case 'out':
        if (value.length === 0) throw new Error('--out requires a path');
        outPath = value;
        break;
      case 'path':
        networkPath = parseNetworkPath(value);
        break;
      default:
        throw new Error(`Unknown option: --${name}`);
    }
  }

  if (help) {
    return {
      url,
      playerIds,
      pattern,
      ticks,
      seed,
      pingIntervalMs,
      timeoutMs: timeoutMs ?? defaultRunTimeoutMs('interval', ticks),
      outPath,
      networkPath,
      recordAddress,
      help,
    };
  }
  if (url === null) throw new Error('--url=ws://HOST:PORT is required');
  if (playerIds.length === 0) throw new Error('--players=P2,P3,P4 is required');
  if (pattern === 'fixture' && seed !== null) throw new Error('--seed is only valid with --pattern=wander');

  return {
    url,
    playerIds,
    pattern,
    ticks,
    seed,
    pingIntervalMs,
    timeoutMs: timeoutMs ?? defaultRunTimeoutMs('interval', ticks),
    outPath,
    networkPath,
    recordAddress,
    help,
  };
}

export function botUsage(): string {
  return [
    'Usage: npm run bot -- --url=ws://HOST:PORT --players=P2,P3,P4 [options]',
    '',
    'A headless Node player for the real-match server (no browser, no rendering, no prediction).',
    '',
    'Options:',
    '  --url=<ws://host:port>  Match server URL (required; ws:// only, no TLS)',
    '  --players=<slots>       Comma-separated slots to claim, e.g. P2,P3,P4 (required)',
    '  --pattern=<pattern>     fixture (committed BASE-4 inputs) or wander (seeded walk)',
    '                          (default fixture)',
    `  --ticks=<1-${MAX_TICKS}>       Authoritative ticks to play before exiting (default ${DEFAULT_BOT_TICKS})`,
    '  --seed=<1-4294967295>   Wander seed (default 1337; only with --pattern=wander)',
    '  --ping-interval-ms=<ms> Ping period used for RTT sampling (default 250)',
    '  --timeout-ms=<ms>       Whole-run hang guard (default: 30 s + the planned ticks)',
    '  --out=<path>            Manifest path (default benchmarks/out/bot-<runId>.json)',
    '  --path=<label>          Network path label: loopback, lan, vm or internet. Recorded',
    '                          only when supplied; a loopback URL defaults to loopback.',
    '  --record-address        Store the server URL in the manifest (off by default)',
    '  --help                  Show this text',
    '',
    'Exit codes: 0 completed match or tick bound, 2 invalid arguments, 1 run failure.',
    'One JSON result line goes to stdout; human-readable status goes to stderr.',
    'A failed run writes no manifest. ws:// is unencrypted: LAN or VPN only.',
  ].join('\n');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The command recorded in the manifest, with the server address redacted. */
export function manifestArguments(options: BotCliOptions): string[] {
  const args = [
    `--url=${options.recordAddress ? options.url ?? '' : '<redacted>'}`,
    `--players=${options.playerIds.join(',')}`,
    `--pattern=${options.pattern}`,
    `--ticks=${options.ticks}`,
  ];
  if (options.seed !== null) args.push(`--seed=${options.seed}`);
  if (options.pingIntervalMs !== DEFAULT_PING_INTERVAL_MS) {
    args.push(`--ping-interval-ms=${options.pingIntervalMs}`);
  }
  if (options.networkPath !== null) args.push(`--path=${options.networkPath}`);
  if (options.recordAddress) args.push('--record-address');
  return args;
}

export async function runBot(argv: readonly string[], io: BotCliIo = defaultIo): Promise<number> {
  let options: BotCliOptions;
  try {
    options = parseBotArgs(argv);
  } catch (error) {
    io.stderr(`bot: ${oneLine(error instanceof Error ? error.message : String(error))}`);
    io.stderr(botUsage());
    return 2;
  }
  if (options.help || options.url === null) {
    io.stdout(botUsage());
    return options.help ? 0 : 2;
  }

  const runId = `bot-${options.playerIds.join('-')}-${Date.now()}`;
  const prefix = `bot ${options.playerIds.join(',')}: `;
  try {
    const { manifest } = await runBotClient({
      url: options.url,
      playerIds: options.playerIds,
      pattern: options.pattern,
      ticks: options.ticks,
      ...(options.seed === null ? {} : { seed: options.seed }),
      pingIntervalMs: options.pingIntervalMs,
      timeoutMs: options.timeoutMs,
      ...(options.networkPath === null ? {} : { networkPath: options.networkPath }),
      cliArguments: manifestArguments(options),
      ...(options.recordAddress ? { serverAddress: options.url } : {}),
      runId,
      onStatus: line => io.stderr(`${prefix}${oneLine(line)}`),
    });

    const outPath = options.outPath ?? `benchmarks/out/${runId}.json`;
    let manifestPath: string;
    try {
      manifestPath = writeBotManifest(outPath, manifest);
    } catch (error) {
      io.stderr(`bot: could not write the manifest: ${oneLine(error instanceof Error ? error.message : String(error))}`);
      return 1;
    }
    io.stdout(JSON.stringify({
      kind: 'bot-client-result',
      role: manifest.provenance.role,
      manifest: manifestPath,
      runId: manifest.runId,
      playerIds: manifest.provenance.playerIds,
      pattern: manifest.provenance.pattern,
      plannedTicks: manifest.provenance.plannedTicks,
      achievedTicks: manifest.provenance.achievedTicks,
      completion: manifest.result.status,
      snapshotHz: manifest.provenance.snapshotHz,
      networkPath: manifest.provenance.networkPath,
      rtt: manifest.metrics.rtt,
      snapshotInterArrival: manifest.metrics.snapshotInterArrival,
      inputs: manifest.metrics.inputs,
    }));
    return 0;
  } catch (error) {
    const failure = describeBotFailure(error);
    io.stderr(`bot: ${failure.reason}: ${oneLine(failure.message)}`);
    return 1;
  }
}
