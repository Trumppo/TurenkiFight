import { describe, expect, it } from 'vitest';
import {
  ARENA_CENTRE_X, ARENA_MAX_X, ARENA_MIN_X, ZONE_DAMAGE_HP, ZONE_DAMAGE_INTERVAL_TICKS, ZONE_STAGES,
  isInsideZone, isZoneDamageTick, nextZoneShrinkTick, validateZoneStages, zoneRangeAt, zoneRangeForStage, zoneStageAt,
} from './zone';

const fullWidth = ARENA_MAX_X - ARENA_MIN_X;

describe('M10 Deathmatch zone schedule', () => {
  it('starts at the full arena and shrinks in five documented steps', () => {
    expect(ZONE_STAGES.map(stage => stage.startTick)).toEqual([0, 1080, 1980, 2880, 3780, 4680]);
    expect(ZONE_STAGES.map(stage => stage.widthFraction))
      .toEqual([1, 0.88, 0.76, 0.64, 0.52, 0.42]);
    expect(zoneRangeForStage(0)).toEqual({ minX: ARENA_MIN_X, maxX: ARENA_MAX_X });
  });

  it('moves to the next stage exactly on every boundary tick', () => {
    for (let stage = 1; stage < ZONE_STAGES.length; stage++) {
      const boundary = ZONE_STAGES[stage].startTick;
      expect(zoneStageAt(boundary - 1)).toBe(stage - 1);
      expect(zoneStageAt(boundary)).toBe(stage);
    }
    expect(zoneStageAt(0)).toBe(0);
    expect(zoneStageAt(1079)).toBe(0);
    expect(zoneStageAt(4679)).toBe(4);
    expect(zoneStageAt(4680)).toBe(5);
    expect(zoneStageAt(4681)).toBe(5);
    expect(zoneStageAt(7200)).toBe(5);
    // The last stage is permanent: no stage 6 exists.
    expect(zoneStageAt(Number.MAX_SAFE_INTEGER)).toBe(5);
  });

  it('uses the documented width fraction and stays centred on the arena', () => {
    for (let stage = 0; stage < ZONE_STAGES.length; stage++) {
      const range = zoneRangeForStage(stage);
      expect(range.maxX - range.minX).toBeCloseTo(fullWidth * ZONE_STAGES[stage].widthFraction, 10);
      expect((range.minX + range.maxX) / 2).toBeCloseTo(ARENA_CENTRE_X, 10);
      expect(range.minX).toBeGreaterThanOrEqual(ARENA_MIN_X);
      expect(range.maxX).toBeLessThanOrEqual(ARENA_MAX_X);
    }
    // Stage widths are monotonic even though stage 0 is the full arena.
    for (let stage = 1; stage < ZONE_STAGES.length; stage++) {
      const previous = zoneRangeForStage(stage - 1);
      const current = zoneRangeForStage(stage);
      expect(current.minX).toBeGreaterThan(previous.minX);
      expect(current.maxX).toBeLessThan(previous.maxX);
    }
  });

  it('derives the range at a tick and treats both bounds as safe', () => {
    const stage1 = zoneRangeAt(1080);
    expect(stage1).toEqual(zoneRangeForStage(1));
    expect(isInsideZone(stage1.minX, 1080)).toBe(true);
    expect(isInsideZone(stage1.maxX, 1080)).toBe(true);
    expect(isInsideZone(stage1.minX - 0.001, 1080)).toBe(false);
    expect(isInsideZone(stage1.maxX + 0.001, 1080)).toBe(false);
    // Before the first shrink everything in the arena is safe.
    expect(isInsideZone(ARENA_MIN_X, 1079)).toBe(true);
    expect(isInsideZone(ARENA_MAX_X, 1079)).toBe(true);
  });

  it('reports the next shrink tick and null after the last stage', () => {
    expect(nextZoneShrinkTick(0)).toBe(1080);
    expect(nextZoneShrinkTick(1079)).toBe(1080);
    expect(nextZoneShrinkTick(1080)).toBe(1980);
    expect(nextZoneShrinkTick(1979)).toBe(1980);
    expect(nextZoneShrinkTick(1980)).toBe(2880);
    expect(nextZoneShrinkTick(2879)).toBe(2880);
    expect(nextZoneShrinkTick(3779)).toBe(3780);
    expect(nextZoneShrinkTick(4679)).toBe(4680);
    expect(nextZoneShrinkTick(4680)).toBeNull();
    expect(nextZoneShrinkTick(7200)).toBeNull();
  });

  it('damages on every sixth tick, independent of any fighter state', () => {
    expect(ZONE_DAMAGE_HP).toBe(1);
    expect(ZONE_DAMAGE_INTERVAL_TICKS).toBe(6);
    expect(isZoneDamageTick(0)).toBe(true);
    expect(isZoneDamageTick(1)).toBe(false);
    expect(isZoneDamageTick(5)).toBe(false);
    expect(isZoneDamageTick(6)).toBe(true);
    expect(isZoneDamageTick(1080)).toBe(true);
    expect(isZoneDamageTick(1081)).toBe(false);
    // Every window of six consecutive ticks contains exactly one damage tick.
    for (let start = 0; start < 60; start++) {
      let hits = 0;
      for (let tick = start; tick < start + 6; tick++) if (isZoneDamageTick(tick)) hits++;
      expect(hits).toBe(1);
    }
  });

  it('rejects a mistuned schedule instead of shipping non-monotonic zones', () => {
    expect(() => validateZoneStages([])).toThrow(/stage 0/);
    expect(() => validateZoneStages([{ startTick: 1, widthFraction: 1 }])).toThrow(/tick 0/);
    expect(() => validateZoneStages([
      { startTick: 0, widthFraction: 1 },
      { startTick: 1080, widthFraction: 1.1 },
    ])).toThrow(/width fraction/);
    expect(() => validateZoneStages([
      { startTick: 0, widthFraction: 1 },
      { startTick: 0, widthFraction: 0.9 },
    ])).toThrow(/increasing ticks/);
    expect(() => validateZoneStages([
      { startTick: 0, widthFraction: 0.5 },
      { startTick: 1080, widthFraction: 0.6 },
    ])).toThrow(/must not grow/);
  });
});
