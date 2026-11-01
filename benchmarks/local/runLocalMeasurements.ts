/**
 * `npm run measure:local`
 *
 * Produces one machine-readable local measurement and a short Markdown summary
 * under `benchmarks/results/`. The command runs on one machine and opens no
 * network path. Provenance (command, environment, git SHA, fixture hash, seed,
 * sample counts and warm-up policy) is embedded in the JSON.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform as osPlatform, arch as osArch, release as osRelease } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import { createLocalManifest, type LocalProvenance } from './manifest';
import {
  DEFAULT_EVENT_LOOP_TICKS,
  DEFAULT_MEASURED_TICKS,
  DEFAULT_WARMUP_TICKS,
  runLocalMeasurement,
} from './measure';
import { readWorkingTree } from './provenance';
import { renderSummary, writeSummaryFile } from './summary';

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
  const tree = readWorkingTree();
  return {
    command: 'npm run measure:local',
    cliArguments: recordedArguments(),
    nodeVersion: process.version,
    platform: osPlatform(),
    osRelease: osRelease(),
    architecture: osArch(),
    cpuModel: model,
    logicalCores: cpu.length,
    gitCommitSha: tree.gitCommitSha,
    workingTreeDirty: tree.workingTreeDirty,
    dirtyExclusions: tree.dirtyExclusions,
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
  writeSummaryFile(summaryPath, manifest);

  process.stdout.write(`${summary}\n`);
  const shown = relative(process.cwd(), output);
  process.stdout.write(`\nResult: ${shown.startsWith('..') ? basename(output) : shown}\n`);
  process.stdout.write(`Summary: ${basename(summaryPath)}\n`);
}

main().catch(error => {
  process.stderr.write(`local measurement failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
