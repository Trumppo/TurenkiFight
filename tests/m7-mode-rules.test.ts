import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MATCH_TICKS, MOVES, createState, step } from '../src/game/simulation/step';
import type { GameEvent, GameState, PlayerInput } from '../src/game/simulation/types';

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const punch = (playerId: string): PlayerInput => ({ ...neutral(playerId), punch: true });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function runFixture(initial: GameState, frames: PlayerInput[][]): { state: GameState; events: GameEvent[] } {
  let state = initial;
  const events: GameEvent[] = [];
  for (const frame of frames) {
    state = step(state, frame);
    events.push(...state.events);
  }
  return { state, events };
}

function matchEnded(state: GameState): GameEvent | undefined {
  return [...state.events].reverse().find(event => event.type === 'MatchEnded');
}

function lastManStandingFixture(): { initial: GameState; frames: PlayerInput[][] } {
  const initial = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'last-man-standing' });
  initial.fighters = initial.fighters.map(fighter => {
    if (fighter.id === 'P1') return { ...fighter, x: 100, y: 150, facing: 1 };
    if (fighter.id === 'P2') return { ...fighter, x: 125, y: 150, facing: -1, health: 10 };
    return { ...fighter, x: 300, y: 150, facing: -1, health: 10 };
  });
  const frames: PlayerInput[][] = [];
  for (let tick = 0; tick < 160; tick++) {
    const p1: PlayerInput = tick === 0 || tick === 141
      ? punch('P1')
      : tick <= 139 ? { ...neutral('P1'), moveX: 1 } : neutral('P1');
    frames.push([p1, neutral('P2'), neutral('P3')]);
  }
  return { initial, frames };
}

function deathmatchFixture(): { initial: GameState; frames: PlayerInput[][] } {
  const initial = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
  initial.remainingTicks = 186;
  initial.fighters = initial.fighters.map(fighter => fighter.id === 'P1'
    ? { ...fighter, x: 100, y: 150, facing: 1 }
    : { ...fighter, x: 125, y: 150, facing: -1, health: 10 });
  const frames: PlayerInput[][] = [];
  for (let tick = 0; tick < 186; tick++) {
    frames.push([tick === 0 ? punch('P1') : neutral('P1'), neutral('P2')]);
  }
  return { initial, frames };
}

// Independently recorded SHA-256 fingerprints for the scripted fixtures below.
// M10 zone note: this Deathmatch fixture ends at tick 186, before the first
// shrink at tick 1080, so the zone is inert here and its fingerprint is
// intentionally unchanged. Zone-crossing coverage and its own pins live in
// `tests/m10-deathmatch-zone.test.ts`.
const LMS_FINAL_STATE_SHA256 = '95c0e63b3344635094e3436d060bb393077b79efbc48e7109caa6a77bd9447f1';
const LMS_ORDERED_EVENTS_SHA256 = '87be89ee9228dfab5463a69f3f014f6dea8048a3367f561a58ef1a89ecf872cd';
const DEATHMATCH_FINAL_STATE_SHA256 = '6e92d22dd779d6a193ffc8d97f8066937a97e643bdedd26257eda20a5b0f03e3';
const DEATHMATCH_ORDERED_EVENTS_SHA256 = 'eba64c270d28a4ae02d839cb0d45b0fc6c65b878c8fccbc4c39cb614cde164f1';

describe('M7 mode selection', () => {
  it('accepts the mode through a setup object or the positional form', () => {
    expect(createState({ mode: 'last-man-standing' }).mode).toBe('last-man-standing');
    expect(createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' }).mode).toBe('deathmatch');
    expect(createState(['P1', 'P2'], 'fighting', { mode: 'deathmatch' }).mode).toBe('deathmatch');
    expect(createState({ mode: 'last-man-standing' }).remainingTicks).toBe(MATCH_TICKS);
  });

  it('omits the mode field for Score Brawl so historical state bytes are unchanged', () => {
    for (const state of [createState(), createState(['P1', 'P2'], 'fighting'), createState({ mode: 'score-brawl' })]) {
      expect('mode' in state).toBe(false);
      expect(Object.keys(state)).toEqual(['tick', 'phase', 'countdownTicks', 'remainingTicks', 'events', 'fighters']);
      expect(Object.keys(state.fighters[0])).toEqual([
        'id', 'x', 'y', 'z', 'vz', 'facing', 'health', 'score', 'koCount', 'hitsReceived',
        'attackCooldown', 'attackFrames', 'attackMove', 'hitTargets', 'hitstun', 'koTimer',
        'protection', 'previousButtons',
      ]);
    }
    const ended = step({ ...createState(['P1', 'P2'], 'fighting'), remainingTicks: 1 }, []);
    expect(ended.events).toEqual([{ tick: 1, type: 'MatchEnded' }]);
  });
});

describe('M7 Last Man Standing', () => {
  it('eliminates on KO instead of respawning and ends when one remains', () => {
    let state = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'last-man-standing' });
    state = {
      ...state,
      fighters: state.fighters.map(fighter => fighter.id === 'P1'
        ? { ...fighter, x: 100, y: 150, facing: 1 }
        : { ...fighter, x: 125, y: 150, facing: -1, health: 10 }),
    };
    for (let tick = 0; tick < 5; tick++) {
      state = step(state, [tick === 0 ? punch('P1') : neutral('P1'), neutral('P2')]);
    }
    const eliminated = state.fighters.find(fighter => fighter.id === 'P2')!;
    expect(eliminated.eliminated).toBe(true);
    expect(eliminated.koTimer).toBe(0);
    expect(eliminated.health).toBe(0);
    expect(state.phase).toBe('results');
    expect(matchEnded(state)).toMatchObject({ type: 'MatchEnded', reason: 'elimination', winner: 'P1' });
    expect(state.events.filter(event => event.type === 'Respawned')).toEqual([]);
  });

  it('draws when a simultaneous KO leaves zero fighters', () => {
    const state = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'last-man-standing' });
    const fighters = state.fighters.map((fighter, index) => ({
      ...fighter,
      x: 100 + index * 20,
      y: 150,
      facing: index === 0 ? 1 as const : -1 as const,
      health: 10,
      attackMove: 'punch' as const,
      attackFrames: MOVES.punch.active + MOVES.punch.recovery + 1,
    }));
    const next = step({ ...state, fighters }, []);
    expect(next.fighters.map(fighter => fighter.eliminated)).toEqual([true, true]);
    expect(next.phase).toBe('results');
    expect(matchEnded(next)).toMatchObject({ reason: 'elimination', winner: null });
  });

  it('ignores ghost input and never targets an eliminated fighter', () => {
    const base = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'last-man-standing' });
    const eliminated = {
      ...base,
      fighters: base.fighters.map(fighter => fighter.id === 'P3'
        ? { ...fighter, eliminated: true, health: 0, x: 120, y: 150 }
        : fighter.id === 'P1' ? { ...fighter, x: 100, y: 150, facing: 1 as const } : fighter),
    };
    const ghostInput = step(eliminated, [{ ...neutral('P3'), moveX: 1, punch: true }, neutral('P1'), neutral('P2')]);
    const ignored = step(eliminated, [neutral('P3'), neutral('P1'), neutral('P2')]);
    expect(ghostInput).toEqual(ignored);

    const attacking = {
      ...eliminated,
      fighters: eliminated.fighters.map(fighter => fighter.id === 'P1'
        ? { ...fighter, attackMove: 'punch' as const, attackFrames: MOVES.punch.active + MOVES.punch.recovery + 1 }
        : fighter),
    };
    const next = step(attacking, [neutral('P1'), neutral('P2'), neutral('P3')]);
    expect(next.events.some(event => event.target === 'P3' && (event.type === 'HitLanded' || event.type === 'Knockout'))).toBe(false);
    expect(next.fighters.find(fighter => fighter.id === 'P3')!.health).toBe(0);
  });

  it('breaks a timeout on HP, then KOs dealt, then damage dealt, then draws', () => {
    const timeout = (overrides: (state: GameState) => void): GameState => {
      const state = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'last-man-standing' });
      state.remainingTicks = 1;
      state.fighters[0].health = 80;
      state.fighters[1].health = 80;
      state.fighters[2].health = 70;
      overrides(state);
      return step(state, []);
    };

    const hp = timeout(state => { state.fighters[0].health = 90; state.fighters[1].health = 85; });
    expect(matchEnded(hp)).toMatchObject({ reason: 'time', winner: 'P1' });

    const kos = timeout(state => { state.fighters[0].koCount = 2; state.fighters[1].koCount = 1; });
    expect(matchEnded(kos)).toMatchObject({ reason: 'time', winner: 'P1' });

    const damage = timeout(state => { state.fighters[0].damageDealt = 50; state.fighters[1].damageDealt = 40; });
    expect(matchEnded(damage)).toMatchObject({ reason: 'time', winner: 'P1' });

    const draw = timeout(() => undefined);
    expect(matchEnded(draw)).toMatchObject({ reason: 'time', winner: null });
  });

  it('replays a scripted fixture with pinned state and ordered-event hashes', () => {
    const fixture = lastManStandingFixture();
    const first = runFixture(fixture.initial, fixture.frames);
    const restored = JSON.parse(JSON.stringify(fixture.initial)) as GameState;
    const second = runFixture(restored, fixture.frames);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(first.state.phase).toBe('results');
    expect(first.events.filter(event => event.type === 'Knockout').map(event => [event.tick, event.attacker, event.target]))
      .toEqual([[5, 'P1', 'P2'], [146, 'P1', 'P3']]);
    expect(first.events.find(event => event.type === 'MatchEnded'))
      .toMatchObject({ tick: 146, reason: 'elimination', winner: 'P1' });
    expect(hash(first.state)).toBe(LMS_FINAL_STATE_SHA256);
    expect(hash(first.events)).toBe(LMS_ORDERED_EVENTS_SHA256);
  });
});

describe('M7 Deathmatch', () => {
  it('credits one frag to the attacker and records a death on KO', () => {
    let state = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'deathmatch' });
    state = {
      ...state,
      fighters: state.fighters.map(fighter => fighter.id === 'P1'
        ? { ...fighter, x: 100, y: 150, facing: 1 }
        : fighter.id === 'P2' ? { ...fighter, x: 125, y: 150, facing: -1, health: 10 } : fighter),
    };
    for (let tick = 0; tick < 5; tick++) {
      state = step(state, [tick === 0 ? punch('P1') : neutral('P1'), neutral('P2'), neutral('P3')]);
    }
    expect(state.fighters.find(fighter => fighter.id === 'P1')!.frags).toBe(1);
    expect(state.fighters.find(fighter => fighter.id === 'P2')!.deaths).toBe(1);
    expect(state.fighters.find(fighter => fighter.id === 'P2')!.koTimer).toBeGreaterThan(0);
    expect(state.fighters.find(fighter => fighter.id === 'P2')!.health).toBe(0);
  });

  it('credits no frag for a mutual or multi-fighter simultaneous KO', () => {
    const mutual = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
    const fighters = mutual.fighters.map((fighter, index) => ({
      ...fighter,
      x: 100 + index * 20,
      y: 150,
      facing: index === 0 ? 1 as const : -1 as const,
      health: 10,
      attackMove: 'punch' as const,
      attackFrames: MOVES.punch.active + MOVES.punch.recovery + 1,
    }));
    const next = step({ ...mutual, fighters }, []);
    expect(next.events.filter(event => event.type === 'Knockout')).toHaveLength(2);
    expect(next.fighters.map(fighter => fighter.frags)).toEqual([0, 0]);
    expect(next.fighters.map(fighter => fighter.deaths)).toEqual([1, 1]);

    // P2 knocks out P1 while P1 knocks out P3 in the same tick. P1 was knocked
    // out, so P1's frag is suppressed; the still-standing P2 keeps its frag.
    const chain = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'deathmatch' });
    const chainFighters = chain.fighters.map(fighter => {
      if (fighter.id === 'P1') return { ...fighter, x: 100, y: 150, facing: 1 as const, health: 10,
        attackMove: 'punch' as const, attackFrames: MOVES.punch.active + MOVES.punch.recovery + 1 };
      if (fighter.id === 'P2') return { ...fighter, x: 80, y: 150, facing: 1 as const,
        attackMove: 'punch' as const, attackFrames: MOVES.punch.active + MOVES.punch.recovery + 1 };
      return { ...fighter, x: 120, y: 150, health: 10 };
    });
    const chainNext = step({ ...chain, fighters: chainFighters }, []);
    expect(chainNext.fighters.map(fighter => fighter.frags)).toEqual([0, 1, 0]);
  });

  it('credits only the attacker that lands the single knockout on a double-team target', () => {
    const state = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'deathmatch' });
    const fighters = state.fighters.map(fighter => {
      if (fighter.id === 'P3') return { ...fighter, x: 170, y: 150, health: 10 };
      return { ...fighter, x: fighter.id === 'P1' ? 140 : 145, y: 150, facing: 1 as const,
        attackMove: 'punch' as const, attackFrames: MOVES.punch.active + MOVES.punch.recovery + 1 };
    });
    const next = step({ ...state, fighters }, []);
    expect(next.events.filter(event => event.type === 'Knockout')).toHaveLength(1);
    expect(next.fighters.map(fighter => fighter.frags)).toEqual([1, 0, 0]);
    expect(next.fighters[2].deaths).toBe(1);
  });

  it('ends on the 20-frag limit with the frag leader as winner', () => {
    let state = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'deathmatch' });
    state = {
      ...state,
      fighters: state.fighters.map(fighter => fighter.id === 'P1'
        ? { ...fighter, x: 100, y: 150, facing: 1, frags: 19 }
        : fighter.id === 'P2' ? { ...fighter, x: 125, y: 150, facing: -1, health: 10 } : fighter),
    };
    for (let tick = 0; tick < 5; tick++) {
      state = step(state, [tick === 0 ? punch('P1') : neutral('P1'), neutral('P2'), neutral('P3')]);
    }
    expect(state.fighters.find(fighter => fighter.id === 'P1')!.frags).toBe(20);
    expect(state.phase).toBe('results');
    expect(matchEnded(state)).toMatchObject({ reason: 'frag-limit', winner: 'P1' });
  });

  it('breaks a timeout on frags, then fewest deaths, then damage dealt, then draws', () => {
    const timeout = (overrides: (state: GameState) => void): GameState => {
      const state = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
      state.remainingTicks = 1;
      state.fighters[0].frags = 3;
      state.fighters[1].frags = 3;
      state.fighters[0].deaths = 1;
      state.fighters[1].deaths = 1;
      state.fighters[0].damageDealt = 40;
      state.fighters[1].damageDealt = 40;
      overrides(state);
      return step(state, []);
    };

    const frags = timeout(state => { state.fighters[1].frags = 4; });
    expect(matchEnded(frags)).toMatchObject({ reason: 'time', winner: 'P2' });

    const deaths = timeout(state => { state.fighters[0].deaths = 2; });
    expect(matchEnded(deaths)).toMatchObject({ reason: 'time', winner: 'P2' });

    const damage = timeout(state => { state.fighters[0].damageDealt = 60; });
    expect(matchEnded(damage)).toMatchObject({ reason: 'time', winner: 'P1' });

    const draw = timeout(() => undefined);
    expect(matchEnded(draw)).toMatchObject({ reason: 'time', winner: null });
  });

  it('replays a scripted fixture with pinned state and ordered-event hashes', () => {
    const fixture = deathmatchFixture();
    const first = runFixture(fixture.initial, fixture.frames);
    const restored = JSON.parse(JSON.stringify(fixture.initial)) as GameState;
    const second = runFixture(restored, fixture.frames);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(first.state.phase).toBe('results');
    expect(first.events.map(event => [event.tick, event.type, event.reason ?? null, event.winner ?? null])).toEqual([
      [5, 'HitLanded', null, null],
      [5, 'Knockout', null, null],
      [185, 'Respawned', null, null],
      [186, 'MatchEnded', 'time', 'P1'],
    ]);
    expect(hash(first.state)).toBe(DEATHMATCH_FINAL_STATE_SHA256);
    expect(hash(first.events)).toBe(DEATHMATCH_ORDERED_EVENTS_SHA256);
  });
});
