import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MATCH_TICKS, MOVES, createState, step } from '../src/game/simulation/step';
import { MODE_RULES, compareTieBreak, modeWinner } from '../src/game/simulation/modes';
import { rankMatch } from '../src/game/simulation/ranking';
import { ARENA_MIN_X, ZONE_STAGES, zoneRangeAt, zoneStageAt } from '../src/game/simulation/zone';
import { encodeStateSnapshot } from '../src/game/protocol/stateSnapshot';
import type { GameEvent, GameState, PlayerInput } from '../src/game/simulation/types';

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function deathmatch(ids: string[], tick: number): GameState {
  const state = createState({ ids, phase: 'fighting', mode: 'deathmatch' });
  state.tick = tick;
  return state;
}

function place(state: GameState, positions: Record<string, { x: number; y: number; health?: number }>): GameState {
  return {
    ...state,
    fighters: state.fighters.map(fighter => positions[fighter.id]
      ? { ...fighter, ...positions[fighter.id] }
      : fighter),
  };
}

function run(state: GameState, ticks: number, inputs: (tick: number) => PlayerInput[] = () => []):
  { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (let index = 0; index < ticks; index++) {
    current = step(current, inputs(index));
    events.push(...current.events);
  }
  return { state: current, events };
}

describe('M10 Deathmatch outside damage', () => {
  it('removes exactly 1 HP per six ticks outside and nothing inside', () => {
    // Tick 1080 starts stage 1 (safe range 37.12..346.88).
    let state = place(deathmatch(['P1', 'P2'], 1074), {
      P1: { x: 20, y: 150 },
      P2: { x: 192, y: 150 },
    });
    state = run(state, 6).state; // ticks 1075..1080, damage on 1080 only
    expect(state.tick).toBe(1080);
    expect(state.fighters.map(fighter => fighter.health)).toEqual([99, 100]);

    state = run(state, 6).state; // ticks 1081..1086, damage on 1086 only
    expect(state.tick).toBe(1086);
    expect(state.fighters.map(fighter => fighter.health)).toEqual([98, 100]);
  });

  it('never damages inside the stage-0 full arena', () => {
    const state = place(deathmatch(['P1', 'P2'], 0), { P1: { x: 20, y: 150 } });
    const after = run(state, 60).state;
    expect(after.tick).toBe(60);
    expect(after.fighters.map(fighter => fighter.health)).toEqual([100, 100]);
  });

  it('does not damage during countdown, during results, or outside Deathmatch', () => {
    const countdown = place(createState({ ids: ['P1', 'P2'], phase: 'countdown', mode: 'deathmatch' }), {
      P1: { x: ARENA_MIN_X, y: 150 },
    });
    countdown.tick = 1074;
    const duringCountdown = run(countdown, 20).state;
    expect(duringCountdown.phase).toBe('countdown');
    expect(duringCountdown.fighters[0].health).toBe(100);

    const results = place(createState({ ids: ['P1', 'P2'], phase: 'results', mode: 'deathmatch' }), {
      P1: { x: ARENA_MIN_X, y: 150 },
    });
    results.tick = 1074;
    expect(run(results, 20).state.fighters[0].health).toBe(100);

    for (const mode of ['score-brawl', 'last-man-standing'] as const) {
      const other = place(createState({ ids: ['P1', 'P2'], phase: 'fighting', mode }), {
        P1: { x: ARENA_MIN_X, y: 150 },
      });
      other.tick = 1074;
      const after = run(other, 20).state;
      expect(after.tick).toBe(1094);
      expect(after.fighters[0].health).toBe(100);
    }
  });
});

describe('M10 Deathmatch zone knockout', () => {
  it('counts a death with no frag, no KO credit and no rogue wire event at every stage', () => {
    for (let stage = 1; stage < ZONE_STAGES.length; stage++) {
      const boundary = ZONE_STAGES[stage].startTick;
      const state = place(deathmatch(['P1', 'P2'], boundary - 1), {
        P1: { x: ARENA_MIN_X, y: 150, health: 1 },
        P2: { x: 192, y: 150 },
      });
      expect(zoneStageAt(boundary)).toBe(stage);
      const next = step(state, []);

      const victim = next.fighters[0];
      const bystander = next.fighters[1];
      expect(next.tick).toBe(boundary);
      expect(victim.health).toBe(0);
      expect(victim.koTimer).toBe(180);
      expect(victim.deaths).toBe(1);
      expect(victim.frags).toBe(0);
      expect(victim.koCount).toBe(0);
      expect(bystander.frags).toBe(0);
      expect(bystander.deaths).toBe(0);
      // The zone changes how frags are earned, not how the match ends.
      expect(next.phase).toBe('fighting');
      // The zone is not a player. The wire `Knockout` schema requires a roster
      // attacker, so the death is carried by state instead of a malformed event.
      expect(next.events).toEqual([]);
      expect(() => encodeStateSnapshot({ version: 1, state: next })).not.toThrow();
    }
  });

  it('respawns inside the current safe range at every stage with the existing y pattern', () => {
    for (let stage = 0; stage < ZONE_STAGES.length; stage++) {
      const tick = ZONE_STAGES[stage].startTick + 11;
      const state = place(deathmatch(['P1', 'P2'], tick), {
        P1: { x: ARENA_MIN_X, y: 150, health: 0 },
        P2: { x: 192, y: 183 },
      });
      state.fighters[0].koTimer = 1;
      const next = step(state, []);
      const range = zoneRangeAt(next.tick);
      const respawned = next.fighters[0];

      expect(next.tick).toBe(tick + 1);
      expect(next.events).toContainEqual({ tick: tick + 1, type: 'Respawned', target: 'P1' });
      expect(respawned.x).toBeGreaterThanOrEqual(range.minX);
      expect(respawned.x).toBeLessThanOrEqual(range.maxX);
      expect(respawned.y).toBe(148);
      expect(respawned.health).toBe(100);
    }
  });

  it('keeps every eight-fighter respawn inside the narrowest stage', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const tick = ZONE_STAGES[ZONE_STAGES.length - 1].startTick + 30;
    const state = deathmatch(ids, tick);
    state.fighters[0].koTimer = 1;
    state.fighters[0].health = 0;
    state.fighters[0].x = ARENA_MIN_X;
    const next = step(state, []);
    const range = zoneRangeAt(next.tick);
    expect(next.fighters[0].x).toBeGreaterThanOrEqual(range.minX);
    expect(next.fighters[0].x).toBeLessThanOrEqual(range.maxX);
  });
});

describe('M10 combat and zone knockout ordering', () => {
  it('gives a same-tick knockout to the attacker, not also to the zone', () => {
    // Tick 1080 is both the stage-1 shrink and a zone damage tick. Both fighters
    // start outside the new range; P2 would die to the zone, but combat resolves
    // first and its knockout is attributed to P1.
    const attacking = (x: number): GameState => {
      const state = place(deathmatch(['P1', 'P2'], 1079), {
        P1: { x, y: 150 },
        P2: { x: x + 20, y: 150, health: 10 },
      });
      state.fighters[0].facing = 1;
      state.fighters[0].attackMove = 'punch';
      state.fighters[0].attackFrames = MOVES.punch.active + MOVES.punch.recovery + 1;
      return state;
    };

    const next = step(attacking(0), []);
    expect(next.tick).toBe(1080);
    expect(next.events.map(event => [event.type, event.attacker ?? null, event.target ?? null]).filter(event => event[0] !== 'HitLanded'))
      .toEqual([['Knockout', 'P1', 'P2']]);
    expect(next.fighters[0].frags).toBe(1);
    expect(next.fighters[0].koCount).toBe(1);
    expect(next.fighters[1].deaths).toBe(1);
    expect(next.fighters[1].koTimer).toBe(180);
    // The attacker is still standing but outside, so the zone now hurts it.
    expect(next.fighters[0].health).toBe(99);
  });

  it('does not revoke a frag credited on the tick the zone knocks the attacker out', () => {
    const state = place(deathmatch(['P1', 'P2'], 1079), {
      P1: { x: 0, y: 150, health: 1 },
      P2: { x: 20, y: 150, health: 10 },
    });
    state.fighters[0].facing = 1;
    state.fighters[0].attackMove = 'punch';
    state.fighters[0].attackFrames = MOVES.punch.active + MOVES.punch.recovery + 1;

    const next = step(state, []);
    expect(next.events.filter(event => event.type === 'Knockout'))
      .toEqual([{ tick: 1080, type: 'Knockout', attacker: 'P1', target: 'P2' }]);
    expect(next.fighters.map(fighter => [fighter.frags, fighter.deaths, fighter.koTimer]))
      .toEqual([[1, 1, 180], [0, 1, 180]]);
  });
});

function zoneFixture(): { initial: GameState; inputs: PlayerInput[][] } {
  const initial = place(deathmatch(['P1', 'P2', 'P3'], 0), {
    P1: { x: 192, y: 148 },
    // Inside the full arena at stage 0, outside from tick 1080; five damage
    // ticks later it is knocked out by the zone and respawns at tick 1284.
    P2: { x: ARENA_MIN_X, y: 150, health: 5 },
    // Outside from tick 1080 and survives the remaining run.
    P3: { x: 350, y: 183 },
  });
  initial.remainingTicks = MATCH_TICKS;
  const inputs = Array.from({ length: 1400 }, () => [neutral('P1'), neutral('P2'), neutral('P3')]);
  return { initial, inputs };
}

// Independently recorded SHA-256 fingerprints for the zone fixture below.
const ZONE_FINAL_STATE_SHA256 = 'a4e86adcfc278fa61599d99b056b118ecedb0d54fe891380e1d44c533b6dcd4b';
const ZONE_ORDERED_EVENTS_SHA256 = '847a1ca645e6d2bc8f1ba32a12b96b716e89994ad4abbd666673072c5b3d79aa';

describe('M10 Deathmatch zone determinism and ranking', () => {
  it('replays identically, stays encodable and still ranks with rankMatch', () => {
    const fixture = zoneFixture();
    const first = run(fixture.initial, fixture.inputs.length, tick => fixture.inputs[tick]);
    const restored = JSON.parse(JSON.stringify(fixture.initial)) as GameState;
    const second = run(restored, fixture.inputs.length, tick => fixture.inputs[tick]);

    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(hash(first.state)).toBe(hash(second.state));
    expect(hash(first.events)).toBe(hash(second.events));

    // The fixture crosses the first shrink, the zone KO and the clamped respawn.
    expect(first.state.tick).toBe(1400);
    expect(first.events.map(event => [event.tick, event.type, event.target ?? null]))
      .toEqual([[1284, 'Respawned', 'P2']]);
    expect(first.state.fighters.map(fighter => [fighter.id, fighter.health, fighter.deaths, fighter.koTimer]))
      .toEqual([['P1', 100, 0, 0], ['P2', 100, 1, 0], ['P3', 46, 0, 0]]);
    expect(first.state.phase).toBe('fighting');
    expect(first.state.fighters[1].x).toBeGreaterThanOrEqual(zoneRangeAt(1400).minX);
    expect(first.state.fighters[1].x).toBeLessThanOrEqual(zoneRangeAt(1400).maxX);

    // No new snapshot field and no malformed event: the zone state round-trips
    // through the unchanged protocol codec.
    expect(Object.keys(first.state).sort())
      .toEqual(['events', 'fighters', 'mode', 'phase', 'remainingTicks', 'tick', 'countdownTicks'].sort());
    expect(() => encodeStateSnapshot({ version: 1, state: first.state })).not.toThrow();

    // Deathmatch ranking is unchanged in rules and still matches rankMatch.
    const ranking = rankMatch(first.state, first.events);
    const byId = new Map(first.state.fighters.map(fighter => [fighter.id, fighter]));
    expect(ranking.mode).toBe('deathmatch');
    expect(ranking.order.map(entry => entry.id)).toEqual(['P1', 'P3', 'P2']);
    for (let index = 1; index < ranking.order.length; index++) {
      const better = byId.get(ranking.order[index - 1].id)!;
      const worse = byId.get(ranking.order[index].id)!;
      expect(compareTieBreak(better, worse, MODE_RULES.deathmatch)).toBeGreaterThanOrEqual(0);
    }
    expect(ranking.winners).toEqual(ranking.order.filter(entry => entry.rank === 1).map(entry => entry.id));
    const winner = modeWinner(first.state.fighters, MODE_RULES.deathmatch);
    if (winner === null) expect(ranking.draw).toBe(true);
    else expect(ranking.winners).toEqual([winner]);
    expect(MODE_RULES.deathmatch.fragLimit).toBe(20);
    expect(MODE_RULES.deathmatch.timerTicks).toBe(MATCH_TICKS);
  });

  // Independently recorded SHA-256 fingerprints for the zone fixture above.
  it('pins the zone fixture state and ordered-event hashes', () => {
    const fixture = zoneFixture();
    const result = run(fixture.initial, fixture.inputs.length, tick => fixture.inputs[tick]);
    expect({ state: hash(result.state), events: hash(result.events) })
      .toEqual({ state: ZONE_FINAL_STATE_SHA256, events: ZONE_ORDERED_EVENTS_SHA256 });
  });
});

