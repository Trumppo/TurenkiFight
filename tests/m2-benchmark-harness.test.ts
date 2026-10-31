import { describe, expect, it } from 'vitest';
import { encodeInputFrame } from '../src/game/protocol/inputFrame';
import { BASELINE_SCENARIO, FIXTURE_SEED, generateBaselineFixture, InMemoryBenchmarkAdapter, replayBaseline } from '../benchmarks/inMemory';
import { createUnmeasuredManifest, validateManifest } from '../benchmarks/manifest';

describe('M2 in-memory benchmark harness', () => {
  it('replays the same 7200-tick four-player fixture to identical state and event SHA-256 fingerprints', () => {
    const a = generateBaselineFixture(FIXTURE_SEED);
    const b = generateBaselineFixture(FIXTURE_SEED);
    expect(a.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.fixtureSha256).toBe(b.fixtureSha256);
    expect(a.frames).toEqual(b.frames);
    expect(a.frames).toHaveLength(7200);
    const first = replayBaseline(a);
    const second = replayBaseline(b);
    expect(first).toEqual(second);
    expect(first.finalTick).toBe(7200);
    expect(first.finalStateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.orderedEventsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.result).toBe('NOT_MEASURED');
    expect(generateBaselineFixture(FIXTURE_SEED + 1).fixtureSha256).not.toBe(a.fixtureSha256);
  });

  it('rejects malformed, out-of-order and unauthorized inputs and resets on close', () => {
    const adapter = new InMemoryBenchmarkAdapter();
    const fixture = generateBaselineFixture();
    expect(() => adapter.sendInput(fixture.frames[0])).toThrow(/joined/);
    adapter.connect({ scenarioId: BASELINE_SCENARIO });
    adapter.join(['P1','P2','P3','P4']);
    expect(() => adapter.sendInput('{')).toThrow();
    expect(() => adapter.sendInput(fixture.frames[1])).toThrow(/Non-contiguous/);
    adapter.sendInput(fixture.frames[0]);
    expect(() => adapter.sendInput(fixture.frames[0])).toThrow(/Non-contiguous/);
    adapter.disconnect('P4');
    expect(() => adapter.sendInput(fixture.frames[1])).toThrow(/Unauthorized/);
    expect(() => adapter.disconnect('P4')).toThrow(/Unknown/);
    adapter.close();
    expect(() => adapter.observeSnapshot()).toThrow(/not connected/);
    adapter.connect({ scenarioId: BASELINE_SCENARIO });
    adapter.join(['P1','P2','P3','P4']);
    expect(adapter.observeSnapshot().state.tick).toBe(0);
    adapter.close();
  });

  it('enforces canonical codec size, duplicate IDs and strict fixture integrity', () => {
    const adapter = new InMemoryBenchmarkAdapter();
    adapter.connect({ scenarioId: BASELINE_SCENARIO });
    adapter.join(['P1','P2','P3','P4']);
    expect(() => adapter.sendInput(encodeInputFrame({
      version: 1, tick: 0,
      inputs: [{ playerId: 'P1', moveX: 0, moveY: 0, jump: false }],
    }))).not.toThrow();
    expect(() => adapter.sendInput(JSON.stringify({ version: 1, tick: 1, inputs: [
      { playerId: 'P1', moveX: 0, moveY: 0, jump: false },
      { playerId: 'P1', moveX: 0, moveY: 0, jump: false },
    ] }))).toThrow();
    expect(() => adapter.sendInput('x'.repeat(4097))).toThrow();
    adapter.close();
    const fixture = generateBaselineFixture();
    expect(() => replayBaseline({ ...fixture, frames: fixture.frames.slice(1) })).toThrow(/Invalid fixture/);
    expect(() => generateBaselineFixture(0)).toThrow(/seed/);
  });

  it('validates machine-readable manifests and never substitutes zero for missing metrics', () => {
    const fixture = generateBaselineFixture();
    const replay = replayBaseline(fixture);
    const manifest = createUnmeasuredManifest(fixture, replay, 'a'.repeat(40), 'BASE-4-60-20-memory-001');
    expect(() => validateManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
    expect(manifest.result).toBe('NOT_MEASURED');
    expect(manifest.environment.cpu).toBe('NOT_MEASURED');
    expect(() => validateManifest({ ...manifest, result: 0 })).toThrow();
    expect(() => validateManifest({ ...manifest, commitSha: 'unknown' })).toThrow();
    expect(() => validateManifest({ ...manifest, fixtureSha256: '0'.repeat(64) })).toThrow();
    expect(() => validateManifest({ ...manifest, extra: true })).toThrow();
    expect(() => validateManifest({ ...manifest, replay: { ...replay, finalTick: 7199 } })).toThrow();
  });
});
