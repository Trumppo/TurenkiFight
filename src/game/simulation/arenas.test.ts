import { describe, expect, it } from 'vitest';
import {
  ARENA_RULE_IDS, ARENA_RULES, arenaRules, hazardActiveStart, hazardPhaseAt, hazardWarningStart,
  isHazardDamageTick, isInsideHazardBand, validateArenaRules, type ArenaHazard,
} from './arenas';
import { ARENA_BOUNDS } from './step';

const KKAUPPA = ARENA_RULES.kkauppa.hazard as ArenaHazard;
const fromHazard = (patch: Partial<ArenaHazard>) => ({ ...ARENA_RULES.kkauppa, hazard: { ...KKAUPPA, ...patch } });

describe('M15 arena rule table', () => {
  it('resolves the station for an absent id and opens only known ids', () => {
    expect(arenaRules()).toBe(ARENA_RULES.station);
    expect(arenaRules(undefined)).toBe(ARENA_RULES.station);
    expect(arenaRules('mesku')).toEqual({ id: 'mesku', hazard: null });
    expect(arenaRules('kkauppa')).toBe(ARENA_RULES.kkauppa);
    expect(ARENA_RULE_IDS).toEqual(['station', 'mesku', 'kkauppa']);
    // Runtime junk must not silently fall back to the station.
    expect(() => arenaRules('missing' as never)).toThrow(/Unknown arena id: missing/);
  });

  it('defines the K-kauppa shelf hazard, and only there', () => {
    expect(KKAUPPA.periodTicks).toBe(2700);
    expect(KKAUPPA.warningTicks).toBe(180);
    expect(KKAUPPA.activeTicks).toBe(120);
    expect(KKAUPPA.damagePerTick).toBe(1);
    expect(KKAUPPA.damageEveryTicks).toBe(6);
    expect(hazardWarningStart(KKAUPPA)).toBe(2400);
    expect(hazardActiveStart(KKAUPPA)).toBe(2580);
    expect(ARENA_RULES.station.hazard).toBeNull();
    expect(ARENA_RULES.mesku.hazard).toBeNull();
  });

  it('keeps the danger band inside the playable depth range', () => {
    expect(KKAUPPA.band.minY).toBeLessThan(KKAUPPA.band.maxY);
    expect(KKAUPPA.band.minY).toBeGreaterThanOrEqual(ARENA_BOUNDS.minY);
    expect(KKAUPPA.band.maxY).toBeLessThanOrEqual(ARENA_BOUNDS.maxY);
  });

  it('cycles idle -> warning -> active -> idle on exact boundaries', () => {
    expect(hazardPhaseAt(0, KKAUPPA)).toBe('idle');
    expect(hazardPhaseAt(2399, KKAUPPA)).toBe('idle');
    expect(hazardPhaseAt(2400, KKAUPPA)).toBe('warning');
    expect(hazardPhaseAt(2579, KKAUPPA)).toBe('warning');
    expect(hazardPhaseAt(2580, KKAUPPA)).toBe('active');
    expect(hazardPhaseAt(2699, KKAUPPA)).toBe('active');
    expect(hazardPhaseAt(2700, KKAUPPA)).toBe('idle');
    expect(hazardPhaseAt(5099, KKAUPPA)).toBe('idle');
    expect(hazardPhaseAt(5100, KKAUPPA)).toBe('warning');
    expect(hazardPhaseAt(5280, KKAUPPA)).toBe('active');
    expect(hazardPhaseAt(5399, KKAUPPA)).toBe('active');
    expect(hazardPhaseAt(-1, KKAUPPA)).toBe('idle');
    expect(hazardPhaseAt(Number.NaN, KKAUPPA)).toBe('idle');
    expect(hazardPhaseAt(2580, null)).toBe('idle');
  });

  it('damages on a fixed 6-tick cadence inside the active window only', () => {
    const damageTicks: number[] = [];
    for (let tick = 2570; tick <= 2710; tick++) {
      if (isHazardDamageTick(tick, KKAUPPA)) damageTicks.push(tick);
    }
    expect(damageTicks.length).toBe(20);
    expect(damageTicks[0]).toBe(2580);
    expect(damageTicks[damageTicks.length - 1]).toBe(2694);
    for (let index = 1; index < damageTicks.length; index++) {
      expect(damageTicks[index] - damageTicks[index - 1]).toBe(6);
    }
    // The warning never damages, and the next cycle keeps the same anchoring.
    expect(isHazardDamageTick(2400, KKAUPPA)).toBe(false);
    expect(isHazardDamageTick(2579, KKAUPPA)).toBe(false);
    expect(isHazardDamageTick(2695, KKAUPPA)).toBe(false);
    expect(isHazardDamageTick(2700, KKAUPPA)).toBe(false);
    expect(isHazardDamageTick(5280, KKAUPPA)).toBe(true);
    expect(isHazardDamageTick(2580, null)).toBe(false);
  });

  it('treats both band edges as inside', () => {
    const { band } = KKAUPPA;
    expect(isInsideHazardBand(band.minY, band)).toBe(true);
    expect(isInsideHazardBand(band.maxY, band)).toBe(true);
    expect(isInsideHazardBand((band.minY + band.maxY) / 2, band)).toBe(true);
    expect(isInsideHazardBand(band.minY - 0.001, band)).toBe(false);
    expect(isInsideHazardBand(band.maxY + 0.001, band)).toBe(false);
    expect(isInsideHazardBand(Number.NaN, band)).toBe(false);
  });

  it('rejects a mistuned rule instead of shipping an unescapable hazard', () => {
    expect(() => validateArenaRules({ id: 'missing' as never, hazard: null }))
      .toThrow(/Unknown arena rule id/);
    expect(() => validateArenaRules(fromHazard({ periodTicks: 0 }))).toThrow(/periodTicks/);
    expect(() => validateArenaRules(fromHazard({ periodTicks: 2.5 }))).toThrow(/periodTicks/);
    expect(() => validateArenaRules(fromHazard({ warningTicks: -1 }))).toThrow(/warningTicks/);
    expect(() => validateArenaRules(fromHazard({ activeTicks: 0 }))).toThrow(/activeTicks/);
    expect(() => validateArenaRules(fromHazard({ damagePerTick: 0 }))).toThrow(/damagePerTick/);
    expect(() => validateArenaRules(fromHazard({ damageEveryTicks: 0 }))).toThrow(/damageEveryTicks/);
    // Warning plus active must fit in the cycle.
    expect(() => validateArenaRules(fromHazard({ warningTicks: 2600 }))).toThrow(/fit inside the cycle/);
    expect(() => validateArenaRules(fromHazard({ band: { minY: 160, maxY: 150 } }))).toThrow(/band/);
    expect(() => validateArenaRules(fromHazard({ band: { minY: 150, maxY: Number.POSITIVE_INFINITY } })))
      .toThrow(/band/);
    expect(() => validateArenaRules(ARENA_RULES.kkauppa)).not.toThrow();
  });
});
