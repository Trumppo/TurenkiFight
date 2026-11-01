/**
 * `npm run measure:local`
 *
 * Produces one machine-readable local measurement and a short Markdown summary
 * under `benchmarks/results/`. The command runs on one machine and opens no
 * network path. Provenance (command, environment, git SHA, fixture hash, seed,
 * sample counts and warm-up policy) is embedded in the JSON.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform as osPlatform, arch as osArch, release as osRelease } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import {
  LOCAL_MANIFEST_VERSION,
  LOCAL_NOT_MEASURED,
  createLocalManifest,
  type LocalMeasurementManifest,
  type LocalProvenance,
} from './manifest';
import {
  DEFAULT_EVENT_LOOP_TICKS,
  DEFAULT_MEASURED_TICKS,
  DEFAULT_WARMUP_TICKS,
  runLocalMeasurement,
} from './measure';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(entry => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function integerArgument(raw: string | undefined, fallback: number, max: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${label}: ${raw}`);
  return value;
}

function eventLoopArguments(): number {
  const toggle = argument('event-loop');
  if (toggle === 'off') return 0;
  if (toggle !== undefined && toggle !== 'on') throw new Error(`Invalid event loop setting: ${toggle}`);
  return integerArgument(argument('event-loop-ticks'), DEFAULT_EVENT_LOOP_TICKS, DEFAULT_MEASURED_TICKS, 'event-loop ticks');
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

function runStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

/**
 * Only measurement-affecting flags are recorded. `--out` is excluded so a local
 * file path (which may contain a user name) never enters the committed result.
 */
function recordedArguments(): string[] {
  return process.argv.filter(entry =>
    entry.startsWith('--') && !entry.startsWith('--out=') && entry !== '--out');
}

function buildProvenance(
  sections: Awaited<ReturnType<typeof runLocalMeasurement>>,
  measuredTicks: number,
  warmupTicks: number,
): LocalProvenance {
  const cpu = cpus();
  const model = cpu[0]?.model?.trim();
  if (!model) throw new Error('Could not read the CPU model for provenance');
  if (cpu.length < 1) throw new Error('Could not read the logical core count for provenance');
  const commitSha = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('Could not read the git commit SHA for provenance');
  const dirty = git(['status', '--porcelain']).length > 0;
  return {
    command: 'npm run measure:local',
    cliArguments: recordedArguments(),
    nodeVersion: process.version,
    platform: osPlatform(),
    osRelease: osRelease(),
    architecture: osArch(),
    cpuModel: model,
    logicalCores: cpu.length,
    gitCommitSha: commitSha,
    workingTreeDirty: dirty,
    fixtureSha256: sections.fixture.fixtureSha256,
    seed: sections.fixture.seed,
    measuredTicks,
    warmupTicks,
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

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const mib = (bytes: number): string => fixed(bytes / (1024 * 1024), 1);

function renderSummary(manifest: LocalMeasurementManifest): string {
  const input = manifest.codecBytes.inputs;
  const tick = manifest.simulationTicks;
  const resources = manifest.processResources;
  const lines: string[] = [];
  lines.push(`# Single-machine local measurement \`${manifest.runId}\``, '');
  lines.push('**Scope:** one machine, no network path. This is not a network measurement and selects no transport.', '');
  lines.push('## Provenance', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Command | \`${manifest.provenance.command}\` |`);
  lines.push(`| Recorded flags | \`${manifest.provenance.cliArguments.join(' ') || '(none)'}\` |`);
  lines.push(`| Node | ${manifest.provenance.nodeVersion} |`);
  lines.push(`| OS | ${manifest.provenance.platform} ${manifest.provenance.osRelease} (${manifest.provenance.architecture}) |`);
  lines.push(`| CPU | ${manifest.provenance.cpuModel} (${manifest.provenance.logicalCores} logical cores) |`);
  lines.push(`| Git | \`${manifest.provenance.gitCommitSha}\` (working tree dirty: ${manifest.provenance.workingTreeDirty ? 'yes' : 'no'}) |`);
  lines.push(`| Fixture | \`${manifest.provenance.fixtureSha256}\` seed ${manifest.provenance.seed} |`);
  lines.push(`| Ticks | ${manifest.provenance.measuredTicks} measured; ${manifest.provenance.warmupTicks} warm-up ticks discarded on a separate state |`);
  lines.push(`| Schema | local v${LOCAL_MANIFEST_VERSION}, kind \`${manifest.kind}\` |`, '');
  lines.push('## Input bytes (4 players, 60 Hz)', '');
  lines.push('| Encoding | samples | min B | mean B | max B | B/tick | B/s |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(`| Bundled canonical frame (all 4 players) | ${input.bundledCanonicalPerTick.sampleCount} | ${input.bundledCanonicalPerTick.min} | ${fixed(input.bundledCanonicalPerTick.mean, 1)} | ${input.bundledCanonicalPerTick.max} | ${fixed(input.bundledCanonicalBytesPerTick, 1)} | ${fixed(input.bundledCanonicalBytesPerSecond, 1)} |`);
  lines.push(`| Per-client canonical frame (1 player) | ${input.perClientCanonical.sampleCount} | ${input.perClientCanonical.min} | ${fixed(input.perClientCanonical.mean, 1)} | ${input.perClientCanonical.max} | ${fixed(input.perClientCanonicalBytesPerTick, 1)} | ${fixed(input.perClientCanonicalBytesPerSecond, 1)} |`);
  lines.push(`| Per-client session envelope | ${input.perClientEnvelope.sampleCount} | ${input.perClientEnvelope.min} | ${fixed(input.perClientEnvelope.mean, 1)} | ${input.perClientEnvelope.max} | ${fixed(input.perClientEnvelopeBytesPerTick, 1)} | ${fixed(input.perClientEnvelopeBytesPerSecond, 1)} |`);
  lines.push(`| Envelope overhead over canonical | ${input.perClientEnvelopeOverhead.sampleCount} | ${input.perClientEnvelopeOverhead.min} | ${fixed(input.perClientEnvelopeOverhead.mean, 1)} | ${input.perClientEnvelopeOverhead.max} | - | - |`);
  lines.push(`| Aggregated upstream (4 clients) | - | - | - | - | - | ${fixed(input.aggregateUpstreamBytesPerSecond, 1)} |`, '');
  lines.push('The session envelope omits the optional `roomId`; a room-scoped envelope is larger by that field. Envelope overhead is measured against the single-player canonical frame, not the bundled one.', '');
  lines.push('## Snapshot bytes', '');
  lines.push('| Snapshot Hz | samples | canonical mean B | server message mean B | wrapper overhead B | B per sim tick / client | B/s / client | B/s server (4 clients) |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const snapshot of manifest.codecBytes.snapshots) {
    lines.push(`| ${snapshot.snapshotHz} | ${snapshot.sampleCount} | ${fixed(snapshot.canonical.mean, 1)} | ${fixed(snapshot.serverMessage.mean, 1)} | ${fixed(snapshot.serverMessageOverhead.mean, 1)} | ${fixed(snapshot.bytesPerSimulationTickPerClient, 2)} | ${fixed(snapshot.bytesPerSecondPerClient, 1)} | ${fixed(snapshot.bytesPerSecondServerAggregate, 1)} |`);
  }
  lines.push('', '## Simulation tick duration (microseconds)', '');
  lines.push('| samples | min | p50 | p95 | p99 | max | mean | ticks/s (wall) |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(`| ${tick.sampleCount} | ${fixed(tick.min)} | ${fixed(tick.p50)} | ${fixed(tick.p95)} | ${fixed(tick.p99)} | ${fixed(tick.max)} | ${fixed(tick.mean)} | ${fixed(tick.ticksPerSecondWallClock, 0)} |`);
  lines.push('', '## Snapshot codec duration (microseconds)', '');
  lines.push('| Snapshot Hz | samples | encode p50 | encode p95 | encode p99 | decode p50 | decode p95 | decode p99 |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const timing of manifest.snapshotTiming) {
    lines.push(`| ${timing.snapshotHz} | ${timing.sampleCount} | ${fixed(timing.encode.p50)} | ${fixed(timing.encode.p95)} | ${fixed(timing.encode.p99)} | ${fixed(timing.decode.p50)} | ${fixed(timing.decode.p95)} | ${fixed(timing.decode.p99)} |`);
  }
  lines.push('', '## Process resources (measured tick loop)', '');
  lines.push(`- Wall clock: ${fixed(resources.wallClockMicroseconds / 1000, 1)} ms`);
  lines.push(`- CPU user: ${fixed(resources.cpuUserMicroseconds / 1000, 1)} ms; system: ${fixed(resources.cpuSystemMicroseconds / 1000, 1)} ms; total: ${fixed(resources.cpuTotalMicroseconds / 1000, 1)} ms`);
  lines.push(`- Peak RSS (process lifetime, from \`resourceUsage().maxRSS\`): ${mib(resources.peakRssBytes)} MiB`);
  lines.push(`- RSS after the measured loop: ${mib(resources.rssAfterRunBytes)} MiB`);
  lines.push('- Process CPU counts every Node thread (including V8 helper threads), so it can exceed the wall clock of the measured single-threaded loop.', '');
  lines.push('## Event loop probe', '');
  if (manifest.eventLoopLag.status === 'MEASURED') {
    lines.push(`Paced harness probe: ${manifest.eventLoopLag.probeTicks} ticks at ${fixed(manifest.eventLoopLag.probeIntervalMicroseconds / 1000, 2)} ms, histogram resolution ${manifest.eventLoopLag.histogramResolutionMilliseconds} ms, ${manifest.eventLoopLag.sampleCount} samples.`);
    lines.push('');
    lines.push('| p50 ns | p95 ns | p99 ns | max ns |');
    lines.push('| ---: | ---: | ---: | ---: |');
    lines.push(`| ${fixed(manifest.eventLoopLag.p50, 0)} | ${fixed(manifest.eventLoopLag.p95, 0)} | ${fixed(manifest.eventLoopLag.p99, 0)} | ${fixed(manifest.eventLoopLag.max, 0)} |`);
    lines.push('');
    lines.push('This is the delay histogram of a timer-paced harness loop. It includes the platform timer floor (legacy Windows timers quantise to about 15.6 ms), so compare values above that floor, not the floor itself.');
  } else {
    lines.push(`${LOCAL_NOT_MEASURED}: ${manifest.eventLoopLag.reason}`);
  }
  lines.push('', '## Network fields', '');
  lines.push('All network fields are `NOT_MEASURED`: latency, jitter, packet loss, join success, TURN cost and bandwidth. `measuredNetworks` is `0`. No LAN, internet, browser or TURN run occurred.', '');
  lines.push('## What these numbers do not mean', '');
  lines.push('- They are not network latency, jitter, loss, join reliability or TURN cost.');
  lines.push('- They are not browser frame pacing, rendering cost or device performance.');
  lines.push('- Codec bytes are canonical JSON UTF-8 bytes; transport framing (WebSocket or WebRTC) is not included.');
  lines.push('- Durations vary by machine, load and Node version. Only the byte counts are deterministic.');
  lines.push('- A single local run cannot choose between WebSocket and WebRTC.');
  lines.push('', '## Reproduce', '');
  lines.push('```sh');
  lines.push('npm ci');
  lines.push('npm run measure:local');
  lines.push('```', '');
  lines.push('The default writes a new `benchmarks/results/local-<UTC timestamp>.json` and `.md`. Raw samples are not embedded; this command is the regeneration path.', '');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const ticks = integerArgument(argument('ticks'), DEFAULT_MEASURED_TICKS, DEFAULT_MEASURED_TICKS, 'tick count');
  if (ticks < 1) throw new Error('Invalid tick count');
  const warmupTicks = integerArgument(argument('warmup-ticks'), DEFAULT_WARMUP_TICKS, DEFAULT_MEASURED_TICKS, 'warm-up ticks');
  const eventLoopTicks = eventLoopArguments();
  const runId = `local-${runStamp()}`;

  const sections = await runLocalMeasurement({ ticks, warmupTicks, eventLoopTicks });
  const manifest = createLocalManifest({
    runId,
    provenance: buildProvenance(sections, ticks, warmupTicks),
    sections,
  });
  const summary = renderSummary(manifest);

  const output = resolve(process.cwd(), argument('out') ?? `benchmarks/results/${runId}.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const summaryPath = output.replace(/\.json$/i, '.md');
  writeFileSync(summaryPath, `${summary}\n`, 'utf8');

  process.stdout.write(`${summary}\n`);
  const shown = relative(process.cwd(), output);
  process.stdout.write(`\nResult: ${shown.startsWith('..') ? basename(output) : shown}\n`);
  process.stdout.write(`Summary: ${basename(summaryPath)}\n`);
}

main().catch(error => {
  process.stderr.write(`local measurement failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
