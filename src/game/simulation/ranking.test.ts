import { describe, expect, it } from 'vitest';
import { MODE_RULES, createState, modeWinner, standings, step } from './step';
import { eliminationOrder, rankMatch } from './ranking';
import type { EndReason, Fighter, GameEvent, ModeId, PlayerInput, GameState } from './types';

const fighter = (id: string, overrides: Partial<Fighter> = {}): Fighter => ({
  id, x: 0, y: 0, z: 0, vz: 0, facing: 1, health: 100, score: 0, koCount: 0, hitsReceived: 0,
  attackCooldown: 0, attackFrames: 0, attackMove: null, hitTargets: [], hitstun: 0, koTimer: 0,
  protection: 0, previousButtons: [], ...overrides,
});

/** Finished state; Score Brawl omits `mode` just like the simulation does. */
const gameState = (mode: ModeId, fighters: Fighter[], events: GameEvent[] = []): GameState => ({
  tick: 0, phase: 'results', countdownTicks: 0, remainingTicks: 0, fighters, events,
  ...(mode === 'score-brawl' ? {} : { mode }),
});

const knockout = (tick: number, target: string, attacker = 'P1'): GameEvent =>
  ({ tick, type: 'Knockout', attacker, target });
/** Historical Score Brawl lifecycle event: no reason and no winner field. */
const scoreBrawlEnded = (tick: number): GameEvent => ({ tick, type: 'MatchEnded' });
const modeEnded = (tick: number, winner: string | null, reason: EndReason = 'time'): GameEvent =>
  ({ tick, type: 'MatchEnded', reason, winner });

const placements = (state: GameState, events?: GameEvent[]): [string, number][] =>
  rankMatch(state, events).order.map(entry => [entry.id, entry.rank]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('M9 per-mode ranking', () => {
  it('ranks Score Brawl by score, KOs and hits received, then a stable id order', () => {
    const state = gameState('score-brawl', [
      fighter('P4', { score: 500, koCount: 1, hitsReceived: 3 }),
      fighter('P1', { score: 700 }),
      fighter('P3', { score: 500, koCount: 1, hitsReceived: 1 }),
      fighter('P2', { score: 500 }),
      fighter('P5', { score: 100 }),
    ]);
    const ranking = rankMatch(state, [scoreBrawlEnded(7200)]);
    expect(ranking.mode).toBe('score-brawl');
    expect(placements(state, [scoreBrawlEnded(7200)])).toEqual([
      ['P1', 1], ['P3', 2], ['P4', 3], ['P2', 4], ['P5', 5],
    ]);
    expect(ranking.order.map(entry => entry.metric)).toEqual([700, 500, 500, 500, 100]);
    // Same order and competition ranks as the existing Score Brawl standings.
    expect(ranking.order.map(entry => ({ id: entry.id, rank: entry.rank, score: entry.metric })))
      .toEqual(standings(state));
    expect(ranking.draw).toBe(false);
    expect(ranking.winners).toEqual(['P1']);
  });

  it('shares a Score Brawl rank and reports a draw only when the top place is tied', () => {
    const tied = gameState('score-brawl', [
      fighter('P2', { score: 600 }),
      fighter('P1', { score: 600 }),
      fighter('P3', { score: 100 }),
    ]);
    const ranking = rankMatch(tied, [scoreBrawlEnded(7200)]);
    expect(ranking.order).toEqual([
      { id: 'P1', rank: 1, metric: 600 },
      { id: 'P2', rank: 1, metric: 600 },
      { id: 'P3', rank: 3, metric: 100 },
    ]);
    expect(ranking.draw).toBe(true);
    expect(ranking.winners).toEqual(['P1', 'P2']);

    // Equal places below first still share a rank but do not turn the win into a draw.
    const clearWinner = gameState('score-brawl', [
      fighter('P1', { score: 700 }),
      fighter('P2', { score: 500 }),
      fighter('P3', { score: 500 }),
    ]);
    const win = rankMatch(clearWinner, [scoreBrawlEnded(7200)]);
    expect(win.order.map(entry => [entry.id, entry.rank])).toEqual([['P1', 1], ['P2', 2], ['P3', 2]]);
    expect(win.draw).toBe(false);
    expect(win.winners).toEqual(['P1']);
  });

  it('ranks Deathmatch by frags, fewest deaths and damage dealt', () => {
    const state = gameState('deathmatch', [
      fighter('P4', { frags: 5, deaths: 1, damageDealt: 100 }),
      fighter('P1', { frags: 5, deaths: 1, damageDealt: 50 }),
      fighter('P3', { frags: 5, deaths: 2, damageDealt: 200 }),
      fighter('P2', { frags: 7, deaths: 3 }),
    ]);
    const events = [modeEnded(4000, 'P2', 'frag-limit')];
    expect(placements(state, events)).toEqual([['P2', 1], ['P4', 2], ['P1', 3], ['P3', 4]]);
    expect(rankMatch(state, events).order.map(entry => entry.metric)).toEqual([7, 5, 5, 5]);
    expect(rankMatch(state, events).draw).toBe(false);
    expect(rankMatch(state, events).winners).toEqual(['P2']);
  });

  it('reports a Deathmatch draw from an exact top tie or a null simulation winner', () => {
    const tied = gameState('deathmatch', [
      fighter('P2', { frags: 3, deaths: 1, damageDealt: 40 }),
      fighter('P1', { frags: 3, deaths: 1, damageDealt: 40 }),
    ]);
    const ranking = rankMatch(tied, [modeEnded(7200, null)]);
    expect(ranking.order).toEqual([
      { id: 'P1', rank: 1, metric: 3 },
      { id: 'P2', rank: 1, metric: 3 },
    ]);
    expect(ranking.draw).toBe(true);
    expect(ranking.winners).toEqual(['P1', 'P2']);

    // The helper can decide a draw without a MatchEnded event at all, and a
    // shared top place is a draw even if an inconsistent event claimed a winner.
    expect(rankMatch(tied).draw).toBe(true);
    expect(rankMatch(tied, [modeEnded(7200, 'P1')]).draw).toBe(true);

    const clearWinner = gameState('deathmatch', [fighter('P1', { frags: 5 }), fighter('P2', { frags: 4 })]);
    expect(rankMatch(clearWinner, [modeEnded(7200, 'P1')]).draw).toBe(false);
  });

  it('places the Last Man Standing survivor first and then reverse elimination order', () => {
    const state = gameState('last-man-standing', [
      fighter('P3', { eliminated: true, health: 0, koCount: 2, damageDealt: 40 }),
      fighter('P1'),
      fighter('P2', { eliminated: true, health: 0, koCount: 1, damageDealt: 20 }),
    ]);
    const events = [knockout(10, 'P3'), knockout(20, 'P2'), modeEnded(20, 'P1', 'elimination')];
    const ranking = rankMatch(state, events);
    expect(placements(state, events)).toEqual([['P1', 1], ['P2', 2], ['P3', 3]]);
    expect(ranking.order.map(entry => entry.metric)).toEqual([2, 1, 0]);
    expect(ranking.draw).toBe(false);
    expect(ranking.winners).toEqual(['P1']);
    // The first fighter eliminated is placed last, not second.
    expect(ranking.order.find(entry => entry.id === 'P3')).toEqual({ id: 'P3', rank: 3, metric: 0 });
  });

  it('keeps a simultaneous Last Man Standing knockout wave tied instead of inventing a winner', () => {
    const state = gameState('last-man-standing', [
      fighter('P1', { eliminated: true, health: 0, koCount: 1 }),
      fighter('P2', { eliminated: true, health: 0, koCount: 2 }),
      fighter('P3', { eliminated: true, health: 0, damageDealt: 10 }),
    ]);
    const events = [knockout(5, 'P3'), knockout(20, 'P1'), knockout(20, 'P2'), modeEnded(20, null, 'elimination')];
    const ranking = rankMatch(state, events);
    // KO count only orders the display inside the shared first place.
    expect(placements(state, events)).toEqual([['P2', 1], ['P1', 1], ['P3', 3]]);
    expect(ranking.draw).toBe(true);
    expect(ranking.winners).toEqual(['P2', 'P1']);
  });

  it('ranks Last Man Standing survivors on the mode tie-break so the shown winner matches the simulation', () => {
    const state = gameState('last-man-standing', [
      fighter('P1', { health: 90 }),
      fighter('P2', { health: 90, koCount: 2, damageDealt: 50 }),
      fighter('P3', { health: 70, koCount: 5, damageDealt: 99 }),
    ]);
    const events = [modeEnded(7200, 'P2')];
    const ranking = rankMatch(state, events);
    // Health decides first: fewer KOs than P3 still wins on remaining HP.
    expect(placements(state, events)).toEqual([['P2', 1], ['P1', 2], ['P3', 3]]);
    expect(ranking.order[0].id).toBe(modeWinner(state.fighters, MODE_RULES['last-man-standing']));
    expect(ranking.draw).toBe(false);

    const tied = gameState('last-man-standing', [
      fighter('P1', { health: 80, koCount: 1, damageDealt: 10 }),
      fighter('P2', { health: 80, koCount: 1, damageDealt: 10 }),
    ]);
    const draw = rankMatch(tied, [modeEnded(7200, null)]);
    expect(draw.order.map(entry => entry.rank)).toEqual([1, 1]);
    expect(draw.draw).toBe(true);
    expect(draw.winners).toEqual(['P1', 'P2']);
    expect(modeWinner(tied.fighters, MODE_RULES['last-man-standing'])).toBeNull();
  });

  it('folds Knockout events into a first-elimination order without mutating them', () => {
    const events: GameEvent[] = [
      { tick: 1, type: 'MatchStarted' },
      knockout(5, 'P2'),
      { tick: 6, type: 'HitLanded', attacker: 'P1', target: 'P2', move: 'punch' },
      knockout(9, 'P4'),
      knockout(12, 'P2', 'P3'), // repeated knockout of the same target is ignored
      knockout(20, 'P1'),
      { tick: 21, type: 'Respawned', target: 'P1' },
      { tick: 22, type: 'Knockout' }, // malformed event without a target
      knockout(30, 'P3'),
    ];
    const snapshot = JSON.stringify(events);
    expect(eliminationOrder(events)).toEqual(['P2', 'P4', 'P1', 'P3']);
    expect(eliminationOrder(events)).toEqual(['P2', 'P4', 'P1', 'P3']);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it('places eliminated fighters missing from an incomplete event stream after the observed waves', () => {
    const state = gameState('last-man-standing', [
      fighter('P1'),
      fighter('P2', { eliminated: true, health: 0 }),
      fighter('P3', { eliminated: true, health: 0, koCount: 3 }),
    ]);
    // Only the last knockout was observed; P2's earlier elimination is unknown.
    const events = [knockout(20, 'P3'), modeEnded(20, 'P1', 'elimination')];
    expect(placements(state, events)).toEqual([['P1', 1], ['P3', 2], ['P2', 3]]);
  });

  it('is deterministic across repeated calls and independent of roster order', () => {
    const fighters = [
      fighter('P2', { eliminated: true, health: 0, koCount: 1 }),
      fighter('P1'),
      fighter('P3', { eliminated: true, health: 0 }),
    ];
    const events = [knockout(5, 'P2'), knockout(12, 'P3'), modeEnded(12, 'P1', 'elimination')];
    const forward = gameState('last-man-standing', fighters, events);
    const reversed = gameState('last-man-standing', [...fighters].reverse(), events);
    const first = rankMatch(forward, events);
    expect(rankMatch(forward, events)).toEqual(first);
    expect(rankMatch(reversed, events)).toEqual(first);
    expect(rankMatch(forward, [...events])).toEqual(first);
  });

  it('does not mutate the state or events and tolerates fully frozen inputs', () => {
    const cases: { state: GameState; events: GameEvent[] }[] = [
      { state: gameState('score-brawl', [fighter('P1', { score: 10 }), fighter('P2')]), events: [scoreBrawlEnded(7200)] },
      { state: gameState('deathmatch', [fighter('P1', { frags: 2 }), fighter('P2', { frags: 1 })]), events: [modeEnded(4000, 'P1')] },
      {
        state: gameState('last-man-standing', [fighter('P1'), fighter('P2', { eliminated: true, health: 0 })]),
        events: [knockout(10, 'P2'), modeEnded(10, 'P1', 'elimination')],
      },
    ];
    for (const { state, events } of cases) {
      const frozenState = deepFreeze(state);
      const frozenEvents = deepFreeze(events);
      const before = JSON.stringify({ state: frozenState, events: frozenEvents });
      const ranking = rankMatch(frozenState, frozenEvents);
      expect(JSON.stringify({ state: frozenState, events: frozenEvents })).toBe(before);
      expect(ranking.order).toHaveLength(frozenState.fighters.length);
      expect(new Set(ranking.order.map(entry => entry.id)).size).toBe(frozenState.fighters.length);
    }
  });

  it('derives the Last Man Standing order from a real match event stream', () => {
    const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
    const punch = (playerId: string): PlayerInput => ({ ...neutral(playerId), punch: true });
    const initial = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'last-man-standing' });
    initial.fighters = initial.fighters.map(current => {
      if (current.id === 'P1') return { ...current, x: 100, y: 150, facing: 1 };
      if (current.id === 'P2') return { ...current, x: 125, y: 150, facing: -1, health: 10 };
      return { ...current, x: 300, y: 150, facing: -1, health: 10 };
    });

    let state = initial;
    const events: GameEvent[] = [];
    for (let tick = 0; tick < 160; tick++) {
      const playerOne: PlayerInput = tick === 0 || tick === 141
        ? punch('P1')
        // M11: 116 walk ticks at 1.56 px/tick land just inside punch reach of
        // P3 at x=300; the old 139-tick walk assumed 1.3 px/tick.
        : tick <= 116 ? { ...neutral('P1'), moveX: 1 } : neutral('P1');
      state = step(state, [playerOne, neutral('P2'), neutral('P3')]);
      events.push(...state.events);
    }

    expect(state.phase).toBe('results');
    expect(events.filter(event => event.type === 'Knockout').map(event => event.target)).toEqual(['P2', 'P3']);
    const ranking = rankMatch(state, events);
    expect(ranking.order.map(entry => [entry.id, entry.rank])).toEqual([['P1', 1], ['P3', 2], ['P2', 3]]);
    expect(ranking.draw).toBe(false);
    expect(ranking.winners).toEqual(['P1']);
    expect(ranking.winners[0]).toBe([...events].reverse().find(event => event.type === 'MatchEnded')?.winner);
  });
});
