/**
 * Human-readable Markdown summary for a single-machine local measurement.
 *
 * The file content must end with exactly one newline: a blank line at EOF is a
 * whitespace error in `git diff --check` and makes committed evidence noisy.
 * `writeSummaryFile` is the only writer used by the CLI so the regression test
 * covers the actual file bytes, not just the rendered string.
 */
import { writeFileSync } from 'node:fs';
import {
  LOCAL_EVENT_LOOP_INTERPRETATION,
  LOCAL_MANIFEST_VERSION,
  LOCAL_NOT_MEASURED,
  type LocalMeasurementManifest,
} from './manifest';

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const mib = (bytes: number): string => fixed(bytes / (1024 * 1024), 1);

export function renderSummary(manifest: LocalMeasurementManifest): string {
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
  lines.push(`| Dirty exclusions | \`${manifest.provenance.dirtyExclusions.join('`, `')}\` (generated outputs only) |`);
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
    lines.push(LOCAL_EVENT_LOOP_INTERPRETATION);
    lines.push('Compare values above that floor, not the floor itself.');
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

/** Markdown file content with exactly one trailing newline and no blank EOF line. */
export function summaryFileText(manifest: LocalMeasurementManifest): string {
  return `${renderSummary(manifest).replace(/\n+$/, '')}\n`;
}

export function writeSummaryFile(path: string, manifest: LocalMeasurementManifest): void {
  writeFileSync(path, summaryFileText(manifest), 'utf8');
}
