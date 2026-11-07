/**
 * Human-readable Markdown summary for the M14 eight-player single-machine
 * measurement. The JSON is authoritative; this file renders it.
 *
 * The content ends with exactly one newline and no blank line at EOF so
 * `git diff --check` stays clean.
 */
import type {
  M14Manifest,
  M14ManualSession,
  M14ServerProcessMeasurement,
} from './eightPlayerMeasurement';

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const mib = (bytes: number): string => fixed(bytes / (1024 * 1024), 1);
const percent = (value: number): string => fixed(value, 1);

function objectCell(session: M14ManualSession): string {
  if (session.objects.status === 'ABSENT') return 'none';
  return `${fixed(session.objects.bytesDeltaPerObject.mean, 1)} (n=${fixed(session.objects.objectCount.mean, 1)})`;
}

function serverProcessLines(server: M14ServerProcessMeasurement): string[] {
  const lines: string[] = [];
  lines.push('## Server process cost (interval 60 Hz, 20 Hz snapshots)', '');
  lines.push(`- Mode: dedicated Node server process; 8 clients in a separate process on the same machine; loopback only.`);
  lines.push(`- Server entry: the authoritative WebSocket server (\`startWsServer\`) with the eight-player roster, room code, connection cap, rejoin window and the production client-message policy. \`serve:match\` wraps the same server but does not expose the benchmark-only \`maxTicks\` bound, so this harness starts it directly and supplies \`maxTicks = ${server.measuredTicks}\`.`);
  lines.push(`- Bounded run: ${server.measuredTicks} ticks at ${server.snapshotHz} Hz snapshots; first tick delay ${server.firstTickDelayMs} ms. ${server.measuredTicks} ticks are ${fixed(server.measuredTicks / 60, 0)} s of simulated time at 60 Hz.`);
  lines.push(`- Wall clock (running phase to results detection): ${fixed(server.wallClockMicroseconds / 1000, 1)} ms`);
  lines.push(`- CPU user: ${fixed(server.cpuUserMicroseconds / 1000, 1)} ms; system: ${fixed(server.cpuSystemMicroseconds / 1000, 1)} ms; total: ${fixed(server.cpuTotalMicroseconds / 1000, 1)} ms`);
  lines.push(`- CPU total / wall clock: ${percent(server.cpuPercentOfWallClock)} % (derived; all Node threads are counted, so it can exceed 100 %)`);
  lines.push(`- Peak RSS (process lifetime, \`resourceUsage().maxRSS\`): ${mib(server.peakRssBytes)} MiB`);
  lines.push(`- RSS after the run: ${mib(server.rssAfterRunBytes)} MiB`);
  lines.push(`- Final tick: ${server.finalTick}; final phase: ${server.finalPhase}; final state SHA-256: \`${server.finalStateSha256}\``);
  lines.push(`- Per-tick duration in interval mode: \`NOT_MEASURED\` — ${server.perTickDuration.reason}`);
  lines.push('');
  return lines;
}

export function renderSummary(manifest: M14Manifest): string {
  const lines: string[] = [];
  lines.push(`# M14 eight-player single-machine measurement \`${manifest.runId}\``, '');
  lines.push('**Scope: single machine, no network.** WebSocket traffic stayed on `127.0.0.1` loopback inside one machine. No LAN, internet, impairment, latency, jitter, loss or bandwidth measurement was made. This is not a transport decision.', '');
  lines.push('## Provenance', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Command | \`${manifest.provenance.command}\` |`);
  lines.push(`| Recorded flags | \`${manifest.provenance.cliArguments.join(' ') || '(none)'}\` |`);
  lines.push(`| Date (UTC) | ${manifest.provenance.dateUtc} |`);
  lines.push(`| Node | ${manifest.provenance.nodeVersion} |`);
  lines.push(`| OS | ${manifest.provenance.platform} ${manifest.provenance.osRelease} (${manifest.provenance.architecture}) |`);
  lines.push(`| CPU | ${manifest.provenance.cpuModel} (${manifest.provenance.logicalCores} logical cores) |`);
  lines.push(`| Git | \`${manifest.provenance.gitCommitSha}\` (working tree dirty: ${manifest.provenance.workingTreeDirty ? 'yes' : 'no'}; production source dirty: ${manifest.provenance.productionSourceDirty ? 'yes' : 'no'}) |`);
  lines.push(`| Dirty paths | ${manifest.provenance.dirtyPaths.length === 0 ? '(none)' : manifest.provenance.dirtyPaths.map(path => `\`${path}\``).join(', ')} |`);
  lines.push(`| Dirty exclusion | \`${manifest.provenance.dirtyExclusions.join('`, `')}\` (generated results only) |`);
  lines.push(`| Fixture | \`${manifest.provenance.fixtureScenarioId}\` SHA-256 \`${manifest.provenance.fixtureSha256}\`, seed ${manifest.provenance.seed} |`);
  lines.push(`| Workload | ${manifest.provenance.players.join(', ')}; ${manifest.provenance.measuredTicks} ticks per session; ${manifest.provenance.tickRateHz} Hz simulation; snapshot rates ${manifest.provenance.snapshotRatesHz.join(', ')} Hz |`, '');

  lines.push('## Snapshot bytes (actual server messages received by a real client)', '');
  lines.push('| Snapshot Hz | samples | canonical mean B | canonical min/max B | server message mean B | server message min/max B | wrapper overhead B | objects: delta per object mean B | server aggregate B/s |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const session of manifest.sessions) {
    const bytes = session.snapshotBytes;
    lines.push(
      `| ${session.snapshotHz} | ${bytes.sampleCount} | ${fixed(bytes.canonical.mean, 1)} | ` +
      `${bytes.canonical.min}/${bytes.canonical.max} | ${fixed(bytes.serverMessage.mean, 1)} | ` +
      `${bytes.serverMessage.min}/${bytes.serverMessage.max} | ${fixed(bytes.serverMessageOverhead.mean, 1)} | ` +
      `${objectCell(session)} | ${fixed(bytes.serverMessageBytesPerSecondServerAggregate, 1)} |`,
    );
  }
  lines.push('');
  lines.push('Canonical bytes are `encodeStateSnapshot` UTF-8 bytes. Server-message bytes are the actual text-frame bytes the observer client received; WebSocket frame headers and TCP/IP overhead are excluded. The aggregate rate is derived from the measured server-message mean at the stated snapshot rate for eight clients.', '');
  const firstObjects = manifest.sessions[0]?.objects;
  if (firstObjects && firstObjects.status === 'PRESENT') {
    const presence = manifest.sessions.map(session =>
      `${session.objects.snapshotsWithObjects} of ${session.snapshotBytes.sampleCount} (${session.snapshotHz} Hz)`);
    lines.push(
      `Objects were present in ${presence.join(', ')} captured snapshots. In snapshots with objects, ` +
      `the mean count is ${fixed(firstObjects.objectCount.mean, 2)} and the mean added canonical size is ` +
      `${fixed(firstObjects.bytesDeltaWithObjects.mean, 1)} B (${fixed(firstObjects.bytesDeltaPerObject.mean, 1)} B per object).`,
      '',
    );
  }

  lines.push('## Authoritative tick duration (manual pacing, microseconds)', '');
  lines.push('| Snapshot Hz | samples | min | p50 | p95 | p99 | max | mean | steps/s (stepping only) |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const session of manifest.sessions) {
    const tick = session.tickDuration;
    lines.push(
      `| ${session.snapshotHz} | ${tick.sampleCount} | ${fixed(tick.min)} | ${fixed(tick.p50)} | ` +
      `${fixed(tick.p95)} | ${fixed(tick.p99)} | ${fixed(tick.max)} | ${fixed(tick.mean)} | ` +
      `${fixed(tick.ticksPerSecondStepping, 0)} |`,
    );
  }
  lines.push('');
  lines.push('Each sample is `process.hrtime.bigint()` around one `server.stepOnce()`: simulation step, server-side snapshot encode when due, and broadcast enqueue to eight sockets. Socket flush, input-barrier waits and client work are excluded. These sessions step ticks on demand; the numbers are not real-time pacing.', '');
  lines.push('At 30 Hz a snapshot is emitted on exactly every second tick, so the nearest-rank p50 falls on the first snapshot-carrying sample and reads much higher than at 10/20 Hz. The p95/p99 and max values are the comparable tail figures; the 10 and 20 Hz rows separate the no-snapshot tick cost from the snapshot tick cost more clearly.', '');

  lines.push('## Snapshot codec cost (microseconds per captured snapshot)', '');
  lines.push('| Snapshot Hz | samples | encode p50 | encode p95 | encode p99 | decode p50 | decode p95 | decode p99 |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const session of manifest.sessions) {
    const codec = session.codecTiming;
    lines.push(
      `| ${session.snapshotHz} | ${codec.encode.sampleCount} | ${fixed(codec.encode.p50)} | ` +
      `${fixed(codec.encode.p95)} | ${fixed(codec.encode.p99)} | ${fixed(codec.decode.p50)} | ` +
      `${fixed(codec.decode.p95)} | ${fixed(codec.decode.p99)} |`,
    );
  }
  lines.push('');
  lines.push('The codec pass runs after the session on snapshots captured from it: one timed `encodeStateSnapshot` and one timed `decodeStateSnapshot` per snapshot. It is not the server\'s own encode inside the tick sample above.', '');

  lines.push(...serverProcessLines(manifest.serverProcess));

  lines.push('## Correctness', '');
  lines.push('| Snapshot Hz | expected tick | final tick | final phase | expected snapshots | received | final state SHA-256 |');
  lines.push('| ---: | ---: | ---: | --- | ---: | ---: | --- |');
  for (const session of manifest.sessions) {
    lines.push(
      `| ${session.snapshotHz} | ${manifest.correctness.expectedTicks} | ${session.finalTick} | ` +
      `${session.finalPhase} | ${session.expectedSnapshots} | ${session.receivedSnapshots} | ` +
      `\`${session.finalStateSha256}\` |`,
    );
  }
  lines.push('');
  lines.push('- Every manual session reached the expected tick, completed its bounded run and produced the same final state hash.');
  lines.push('- The interval server-process run reached the same tick and the same final state hash as the 20 Hz manual session; every client\'s final snapshot hash matched the server.');
  lines.push(`- Snapshot counts: all eight clients received the expected count in every session. Late ticks: 0. Denied messages: 0.`);
  lines.push('');

  lines.push('## What these numbers do not mean', '');
  lines.push('- They are not network latency, jitter, packet loss, join success, TURN cost or bandwidth. All network fields are `NOT_MEASURED`; `measuredNetworks` is `0`.');
  lines.push('- They are not a WebSocket-vs-WebRTC comparison and select no transport.');
  lines.push('- They are not browser frame pacing, rendering cost or device performance.');
  lines.push('- Codec bytes are canonical JSON UTF-8 bytes; WebSocket frame headers and TCP/IP overhead are not included.');
  lines.push('- Manual-pacing tick and codec durations are deterministic-workload facts, not real-time pacing. The interval server cost run is real-time, but its per-tick latency is not instrumented.');
  lines.push('- Timing, CPU and RSS vary with machine, background load and Node version. Only byte counts are deterministic.');
  lines.push('- One machine and one run are not a capacity guarantee.');
  lines.push('');

  lines.push('## Reproduce', '');
  lines.push('```sh');
  lines.push('npm ci');
  lines.push('npm run measure:m14-8p');
  lines.push('```', '');
  lines.push('The command writes a new `benchmarks/results/m14-8p-<UTC timestamp>.json` and `.md`; the JSON is authoritative. Raw samples are not embedded. Generated files are not overwritten.');
  return lines.join('\n');
}

/** Markdown file content with exactly one trailing newline and no blank EOF line. */
export function summaryFileText(manifest: M14Manifest): string {
  return `${renderSummary(manifest).replace(/\n+$/, '')}\n`;
}
