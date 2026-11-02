import type { Fighter, ModeId, ModeRules, PlayerId, TieBreakCriterion } from './types';

/** Active match length in ticks. Unchanged from Score Brawl and shared by every mode. */
export const MATCH_TICKS = 7200;

/**
 * Every selectable mode, in a stable order. This is a runtime view of the
 * `ModeId` union for argument parsing and protocol validation; `MODE_RULES`
 * remains the single source of mode behaviour.
 */
export const MODE_IDS = ['score-brawl', 'last-man-standing', 'deathmatch'] as const satisfies readonly ModeId[];

/**
 * Single source of truth for mode behaviour. The simulation reads these fields
 * instead of branching on a mode id on every tick.
 */
export const MODE_RULES: Readonly<Record<ModeId, ModeRules>> = {
  'score-brawl': {
    id: 'score-brawl',
    stocks: null,
    respawn: 'respawn',
    fragLimit: null,
    timerTicks: MATCH_TICKS,
    tieBreak: ['score', 'kos', 'hitsReceived'],
    hitScoring: true,
    koScoring: true,
    fragScoring: false,
    trackDamage: false,
    trackDeaths: false,
  },
  'last-man-standing': {
    id: 'last-man-standing',
    stocks: 1,
    respawn: 'eliminate',
    fragLimit: null,
    timerTicks: MATCH_TICKS,
    tieBreak: ['health', 'kos', 'damage'],
    hitScoring: false,
    koScoring: false,
    fragScoring: false,
    trackDamage: true,
    trackDeaths: false,
  },
  deathmatch: {
    id: 'deathmatch',
    stocks: null,
    respawn: 'respawn',
    fragLimit: 20,
    timerTicks: MATCH_TICKS,
    tieBreak: ['frags', 'deaths', 'damage'],
    hitScoring: false,
    koScoring: false,
    fragScoring: true,
    trackDamage: true,
    trackDeaths: true,
  },
};

/** Rules lookup for the default Score Brawl state that has no explicit mode. */
export function modeRules(mode: ModeId = 'score-brawl'): ModeRules {
  return MODE_RULES[mode];
}

/** Number of fighters that are still in the match. */
export function aliveCount(fighters: readonly Fighter[]): number {
  return fighters.reduce((count, fighter) => count + (fighter.eliminated ? 0 : 1), 0);
}

/** Numeric value for one tie-break criterion. Exhaustive by design. */
export function modeMetric(fighter: Fighter, criterion: TieBreakCriterion): number {
  switch (criterion) {
    case 'score': return fighter.score;
    case 'health': return fighter.health;
    case 'kos': return fighter.koCount;
    case 'frags': return fighter.frags ?? 0;
    case 'deaths': return fighter.deaths ?? 0;
    case 'damage': return fighter.damageDealt ?? 0;
    case 'hitsReceived': return fighter.hitsReceived;
  }
}

/** Fewest deaths / fewest hits received win; every other criterion is higher-is-better. */
function lowerIsBetter(criterion: TieBreakCriterion): boolean {
  switch (criterion) {
    case 'deaths':
    case 'hitsReceived':
      return true;
    case 'score':
    case 'health':
    case 'kos':
    case 'frags':
    case 'damage':
      return false;
  }
}

/**
 * Positive when `a` wins the tie-break against `b`, negative when `b` wins and
 * zero when every configured criterion is equal.
 */
export function compareTieBreak(a: Fighter, b: Fighter, rules: ModeRules): number {
  for (const criterion of rules.tieBreak) {
    const difference = modeMetric(a, criterion) - modeMetric(b, criterion);
    if (difference !== 0) return lowerIsBetter(criterion) ? -difference : difference;
  }
  return 0;
}

/**
 * Winner under the mode's ordered tie-break, or null for a draw. Fighters are
 * visited in stable id order so the result never depends on roster order.
 */
export function modeWinner(fighters: readonly Fighter[], rules: ModeRules): PlayerId | null {
  if (fighters.length === 0) return null;
  const ordered = [...fighters].sort((a, b) => a.id.localeCompare(b.id));
  let best = ordered[0];
  let tied = false;
  for (const fighter of ordered.slice(1)) {
    const comparison = compareTieBreak(fighter, best, rules);
    if (comparison > 0) {
      best = fighter;
      tied = false;
    } else if (comparison === 0) {
      tied = true;
    }
  }
  return tied ? null : best.id;
}
