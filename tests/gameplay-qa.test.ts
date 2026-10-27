import { describe, expect, it } from 'vitest';
import { createState, step, standings, COUNTDOWN_TICKS, MATCH_TICKS, MOVES, TICK_RATE } from '../src/game/simulation/step';
import type { GameState, PlayerInput } from '../src/game/simulation/types';

const neutral = (id: string): PlayerInput => ({ playerId: id, moveX: 0, moveY: 0, jump: false });
const attack = (id: string, move: 'punch' | 'kick' | 'jumpkick'): PlayerInput => ({ ...neutral(id), [move]: true });
const fighting = (ids = ['P1', 'P2']) => createState(ids, 'fighting');

describe('M1 gameplay QA', () => {
  it('is pure, reproducible and presentation independent for eight fighters', () => {
    const initial = fighting(Array.from({ length: 8 }, (_, i) => `P${i + 1}`));
    const original = JSON.stringify(initial);
    const frames = Array.from({ length: 500 }, (_, t) =>
      initial.fighters.map((f, i) => ({ ...neutral(f.id), moveX: (t % 120 < 60 ? 1 : -1) as -1 | 1,
        punch: t % 37 === i, jump: t % 71 === i })));
    const replay = () => {
      let state = initial;
      const events: string[] = [];
      for (const frame of frames) {
        state = step(state, frame);
        events.push(JSON.stringify(state.events));
      }
      return JSON.stringify({ state, events });
    };
    expect(replay()).toBe(replay());
    expect(JSON.stringify(initial)).toBe(original);
    expect(initial.fighters).toHaveLength(8);
    expect(TICK_RATE).toBe(60);
  });

  it('starts fighting on exactly countdown tick 180, then results on active tick 7200', () => {
    let s = createState();
    for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) s = step(s, []);
    expect(s.phase).toBe('countdown');
    expect(s.remainingTicks).toBe(MATCH_TICKS);
    s = step(s, []);
    expect(s.phase).toBe('fighting');
    expect(s.events.map(e => e.type)).toEqual(['MatchStarted']);
    for (let i = 0; i < MATCH_TICKS - 1; i++) s = step(s, []);
    expect(s.remainingTicks).toBe(1);
    expect(s.phase).toBe('fighting');
    s = step(s, []);
    expect(s.phase).toBe('results');
    expect(s.remainingTicks).toBe(0);
    expect(s.events.map(e => e.type)).toEqual(['MatchEnded']);
    const frozen = step(s, [attack('P1', 'punch')]);
    expect(frozen.remainingTicks).toBe(0);
    expect(frozen.events).toEqual([]);
    expect(frozen.fighters).toEqual(s.fighters);
  });

  it('credits simultaneous mutual KO from the same pre-resolution hit snapshot', () => {
    const s = fighting();
    const [a, b] = s.fighters;
    a.x = 170; a.y = 160; a.facing = 1; a.health = 10;
    b.x = 192; b.y = 160; b.facing = -1; b.health = 10;
    for (const f of s.fighters) {
      f.attackMove = 'punch';
      f.attackFrames = MOVES.punch.active + MOVES.punch.recovery + 1;
    }
    const next = step(s, []);
    expect(next.fighters.map(f => f.koTimer)).toEqual([180, 180]);
    expect(next.fighters.map(f => f.koCount)).toEqual([1, 1]);
    expect(next.fighters.map(f => f.score)).toEqual([400, 400]);
    expect(next.events.map(e => e.type)).toEqual(['HitLanded', 'Knockout', 'HitLanded', 'Knockout']);
    expect(s.fighters[0].health).toBe(10);
  });

  it('awards a single KO credit when two simultaneous hits finish the same target', () => {
    const s = fighting(['P1', 'P2', 'P3']);
    const [a, b, target] = s.fighters;
    a.x = 140; a.y = 160; a.facing = 1;
    b.x = 145; b.y = 160; b.facing = 1;
    target.x = 170; target.y = 160; target.health = 10;
    for (const f of [a, b]) {
      f.attackMove = 'punch';
      f.attackFrames = MOVES.punch.active + MOVES.punch.recovery + 1;
    }
    const next = step(s, []);
    expect(next.events.filter(e => e.type === 'Knockout')).toHaveLength(1);
    expect(next.fighters[2].score).toBe(-200);
    expect(next.fighters[0].koCount + next.fighters[1].koCount).toBe(1);
  });

  it('respawns after 180 ticks and protects for 90 ticks, canceled on attack', () => {
    let s = fighting();
    s.fighters[0].koTimer = 180; s.fighters[0].health = 0;
    for (let i = 0; i < 179; i++) s = step(s, []);
    expect(s.fighters[0].health).toBe(0);
    s = step(s, []);
    expect(s.fighters[0].health).toBe(100);
    expect(s.fighters[0].protection).toBe(90);
    expect(s.events.map(e => e.type)).toEqual(['Respawned']);
    s = step(s, [attack('P1', 'punch')]);
    expect(s.fighters[0].protection).toBe(0);
    expect(s.fighters[0].attackMove).toBe('punch');
  });

  it('does not retrigger held punch, and neutral input permits a fresh press', () => {
    let s = fighting();
    for (let i = 0; i < 100; i++) s = step(s, [attack('P1', 'punch')]);
    expect(s.fighters[0].attackMove).toBeNull();
    s = step(s, [neutral('P1')]);
    s = step(s, [attack('P1', 'punch')]);
    expect(s.fighters[0].attackMove).toBe('punch');
  });

  it('sorts ties by KO then received hits and shares exact ties', () => {
    const s = fighting(['P3', 'P2', 'P1']);
    expect(standings(s).map(x => x.rank)).toEqual([1, 1, 1]);
    s.fighters[0].koCount = 1;
    s.fighters[1].hitsReceived = 2;
    expect(standings(s).map(x => x.id)).toEqual(['P3', 'P1', 'P2']);
  });
});
