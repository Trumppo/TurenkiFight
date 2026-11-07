/**
 * ADR 0006: declarative arena gameplay rules.
 *
 * An arena contributes location behaviour, never combat or mode rules. The
 * whole rule set is one typed table loaded by a stable arena id, so the tick
 * loop reads data instead of branching on arena names. A hazard is a pure
 * function of the simulation tick: no randomness, no wall clock and no extra
 * state, exactly like the Deathmatch zone.
 *
 * Timing convention for one cycle of `periodTicks`:
 *
 *   [0, warningStart)          idle
 *   [warningStart, activeStart) warning (telegraph only, no damage)
 *   [activeStart, periodTicks)  active (damage on a fixed cadence)
 *
 * Both windows sit at the end of the cycle, so the collapse ends one cycle and
 * is followed by the calm part of the next. `warningTicks` is measured up to
 * the first active tick, which is what a player needs in order to leave the
 * band. Damage is applied on the first active tick and every
 * `damageEveryTicks` ticks after it, so an active window of `activeTicks`
 * carries exactly `ceil(activeTicks / damageEveryTicks)` damage instances
 * regardless of how the period divides.
 *
 * This module must stay presentation-free and deterministic.
 */
import type { ArenaId } from './types';

/** Arena ids that carry gameplay rules. `station` is the default (absent id). */
export type ArenaRuleId = 'station' | ArenaId;

/** World-space danger band on the ground plane. Both bounds are inclusive. */
export type HazardBand = { readonly minY: number; readonly maxY: number };

export type ArenaHazard = {
  /** Cycle length in simulation ticks. */
  readonly periodTicks: number;
  /** Telegraph ticks before the first active tick. Never damages. */
  readonly warningTicks: number;
  /** Dangerous ticks; the warning ends on the first one. */
  readonly activeTicks: number;
  /** Ground-plane depth band; every fighter whose `y` is inside takes damage. */
  readonly band: HazardBand;
  /** HP removed per damage instance. */
  readonly damagePerTick: number;
  /** Fixed cadence between damage instances inside the active window. */
  readonly damageEveryTicks: number;
};

export type ArenaRules = {
  readonly id: ArenaRuleId;
  /** `null` means the arena has no hazard of its own. */
  readonly hazard: ArenaHazard | null;
};

/**
 * Closed union of arena rule ids, in the same order as the presentation arena
 * list (`station`, `mesku`, `kkauppa`). Unknown ids fail fast instead of
 * silently behaving like the station.
 */
export const ARENA_RULE_IDS: readonly ArenaRuleId[] = ['station', 'mesku', 'kkauppa'];

/**
 * First-slice arena table. Only K-kauppa owns a hazard; the station and Mesku
 * keep `hazard: null`, so Deathmatch's shrinking zone stays a mode rule and no
 * arena/mode combination needs a new branch.
 *
 * K-kauppa shelf: a 45 s cycle whose final 3 s are the warning and whose final
 * 2 s are the collapse, hurting the strip in front of the back-wall shelf for
 * 1 HP every 6 ticks (20 HP for a fighter that never leaves the band).
 */
export const ARENA_RULES: Readonly<Record<ArenaRuleId, ArenaRules>> = {
  station: { id: 'station', hazard: null },
  mesku: { id: 'mesku', hazard: null },
  kkauppa: {
    id: 'kkauppa',
    hazard: {
      periodTicks: 2700,
      warningTicks: 180,
      activeTicks: 120,
      band: { minY: 124, maxY: 156 },
      damagePerTick: 1,
      damageEveryTicks: 6,
    },
  },
};

/**
 * Fail fast on a mistuned row instead of shipping a hazard that can never be
 * escaped or never fires. A band is only required to be a valid interval;
 * keeping it inside the playable bounds is asserted by the arena tests so this
 * module does not import the simulation bounds and create an import cycle.
 */
export function validateArenaRules(rules: ArenaRules): void {
  if (!ARENA_RULE_IDS.includes(rules.id)) throw new Error(`Unknown arena rule id: ${String(rules.id)}`);
  const hazard = rules.hazard;
  if (!hazard) return;
  const integer = (value: number, name: string, minimum: number): void => {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`Arena hazard ${name} must be a safe integer >= ${minimum}: ${value}`);
    }
  };
  integer(hazard.periodTicks, 'periodTicks', 1);
  integer(hazard.warningTicks, 'warningTicks', 0);
  integer(hazard.activeTicks, 'activeTicks', 1);
  integer(hazard.damagePerTick, 'damagePerTick', 1);
  integer(hazard.damageEveryTicks, 'damageEveryTicks', 1);
  if (hazard.warningTicks + hazard.activeTicks > hazard.periodTicks) {
    throw new Error('Arena hazard warning and active windows must fit inside the cycle');
  }
  const { minY, maxY } = hazard.band;
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY > maxY) {
    throw new Error(`Arena hazard band must be a finite interval: ${minY}..${maxY}`);
  }
}

for (const rules of Object.values(ARENA_RULES)) validateArenaRules(rules);

/**
 * Rules for the state's arena. An absent id means the station, exactly like an
 * absent mode means Score Brawl. An unknown runtime id throws rather than
 * falling back silently.
 */
export function arenaRules(arena?: ArenaId): ArenaRules {
  if (arena === undefined) return ARENA_RULES.station;
  const rules = (ARENA_RULES as Readonly<Record<string, ArenaRules>>)[arena];
  if (!rules) throw new Error(`Unknown arena id: ${String(arena)}`);
  return rules;
}

/** Idle, warning or active part of the hazard cycle at `tick`. */
export type HazardPhase = 'idle' | 'warning' | 'active';

/** First dangerous tick of the cycle. */
export function hazardActiveStart(hazard: ArenaHazard): number {
  return hazard.periodTicks - hazard.activeTicks;
}

/** First warning (telegraph) tick of the cycle. */
export function hazardWarningStart(hazard: ArenaHazard): number {
  return hazardActiveStart(hazard) - hazard.warningTicks;
}

/**
 * Hazard phase at a simulation tick. Negative or non-finite ticks are `idle`
 * so presentation code can call this defensively without inventing a phase.
 */
export function hazardPhaseAt(tick: number, hazard: ArenaHazard | null): HazardPhase {
  if (!hazard || !Number.isFinite(tick) || tick < 0) return 'idle';
  const phase = tick % hazard.periodTicks;
  if (phase >= hazardActiveStart(hazard)) return 'active';
  if (phase >= hazardWarningStart(hazard)) return 'warning';
  return 'idle';
}

/**
 * True on the ticks where a fighter inside the band loses HP. The cadence is
 * anchored to the first active tick, so every active window deals the same
 * number of instances.
 */
export function isHazardDamageTick(tick: number, hazard: ArenaHazard | null): boolean {
  if (!hazard || hazardPhaseAt(tick, hazard) !== 'active') return false;
  const phase = tick % hazard.periodTicks;
  return (phase - hazardActiveStart(hazard)) % hazard.damageEveryTicks === 0;
}

/** Both band bounds are inclusive, matching the zone's range semantics. */
export function isInsideHazardBand(y: number, band: HazardBand): boolean {
  return Number.isFinite(y) && y >= band.minY && y <= band.maxY;
}
