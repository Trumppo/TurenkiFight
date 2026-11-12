import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  M14_PLAYERS,
  loadEightPlayerSchedule,
  runManualSession,
  validateM14Manifest,
} from '../benchmarks/m14/eightPlayerMeasurement';

/**
 * The M14 measurement harness is harness-only code, but its own invariants
 * matter: a wrong snapshot count or a fabricated byte summary must fail loudly
 * instead of producing a plausible-looking result. This test drives a short
 * real eight-player loopback session through the same production server and
 * client code paths the full measurement uses. It does not write a result file.
 */
describe('M14 eight-player single-machine measurement harness', () => {
  it('drives a real eight-player session and reports measured snapshot bytes', async () => {
    const ticks = 120;
    const { schedule } = loadEightPlayerSchedule(ticks);
    const session = await runManualSession({ snapshotHz: 20, ticks, schedule });
    const expectedSnapshots = Math.floor((ticks * 20) / 60);

    expect(session.players).toBe(M14_PLAYERS);
    expect(session.pacing).toBe('manual');
    expect(session.finalTick).toBe(ticks);
    expect(session.runComplete).toBe(true);
    expect(session.allClientsReceivedExpectedSnapshots).toBe(true);
    expect(session.expectedSnapshots).toBe(expectedSnapshots);
    expect(session.receivedSnapshots).toBe(expectedSnapshots);
    expect(session.lateTicks).toBe(0);
    expect(session.deniedMessages).toBe(0);

    const bytes = session.snapshotBytes;
    expect(bytes.sampleCount).toBe(expectedSnapshots);
    expect(bytes.canonical.sampleCount).toBe(expectedSnapshots);
    expect(bytes.serverMessage.sampleCount).toBe(expectedSnapshots);
    expect(bytes.serverMessage.mean).toBeGreaterThan(bytes.canonical.mean);
    expect(bytes.serverMessageOverhead.mean).toBeGreaterThan(0);
    expect(bytes.serverMessageOverhead.mean).toBeCloseTo(
      bytes.serverMessage.mean - bytes.canonical.mean,
      5,
    );
    expect(bytes.canonicalBytesPerSimulationTickPerClient).toBeCloseTo(
      bytes.canonical.mean * 20 / 60,
      9,
    );

    expect(session.tickDuration.sampleCount).toBe(ticks);
    expect(session.tickDuration.p50).toBeLessThanOrEqual(session.tickDuration.p95);
    expect(session.tickDuration.p95).toBeLessThanOrEqual(session.tickDuration.p99);
    expect(session.codecTiming.encode.sampleCount).toBe(expectedSnapshots);
    expect(session.codecTiming.decode.sampleCount).toBe(expectedSnapshots);
    expect(session.finalStateSha256).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it('refuses an out-of-range tick count instead of truncating the fixture', () => {
    expect(() => loadEightPlayerSchedule(0)).toThrow();
    expect(() => loadEightPlayerSchedule(7201)).toThrow();
  });

  it('fails closed on a manifest that has no measured sections', () => {
    expect(() => validateM14Manifest({})).toThrow();
    expect(() => validateM14Manifest({ schemaVersion: 1, kind: 'm14-eight-player-single-machine-measurement' }))
      .toThrow();
  });

  it('keeps all network fields explicitly NOT_MEASURED in the committed 8-player report', () => {
    const report = JSON.parse(readFileSync(
      new URL('../benchmarks/results/m14-8p-20261107T011738309Z.json', import.meta.url), 'utf8',
    )) as { scope: { networkAccess: string }; network: Record<string, unknown> };
    expect(report.scope.networkAccess).toBe('loopback-only');
    expect(report.network).toEqual({
      latency: 'NOT_MEASURED',
      jitter: 'NOT_MEASURED',
      packetLoss: 'NOT_MEASURED',
      joinSuccess: 'NOT_MEASURED',
      turnCost: 'NOT_MEASURED',
      bandwidth: 'NOT_MEASURED',
      measuredNetworks: 0,
    });
  });
});
