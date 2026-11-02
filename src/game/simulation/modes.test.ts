import { describe, expect, it } from 'vitest';
import { MATCH_TICKS, MODE_RULES, compareTieBreak, modeMetric, modeWinner } from './step';
import type { Fighter, ModeRules } from './types';

const fighter = (id: string, overrides: Partial<Fighter> = {}): Fighter => ({
  id, x: 0, y: 0, z: 0, vz: 0, facing: 1, health: 100, score: 0, koCount: 0, hitsReceived: 0,
  attackCooldown: 0, attackFrames: 0, attackMove: null, hitTargets: [], hitstun: 0, koTimer: 0,
  protection: 0, previousButtons: [], ...overrides,
});

const lms: ModeRules = MODE_RULES['last-man-standing'];
const deathmatch: ModeRules = MODE_RULES.deathmatch;

describe('M7 mode rules', () => {
  it('declares stocks, frag limit, respawn policy and timer per mode', () => {
    expect(MODE_RULES['score-brawl']).toMatchObject({
      stocks: null, respawn: 'respawn', fragLimit: null, timerTicks: MATCH_TICKS, hitScoring: true,
    });
    expect(lms).toMatchObject({
      stocks: 1, respawn: 'eliminate', fragLimit: null, timerTicks: MATCH_TICKS, hitScoring: false,
    });
    expect(deathmatch).toMatchObject({
      stocks: null, respawn: 'respawn', fragLimit: 20, timerTicks: MATCH_TICKS, fragScoring: true,
    });
    expect(lms.tieBreak).toEqual(['health', 'kos', 'damage']);
    expect(deathmatch.tieBreak).toEqual(['frags', 'deaths', 'damage']);
  });

  it('reads mode-specific optional metrics without inventing values', () => {
    const plain = fighter('P1');
    expect(modeMetric(plain, 'frags')).toBe(0);
    expect(modeMetric(plain, 'deaths')).toBe(0);
    expect(modeMetric(plain, 'damage')).toBe(0);
    expect(modeMetric({ ...plain, frags: 3 }, 'frags')).toBe(3);
  });

  it('Last Man Standing ties break on HP, then KOs dealt, then damage dealt', () => {
    const hp = modeWinner([
      fighter('P2', { health: 40, koCount: 5, damageDealt: 99 }),
      fighter('P1', { health: 70 }),
    ], lms);
    expect(hp).toBe('P1');

    const kos = modeWinner([
      fighter('P2', { health: 60, koCount: 2, damageDealt: 99 }),
      fighter('P1', { health: 60, koCount: 1 }),
    ], lms);
    expect(kos).toBe('P2');

    const damage = modeWinner([
      fighter('P2', { health: 60, koCount: 1, damageDealt: 30 }),
      fighter('P1', { health: 60, koCount: 1, damageDealt: 50 }),
    ], lms);
    expect(damage).toBe('P1');

    expect(modeWinner([
      fighter('P2', { health: 60, koCount: 1, damageDealt: 50 }),
      fighter('P1', { health: 60, koCount: 1, damageDealt: 50 }),
    ], lms)).toBeNull();
  });

  it('Deathmatch ties break on frags, then fewest deaths, then damage dealt', () => {
    expect(modeWinner([
      fighter('P2', { frags: 4, deaths: 0, damageDealt: 100 }),
      fighter('P1', { frags: 5, deaths: 9, damageDealt: 0 }),
    ], deathmatch)).toBe('P1');

    expect(modeWinner([
      fighter('P2', { frags: 4, deaths: 1, damageDealt: 100 }),
      fighter('P1', { frags: 4, deaths: 2, damageDealt: 200 }),
    ], deathmatch)).toBe('P2');

    expect(modeWinner([
      fighter('P2', { frags: 4, deaths: 1, damageDealt: 100 }),
      fighter('P1', { frags: 4, deaths: 1, damageDealt: 150 }),
    ], deathmatch)).toBe('P1');

    expect(modeWinner([
      fighter('P2', { frags: 4, deaths: 1, damageDealt: 150 }),
      fighter('P1', { frags: 4, deaths: 1, damageDealt: 150 }),
    ], deathmatch)).toBeNull();
  });

  it('is independent of roster order and can rank more than two fighters', () => {
    const roster = [
      fighter('P3', { frags: 2, deaths: 0 }),
      fighter('P1', { frags: 5, deaths: 3 }),
      fighter('P4', { frags: 5, deaths: 4 }),
      fighter('P2', { frags: 5, deaths: 2 }),
    ];
    expect(modeWinner(roster, deathmatch)).toBe('P2');
    expect(modeWinner([...roster].reverse(), deathmatch)).toBe('P2');
  });

  it('reports a positive value for the better fighter and zero for an exact tie', () => {
    const a = fighter('P1', { health: 70 });
    const b = fighter('P2', { health: 60 });
    expect(compareTieBreak(a, b, lms)).toBeGreaterThan(0);
    expect(compareTieBreak(b, a, lms)).toBeLessThan(0);
    expect(compareTieBreak(a, { ...a, id: 'P2' }, lms)).toBe(0);
  });
});
