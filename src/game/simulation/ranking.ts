import { compareTieBreak, modeMetric, modeRules } from './modes';
import type { Fighter, GameEvent, GameState, ModeId, ModeRules, PlayerId } from './types';

/** One ranked fighter. */
export type RankedEntry = {
  id: PlayerId;
  /**
   * 1-based competition rank: equal places share a rank and the next rank is
   * skipped (1, 1, 3), the same convention as `standings`.
   */
  rank: number;
  /**
   * Primary sortable value of the mode, higher is better:
   * Score Brawl score, Deathmatch frags, Last Man Standing survival position
   * (0 = eliminated first, one more than the last elimination wave = survived).
   */
  metric: number;
};

/** Result of ranking a finished match, or of ranking a live state for a HUD. */
export type MatchRanking = {
  mode: ModeId;
  /** Best first. Ties keep a deterministic display order but share a rank. */
  order: readonly RankedEntry[];
  /**
   * True when rank 1 is shared or when the simulation ended the match without
   * a winner (`MatchEnded.winner === null`). Never infer a draw from text.
   */
  draw: boolean;
  /** Ids at rank 1: exactly one for a win, several for a draw. */
  winners: readonly PlayerId[];
};

/**
 * Eliminated fighters in the order their first `Knockout` event was observed.
 *
 * Pure fold over the supplied sequence: `Knockout.target` is the eliminated
 * fighter, repeated knockouts of the same target are ignored (respawn modes
 * can knock the same fighter out more than once) and every other event type is
 * skipped. Last Man Standing eliminates a target on its first knockout, so the
 * returned list is also that mode's elimination order.
 *
 * Pass the full observed stream (every event since `MatchStarted`). A finished
 * state's own `events` array only holds the most recent tick.
 */
export function eliminationOrder(events: readonly GameEvent[]): PlayerId[] {
  return eliminationWaves(events).flat();
}

/**
 * Elimination groups, earliest first. Knockouts emitted on the same tick are
 * simultaneous and therefore form one group.
 */
function eliminationWaves(events: readonly GameEvent[]): PlayerId[][] {
  const seen = new Set<PlayerId>();
  const waves: PlayerId[][] = [];
  let waveTick: number | undefined;
  for (const event of events) {
    if (event.type !== 'Knockout' || !event.target || seen.has(event.target)) continue;
    seen.add(event.target);
    if (waves.length > 0 && event.tick === waveTick) {
      waves[waves.length - 1].push(event.target);
    } else {
      waves.push([event.target]);
      waveTick = event.tick;
    }
  }
  return waves;
}

/** Best first under the mode's ordered tie-break, id order for equal places. */
function orderByRules(fighters: readonly Fighter[], rules: ModeRules): Fighter[] {
  return [...fighters].sort((a, b) => compareTieBreak(b, a, rules) || a.id.localeCompare(b.id));
}

/**
 * Consecutive fighters that are exactly equal under the mode's tie-break, best
 * group first. The id is only a stable display order and never splits a tie.
 */
function ruleGroups(fighters: readonly Fighter[], rules: ModeRules): Fighter[][] {
  const groups: Fighter[][] = [];
  for (const fighter of orderByRules(fighters, rules)) {
    const group = groups[groups.length - 1];
    if (group && compareTieBreak(group[0], fighter, rules) === 0) group.push(fighter);
    else groups.push([fighter]);
  }
  return groups;
}

/** Deterministic display order inside an elimination wave: KOs, damage, id. */
function knockoutOrder(a: Fighter, b: Fighter): number {
  return b.koCount - a.koCount || (b.damageDealt ?? 0) - (a.damageDealt ?? 0) || a.id.localeCompare(b.id);
}

/** Competition ranking over ordered groups; every member of a group ties. */
function groupEntries(groups: readonly Fighter[][], metricOf: (fighter: Fighter) => number): RankedEntry[] {
  const entries: RankedEntry[] = [];
  let rank = 1;
  for (const group of groups) {
    for (const fighter of group) entries.push({ id: fighter.id, rank, metric: metricOf(fighter) });
    rank += group.length;
  }
  return entries;
}

/** Score Brawl, Deathmatch and Wave: the mode's own ordered tie-break decides. */
function rankByRules(fighters: readonly Fighter[], rules: ModeRules): RankedEntry[] {
  const primary = rules.tieBreak[0];
  return groupEntries(ruleGroups(fighters, rules), fighter => modeMetric(fighter, primary));
}

/**
 * Last Man Standing places survivors first, then eliminated fighters in reverse
 * elimination order (the last fighter eliminated is the best placed). Multiple
 * survivors only happen on a timeout, so they use the mode's own tie-break
 * (remaining HP, then KOs, then damage) and the displayed winner always matches
 * `modeWinner`. A simultaneous knockout wave shares one rank because the
 * simulation treats it as a draw; KO count and damage only order the display
 * inside that place. Eliminated fighters missing from the observed events keep
 * a deterministic place after every observed wave (an incomplete event stream
 * cannot recover their real order).
 */
function rankLastManStanding(fighters: readonly Fighter[], events: readonly GameEvent[]): RankedEntry[] {
  const byId = new Map(fighters.map(fighter => [fighter.id, fighter]));
  const rules = modeRules('last-man-standing');
  const survivorGroups = ruleGroups(fighters.filter(fighter => !fighter.eliminated), rules);
  const waves = eliminationWaves(events);
  const placed = new Set<PlayerId>();
  const metrics = new Map<PlayerId, number>();
  for (const fighter of fighters) metrics.set(fighter.id, -1);
  for (const group of survivorGroups) for (const fighter of group) metrics.set(fighter.id, waves.length);

  const groups: Fighter[][] = survivorGroups.map(group => [...group]);
  for (let index = waves.length - 1; index >= 0; index--) {
    const wave: Fighter[] = [];
    for (const id of waves[index]) {
      if (placed.has(id)) continue;
      placed.add(id);
      // A fighter the state still considers alive was not really eliminated;
      // it is already placed with the survivors.
      const fighter = byId.get(id);
      if (!fighter || !fighter.eliminated) continue;
      wave.push(fighter);
    }
    if (wave.length === 0) continue;
    wave.sort(knockoutOrder);
    for (const fighter of wave) metrics.set(fighter.id, index);
    groups.push(wave);
  }

  const unplaced = fighters
    .filter(fighter => fighter.eliminated && !placed.has(fighter.id))
    .sort(knockoutOrder);
  if (unplaced.length > 0) groups.push(unplaced);

  return groupEntries(groups, fighter => metrics.get(fighter.id) ?? -1);
}

function lastMatchEnded(events: readonly GameEvent[]): GameEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index].type === 'MatchEnded') return events[index];
  }
  return undefined;
}

/**
 * Rank a finished match (or a live state) for results presentation.
 *
 * Pure: it reads the state and an optional event stream and never mutates
 * either. `events` defaults to `state.events`, which is only the last tick;
 * pass the accumulated stream so Last Man Standing can rebuild the elimination
 * order.
 *
 * A draw is reported when the top place is shared under the mode's rule or when
 * `MatchEnded.winner` is explicitly `null`. Score Brawl's historical
 * `MatchEnded` has no winner field, so that mode relies on the shared top place.
 */
export function rankMatch(state: GameState, events: readonly GameEvent[] = state.events): MatchRanking {
  const mode = state.mode ?? 'score-brawl';
  let order: RankedEntry[];
  switch (mode) {
    case 'score-brawl':
    case 'deathmatch':
    case 'wave':
      // Wave ranks purely by score (M13): an equal score is a draw.
      order = rankByRules(state.fighters, modeRules(mode));
      break;
    case 'last-man-standing':
      order = rankLastManStanding(state.fighters, events);
      break;
  }
  const winners = order.filter(entry => entry.rank === 1).map(entry => entry.id);
  const ended = lastMatchEnded(events);
  return { mode, order, draw: ended?.winner === null || winners.length > 1, winners };
}
