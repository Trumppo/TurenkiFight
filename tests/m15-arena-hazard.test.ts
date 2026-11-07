import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { KO_HIT_STOP_TICKS, MATCH_TICKS, MOVES, createState, step } from '../src/game/simulation/step';
import {
  ARENA_RULES, hazardActiveStart, hazardWarningStart, isInsideHazardBand, type ArenaHazard,
} from '../src/game/simulation/arenas';
import { ZONE_DAMAGE_HP, zoneRangeAt } from '../src/game/simulation/zone';
import { decodeStateSnapshot, encodeStateSnapshot, parseStateSnapshot } from '../src/game/protocol/stateSnapshot';
import { SCORE_BRAWL_FIGHTING_BYTES } from './fixtures/scoreBrawlSnapshotBytes';
import type { ArenaId, GameEvent, GameState, PlayerInput } from '../src/game/simulation/types';

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const HAZARD = ARENA_RULES.kkauppa.hazard as ArenaHazard;
const WARNING_START = hazardWarningStart(HAZARD); // 2400
const ACTIVE_START = hazardActiveStart(HAZARD);   // 2580

function place(state: GameState, positions: Record<string, { x?: number; y?: number; health?: number }>): GameState {
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

function fighting(arena?: ArenaId, tick = 2579, mode?: GameState['mode']): GameState {
  const state = createState({
    ids: ['P1', 'P2'],
    phase: 'fighting',
    ...(arena ? { arena } : {}),
    ...(mode ? { mode } : {}),
  });
  state.tick = tick;
  return state;
}

describe('M15 arena id in the simulation state', () => {
  it('stores only non-default arenas and keeps the station canonical', () => {
    expect(createState().arena).toBeUndefined();
    expect(createState({ ids: ['P1', 'P2'], phase: 'fighting' }).arena).toBeUndefined();
    expect(createState({ arena: 'mesku' }).arena).toBe('mesku');
    expect(createState({ arena: 'kkauppa' }).arena).toBe('kkauppa');
    expect(createState(['P1', 'P2'], 'fighting', { arena: 'kkauppa' }).arena).toBe('kkauppa');
    expect(() => createState({ arena: 'not-real' as never })).toThrow(/Unknown arena id/);
    // The id survives a tick, so every client simulates from the same value.
    expect(step(createState({ arena: 'kkauppa' }), []).arena).toBe('kkauppa');
  });
});

describe('M15 K-kauppa shelf hazard cycle', () => {
  it('starts damaging on the first active tick and not during the warning', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 183 },
    });
    const afterWarning = run(state, 1).state;
    expect(afterWarning.tick).toBe(ACTIVE_START);
    expect(afterWarning.fighters.map(fighter => fighter.health)).toEqual([99, 100]);
  });

  it('deals nothing across the whole warning window', () => {
    const state = place(fighting('kkauppa', WARNING_START - 1), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 183 },
    });
    const after = run(state, ACTIVE_START - WARNING_START).state; // 2400..2579
    expect(after.tick).toBe(ACTIVE_START - 1);
    expect(after.fighters.map(fighter => fighter.health)).toEqual([100, 100]);
  });

  it('deals exactly 20 damage over the 120-tick active window and stops after it', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 183 },
    });
    const active = run(state, HAZARD.activeTicks).state; // 2580..2699
    expect(active.tick).toBe(ACTIVE_START + HAZARD.activeTicks - 1);
    expect(active.fighters.map(fighter => fighter.health)).toEqual([80, 100]);

    const calm = run(active, 100).state; // 2700..2799
    expect(calm.tick).toBe(ACTIVE_START + HAZARD.activeTicks + 99);
    expect(calm.fighters.map(fighter => fighter.health)).toEqual([80, 100]);
  });

  it('never damages during countdown, lobby or results', () => {
    for (const phase of ['countdown', 'lobby', 'results'] as const) {
      const state = place({ ...createState({ ids: ['P1', 'P2'], phase, arena: 'kkauppa' }), tick: 2579 }, {
        P1: { x: 192, y: 140 },
      });
      const after = run(state, 10).state;
      expect(after.phase).toBe(phase);
      expect(after.fighters[0].health).toBe(100);
    }
  });

  it('never damages on the station or in Mesku, whose rules are hazard-free', () => {
    for (const arena of [undefined, 'mesku'] as const) {
      const state = place(fighting(arena, ACTIVE_START - 1), {
        P1: { x: 192, y: 140 },
        P2: { x: 192, y: 183 },
      });
      const after = run(state, HAZARD.activeTicks).state;
      expect(after.fighters.map(fighter => fighter.health)).toEqual([100, 100]);
    }
  });

  it('runs Mesku identically to the station; only the arena id is added', () => {
    const fixture = () => place(fighting(undefined, 2479), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 183 },
    });
    const station = run(fixture(), 400).state;
    const mesku = run({ ...fixture(), arena: 'mesku' }, 400).state;
    const { arena: _arena, ...meskuWithoutId } = mesku;
    expect(_arena).toBe('mesku');
    expect(meskuWithoutId).toEqual(station);
    // The Mesku wire bytes are the station bytes plus the explicit id.
    expect(encodeStateSnapshot({ version: 1, state: mesku }).replace('"arena":"mesku",', ''))
      .toBe(encodeStateSnapshot({ version: 1, state: station }));
  });
});

describe('M15 K-kauppa hazard damage and knockout attribution', () => {
  it('credits no attacker, records a Deathmatch death and emits no rogue event', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1, 'deathmatch'), {
      P1: { x: 192, y: 140, health: 1 },
      P2: { x: 192, y: 183 },
    });
    const next = step(state, []);
    const victim = next.fighters[0];
    expect(next.tick).toBe(ACTIVE_START);
    expect(victim.health).toBe(0);
    expect(victim.koTimer).toBe(180);
    expect(victim.deaths).toBe(1);
    expect(victim.frags).toBe(0);
    expect(victim.koCount).toBe(0);
    expect(victim.hitsReceived).toBe(0);
    expect(next.fighters[1].frags).toBe(0);
    expect(next.fighters[1].deaths).toBe(0);
    // A knockout reads: the hazard extends the freeze to the KO length.
    expect(next.hitStopTicks).toBe(KO_HIT_STOP_TICKS);
    // The hazard is not a player; state carries the death, not a bogus event.
    expect(next.events).toEqual([]);
    expect(() => encodeStateSnapshot({ version: 1, state: next })).not.toThrow();
  });

  it('keeps Score Brawl score untouched on a hazard knockout', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1), {
      P1: { x: 192, y: 140, health: 1 },
      P2: { x: 192, y: 183 },
    });
    const next = step(state, []);
    const victim = next.fighters[0];
    expect(victim.health).toBe(0);
    expect(victim.koTimer).toBe(180);
    expect(victim.score).toBe(0);
    expect(victim.koCount).toBe(0);
    expect('deaths' in victim).toBe(false);
    expect(next.events).toEqual([]);
  });

  it('ends a Last Man Standing match through the existing knockout transition', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1, 'last-man-standing'), {
      P1: { x: 192, y: 140, health: 1 },
      P2: { x: 192, y: 183 },
    });
    const next = step(state, []);
    expect(next.fighters[0].health).toBe(0);
    expect(next.fighters[0].eliminated).toBe(true);
    expect(next.phase).toBe('results');
    expect(next.events).toEqual([{ tick: ACTIVE_START, type: 'MatchEnded', reason: 'elimination', winner: 'P2' }]);
  });

  it('eliminates a wave enemy without crediting the player', () => {
    const state = place(createState({
      ids: ['P1', 'P2'], phase: 'fighting', mode: 'wave', arena: 'kkauppa',
      teams: { P1: 'players', P2: 'enemies' },
    }), {
      P1: { x: 192, y: 183 },
      P2: { x: 192, y: 140, health: 1 },
    });
    state.tick = ACTIVE_START - 1;
    state.remainingTicks = MATCH_TICKS;
    const next = step(state, []);
    expect(next.fighters[1].eliminated).toBe(true);
    expect(next.fighters[1].health).toBe(0);
    expect(next.fighters[0].score).toBe(0);
    expect(next.fighters[0].koCount).toBe(0);
    expect(next.wave?.remaining).toBe(0);
    expect(next.wave?.index).toBe(1);
    expect(next.wave?.countdownTicks).toBe(120);
    expect(next.events).toEqual([]);
  });

  it('knocks out every fighter in the band on the same tick, each as its own death', () => {
    const state = place(createState({
      ids: ['P1', 'P2', 'P3'], phase: 'fighting', mode: 'deathmatch', arena: 'kkauppa',
    }), {
      P1: { x: 192, y: 140, health: 1 },
      P2: { x: 250, y: 183, health: 1 },
      P3: { x: 300, y: 124, health: 1 },
    });
    state.tick = ACTIVE_START - 1;
    const next = step(state, []);
    expect(next.fighters.map(fighter => [fighter.health, fighter.koTimer, fighter.deaths, fighter.frags]))
      .toEqual([[0, 180, 1, 0], [1, 0, 0, 0], [0, 180, 1, 0]]);
    expect(next.events).toEqual([]);
  });

  it('blocks damage during respawn protection like a combat hit', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 140 },
    });
    state.fighters[0].protection = 5;
    // Ticks 2580..2586: P1 is protected through 2585, P2 is not.
    const next = run(state, 7).state;
    expect(next.tick).toBe(ACTIVE_START + 6);
    expect(next.fighters.map(fighter => fighter.health)).toEqual([99, 98]);
  });

  it('does not freeze the fight on ordinary hazard damage', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 183 },
    });
    const next = step(state, []);
    expect(next.fighters[0].health).toBe(99);
    expect(next.hitStopTicks).toBeUndefined();
  });

  it('treats both band edges as dangerous and just outside as safe', () => {
    const state = place(fighting('kkauppa', ACTIVE_START - 1), {
      P1: { x: 192, y: HAZARD.band.minY },
      P2: { x: 192, y: HAZARD.band.maxY + 0.001 },
    });
    const next = step(state, []);
    expect(isInsideHazardBand(HAZARD.band.minY, HAZARD.band)).toBe(true);
    expect(next.fighters.map(fighter => fighter.health)).toEqual([99, 100]);
  });
});

describe('M15 hazard ordering against combat and the Deathmatch zone', () => {
  it('gives a same-tick combat knockout to the attacker and never double-counts the death', () => {
    // ACTIVE_START is both the first shelf damage tick and the tick the punch
    // lands. P1 is in the band at 1 HP, so the hazard would also kill P1 after
    // combat; the frag is credited before the hazard stage and must survive.
    const state = place(fighting('kkauppa', ACTIVE_START - 1, 'deathmatch'), {
      P1: { x: 100, y: 140, health: 1 },
      P2: { x: 120, y: 140, health: 10 },
    });
    state.fighters[0].facing = 1;
    state.fighters[0].attackMove = 'punch';
    state.fighters[0].attackFrames = MOVES.punch.active + MOVES.punch.recovery + 1;

    const next = step(state, []);
    expect(next.events.filter(event => event.type === 'Knockout'))
      .toEqual([{ tick: ACTIVE_START, type: 'Knockout', attacker: 'P1', target: 'P2' }]);
    expect(next.fighters.map(fighter => [fighter.health, fighter.frags, fighter.deaths, fighter.koTimer]))
      .toEqual([[0, 1, 1, 180], [0, 0, 1, 180]]);
    expect(next.hitStopTicks).toBe(KO_HIT_STOP_TICKS);
  });

  it('lets the zone own a shared lethal tick and adds the hazard when the zone is not lethal', () => {
    // Tick 2580 is a zone damage tick in stage 2 (x outside 37.12..346.88) and
    // the first shelf tick (y inside 124..156).
    expect(zoneRangeAt(ACTIVE_START).minX).toBeGreaterThan(20);
    expect(20).toBeLessThan(zoneRangeAt(ACTIVE_START).minX);

    const lethal = place(fighting('kkauppa', ACTIVE_START - 1, 'deathmatch'), {
      P1: { x: 20, y: 140, health: 1 },
      P2: { x: 192, y: 140, health: 50 },
    });
    const next = step(lethal, []);
    // P1: the zone knocks out first, the hazard skips the KO'd fighter.
    expect(next.fighters[0].health).toBe(0);
    expect(next.fighters[0].koTimer).toBe(180);
    expect(next.fighters[0].deaths).toBe(1);
    // P2: inside the zone, inside the band, so only the hazard hurts.
    expect(next.fighters[1].health).toBe(50 - HAZARD.damagePerTick);
    expect(next.fighters[1].deaths).toBe(0);
    expect(next.events).toEqual([]);

    const additive = place(fighting('kkauppa', ACTIVE_START - 1, 'deathmatch'), {
      P1: { x: 20, y: 140, health: 50 },
      P2: { x: 192, y: 183 },
    });
    const both = step(additive, []);
    expect(both.fighters[0].health).toBe(50 - ZONE_DAMAGE_HP - HAZARD.damagePerTick);
    expect(both.fighters[0].deaths).toBe(0);
  });
});

describe('M15 arena snapshot wire shape', () => {
  it('keeps station bytes identical and omits the arena field', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    const encoded = encodeStateSnapshot({ version: 1, state });
    expect(encoded).toBe(SCORE_BRAWL_FIGHTING_BYTES);
    expect(encoded).not.toContain('"arena"');
    // An explicit undefined key is not canonical wire data; the encoder omits it.
    expect(encodeStateSnapshot({ version: 1, state: { ...state, arena: undefined } })).toBe(SCORE_BRAWL_FIGHTING_BYTES);
  });

  it('round-trips known arena ids and measures the wire cost', () => {
    const station = encodeStateSnapshot({ version: 1, state: createState(['P1', 'P2'], 'fighting') });
    for (const arena of ['kkauppa', 'mesku'] as const) {
      const state = createState({ ids: ['P1', 'P2'], phase: 'fighting', arena });
      const encoded = encodeStateSnapshot({ version: 1, state });
      expect(encoded).toContain(`"arena":"${arena}"`);
      expect(decodeStateSnapshot(encoded)).toEqual({ version: 1, state });
      // Inserting only the field reproduces the station bytes exactly.
      expect(encoded.replace(`"arena":"${arena}",`, '')).toBe(station);
    }
    // Measured: `"arena":"kkauppa",` adds exactly 18 UTF-8 bytes per snapshot.
    const shop = encodeStateSnapshot({
      version: 1,
      state: createState({ ids: ['P1', 'P2'], phase: 'fighting', arena: 'kkauppa' }),
    });
    expect(byteLength(shop) - byteLength(station)).toBe(18);
  });

  it('rejects the default, unknown and malformed arena values', () => {
    const base = createState({ ids: ['P1', 'P2'], phase: 'fighting', arena: 'kkauppa' });
    for (const arena of ['station', 'KKAUPPA', 'mesku ', '', null, 42, true, ['kkauppa']]) {
      expect(() => parseStateSnapshot({ version: 1, state: { ...base, arena } })).toThrow(/Malformed/);
    }
  });
});

describe('M15 arena determinism and pins', () => {
  const STATION_STATE_SHA256 = 'ca0f154d0a75b8e611ed63e6fe24a20756454f683e96c691be24ea50617ce51f';
  const STATION_EVENTS_SHA256 = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
  const KKAUPPA_STATE_SHA256 = '5b2a6080defca0c444effd7a84a1593476bfd15e5c93bd75ef1e5631a7610c78';
  const KKAUPPA_EVENTS_SHA256 = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

  /**
   * Crosses one full cycle from just before the first active tick: P1 stands in
   * the shelf band, P2 outside it. 300 ticks end before the first bottle spawn
   * at tick 3000, so the state shape stays comparable.
   */
  function fixture(arena?: ArenaId): GameState {
    const state = place(fighting(arena, ACTIVE_START - 1), {
      P1: { x: 192, y: 140 },
      P2: { x: 192, y: 183 },
    });
    state.remainingTicks = MATCH_TICKS;
    return state;
  }

  it('replays identically from a JSON round-trip and the wire codec in the K-kauppa arena', () => {
    const first = run(fixture('kkauppa'), 300);
    const restored = JSON.parse(JSON.stringify(fixture('kkauppa'))) as GameState;
    const second = run(restored, 300);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    // The arena id survives the canonical codec, so a remote client steps the
    // same hazard timeline from the snapshot alone.
    const decoded = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: fixture('kkauppa') })).state;
    expect(decoded.arena).toBe('kkauppa');
    expect(run(decoded, 300).state).toEqual(first.state);
    expect(first.state.tick).toBe(ACTIVE_START + 299);
    expect(first.state.fighters.map(fighter => fighter.health)).toEqual([80, 100]);
    expect(Object.keys(first.state).sort())
      .toEqual(['arena', 'countdownTicks', 'events', 'fighters', 'phase', 'remainingTicks', 'tick']);
  });

  // Independently recorded SHA-256 pins. The station run is the unchanged
  // pre-hazard behaviour (P1 keeps 100 HP); the K-kauppa run applies the shelf
  // hazard (P1 loses 20 HP) and is the new pin for this slice.
  it('pins the station fixture, which the arena rules do not change', () => {
    const result = run(fixture(), 300);
    expect(result.state.fighters.map(fighter => fighter.health)).toEqual([100, 100]);
    expect(Object.keys(result.state).sort())
      .toEqual(['countdownTicks', 'events', 'fighters', 'phase', 'remainingTicks', 'tick']);
    expect({ state: hash(result.state), events: hash(result.events) })
      .toEqual({ state: STATION_STATE_SHA256, events: STATION_EVENTS_SHA256 });
  });

  it('pins the new K-kauppa fixture', () => {
    const result = run(fixture('kkauppa'), 300);
    expect({ state: hash(result.state), events: hash(result.events) })
      .toEqual({ state: KKAUPPA_STATE_SHA256, events: KKAUPPA_EVENTS_SHA256 });
  });
});
