import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  HELD_OBJECT_Z, MOVES, OBJECT_PICKUP_REACH_X, OBJECT_PICKUP_REACH_Y,
  OBJECT_SPAWN_TABLE, THROW_HIT_RADIUS,
  THROW_SPEED_X, THROW_START_VZ, THROW_START_Z, createState, step,
} from '../src/game/simulation/step';
import type { Fighter, GameState, PlayerInput, SimObject } from '../src/game/simulation/types';
import { parseGameEvent } from '../src/game/protocol/gameEvent';
import { decodeInputFrame, encodeInputFrame, type InputFrame } from '../src/game/protocol/inputFrame';
import { stateSnapshotFingerprint } from '../src/game/protocol/fingerprint';
import { verifyReplay } from '../src/game/protocol/replay';
import {
  MAX_SNAPSHOT_OBJECTS, decodeStateSnapshot, encodeStateSnapshot, parseStateSnapshot,
} from '../src/game/protocol/stateSnapshot';

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const grab = (playerId: string): PlayerInput => ({ ...neutral(playerId), grab: true });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

function withFighter(state: GameState, id: string, patch: Partial<Fighter>): GameState {
  return { ...state, fighters: state.fighters.map(fighter => fighter.id === id ? { ...fighter, ...patch } : fighter) };
}

function withObjects(state: GameState, objects: SimObject[]): GameState {
  return { ...state, objects };
}

function run(state: GameState, ticks: number, inputs: (tick: number, current: GameState) => PlayerInput[] = () => []): GameState {
  let current = state;
  for (let tick = 0; tick < ticks; tick++) current = step(current, inputs(tick, current));
  return current;
}

function heldBy(objectId: string, holder: string, x: number, y: number): SimObject {
  return { id: objectId, kind: 'bottle', x, y, z: HELD_OBJECT_Z, state: 'held', holder };
}

function parseEnvelope(state: GameState) {
  return encodeStateSnapshot({ version: 1, state });
}

function rejectsObject(object: SimObject | Record<string, unknown>): boolean {
  try {
    parseStateSnapshot({ version: 1, state: { ...createState(['P1', 'P2'], 'fighting'), tick: 10, objects: [object] } });
    return false;
  } catch {
    return true;
  }
}

describe('M12 object spawn schedule', () => {
  it('spawns one bottle every 600 fighting ticks at the fixed table points, capped at three', () => {
    let state = createState(['P1', 'P2'], 'fighting');
    state = run(state, OBJECT_SPAWN_TABLE.intervalTicks - 1);
    expect(state.objects).toBeUndefined();

    state = step(state, []);
    expect(state.tick).toBe(600);
    expect(state.objects).toEqual([{
      id: 'O1', kind: 'bottle', x: OBJECT_SPAWN_TABLE.points[0].x, y: OBJECT_SPAWN_TABLE.points[0].y,
      z: 0, state: 'ground', spawnTick: 600,
    }]);

    state = run(state, OBJECT_SPAWN_TABLE.intervalTicks);
    expect(state.tick).toBe(1200);
    expect(state.objects?.map(object => [object.id, object.x, object.y, object.spawnTick]))
      .toEqual([['O1', 110, 190, 600], ['O2', 274, 138, 1200]]);

    state = run(state, OBJECT_SPAWN_TABLE.intervalTicks);
    expect(state.tick).toBe(1800);
    expect(state.objects).toHaveLength(OBJECT_SPAWN_TABLE.maxUnbroken);
    expect(state.objects?.at(-1)).toMatchObject({ id: 'O3', x: 192, y: 176, spawnTick: 1800 });

    state = run(state, OBJECT_SPAWN_TABLE.intervalTicks);
    expect(state.tick).toBe(2400);
    expect(state.objects).toHaveLength(OBJECT_SPAWN_TABLE.maxUnbroken);
    expect(state.objects?.some(object => object.spawnTick === 2400)).toBe(false);
  });

  it('replays the same object list byte for byte and never spawns outside fighting', () => {
    const first = run(createState(['P1', 'P2'], 'fighting'), 2000);
    const second = run(createState(['P1', 'P2'], 'fighting'), 2000);
    expect(second.objects).toEqual(first.objects);
    expect(hash(first.objects)).toBe(hash(second.objects));
    expect(parseEnvelope(second)).toBe(parseEnvelope(first));

    const countdown = run(createState(['P1', 'P2'], 'countdown'), 300);
    expect(countdown.phase).toBe('fighting');
    // 180 countdown ticks + 120 fighting ticks: the first spawn is still ahead.
    expect(countdown.objects).toBeUndefined();
    const crossed = step(countdown, []);
    expect(crossed.objects).toBeUndefined();
  });

  it('frees a spawn slot only after the bottle breaks and is cleaned up', () => {
    let state = run(createState(['P1', 'P2'], 'fighting'), 1800);
    expect(state.objects).toHaveLength(3);
    // Move P1 onto O1 and keep P2 out of the throw line.
    state = withFighter(state, 'P1', { x: OBJECT_SPAWN_TABLE.points[0].x, y: OBJECT_SPAWN_TABLE.points[0].y, facing: 1 });
    state = withFighter(state, 'P2', { x: 368, y: 134 });
    state = step(state, [grab('P1'), neutral('P2')]);
    expect(state.objects?.find(object => object.id === 'O1')?.state).toBe('held');
    state = step(state, [neutral('P1'), neutral('P2')]);
    state = step(state, [grab('P1'), neutral('P2')]);
    expect(state.objects?.find(object => object.id === 'O1')?.state).toBe('airborne');
    // The throw arcs to the ground and breaks; cleanup removes it.
    state = run(state, 24);
    expect(state.objects?.some(object => object.id === 'O1')).toBe(false);
    const beforeNextSpawn = state;
    expect(beforeNextSpawn.objects).toHaveLength(2);
    state = run(state, 2400 - state.tick);
    expect(state.tick).toBe(2400);
    expect(state.objects?.map(object => object.id)).toEqual(['O2', 'O3', 'O4']);
    expect(state.objects?.at(-1)).toMatchObject({ spawnTick: 2400, x: OBJECT_SPAWN_TABLE.points[0].x });
  });
});

describe('M12 per-tick order', () => {
  it('runs movement before pickup, spawn before pickup, and timers after objects', () => {
    // Movement first: P1 starts 19 px away from O1 (outside the 18 px reach).
    // One 1.56 px step closes the gap, so the grab succeeds only if movement
    // has already run this tick.
    let state = withObjects(createState(['P1', 'P2'], 'fighting'), [{
      id: 'O1', kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground', spawnTick: 5,
    }]);
    state = withFighter(state, 'P1', { x: 81, y: 150 });
    state = step(state, [{ ...neutral('P1'), moveX: 1, grab: true }, neutral('P2')]);
    expect(state.fighters[0].x).toBeCloseTo(82.56, 10);
    expect(state.objects?.[0]).toMatchObject({ state: 'held', holder: 'P1' });

    // Spawn before pickup: at tick 600 the new bottle appears at the table
    // point before the pickup pass, so a fighter standing there can take it on
    // the same tick.
    let spawn = run(createState(['P1', 'P2'], 'fighting'), 599);
    spawn = withFighter(spawn, 'P1', { x: OBJECT_SPAWN_TABLE.points[0].x, y: OBJECT_SPAWN_TABLE.points[0].y });
    spawn = step(spawn, [grab('P1'), neutral('P2')]);
    expect(spawn.tick).toBe(600);
    expect(spawn.remainingTicks).toBe(7200 - 600);
    expect(spawn.objects?.[0]).toMatchObject({ id: 'O1', state: 'held', holder: 'P1', spawnTick: 600 });
  });

  it('runs throw, flight and impact before cleanup in the same tick', () => {
    // P2 is 8 px ahead of the throw origin, so the first flight step is already
    // inside the hit radius. All of throw -> flight -> impact -> cleanup must
    // happen before the tick ends.
    let state = withObjects(createState(['P1', 'P2'], 'fighting'), [heldBy('O1', 'P1', 100, 150)]);
    state = withFighter(state, 'P1', { x: 100, y: 150, facing: 1 });
    state = withFighter(state, 'P2', { x: 108, y: 150, health: 100 });
    state = step(state, [grab('P1'), neutral('P2')]);
    expect(state.events.filter(event => event.type === 'HitLanded')).toEqual([
      { tick: 1, type: 'HitLanded', attacker: 'P1', target: 'P2', move: 'throw' },
    ]);
    expect(state.fighters[1].health).toBe(80);
    expect(state.objects).toBeUndefined();
  });
});

describe('M12 pickup, hold and drop', () => {
  it('picks up a ground bottle at the exact reach boundary and refuses one pixel beyond it', () => {
    const base = () => withObjects(createState(['P1', 'P2'], 'fighting'), [{
      id: 'O1', kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground', spawnTick: 5,
    }]);
    const atBoundary = step(withFighter(base(), 'P1', { x: 100 + OBJECT_PICKUP_REACH_X, y: 150 }), [grab('P1')]);
    expect(atBoundary.objects?.[0]).toMatchObject({ state: 'held', holder: 'P1', z: HELD_OBJECT_Z });

    const beyond = step(withFighter(base(), 'P1', { x: 100 + OBJECT_PICKUP_REACH_X + 1, y: 150 }), [grab('P1')]);
    expect(beyond.objects?.[0].state).toBe('ground');

    const atDepth = step(withFighter(base(), 'P1', { x: 100, y: 150 + OBJECT_PICKUP_REACH_Y }), [grab('P1')]);
    expect(atDepth.objects?.[0]).toMatchObject({ state: 'held', holder: 'P1' });

    const beyondDepth = step(withFighter(base(), 'P1', { x: 100, y: 150 + OBJECT_PICKUP_REACH_Y + 1 }), [grab('P1')]);
    expect(beyondDepth.objects?.[0].state).toBe('ground');
  });

  it('resolves simultaneous grab inputs deterministically by fighter id', () => {
    const state = withObjects(createState(['P1', 'P2'], 'fighting'), [{
      id: 'O1', kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground', spawnTick: 5,
    }]);
    const next = step(
      withFighter(withFighter(state, 'P1', { x: 95, y: 150 }), 'P2', { x: 105, y: 150 }),
      [grab('P1'), grab('P2')],
    );
    expect(next.objects?.[0]).toMatchObject({ state: 'held', holder: 'P1' });
    expect(next.objects?.some(object => object.holder === 'P2')).toBe(false);
  });

  it('cannot pick up a second bottle while holding; the same grab edge throws the held one', () => {
    let state = withObjects(createState(['P1', 'P2'], 'fighting'), [
      heldBy('O1', 'P1', 100, 150),
      { id: 'O2', kind: 'bottle', x: 104, y: 150, z: 0, state: 'ground', spawnTick: 5 },
    ]);
    state = withFighter(state, 'P1', { x: 100, y: 150, facing: 1 });
    state = step(state, [grab('P1')]);
    expect(state.objects?.find(object => object.id === 'O1')?.state).toBe('airborne');
    expect(state.objects?.find(object => object.id === 'O2')?.state).toBe('ground');
    expect(state.objects?.filter(object => object.state === 'held')).toEqual([]);
  });

  it('makes a held bottle follow its holder every tick', () => {
    let state = withObjects(createState(['P1', 'P2'], 'fighting'), [heldBy('O1', 'P1', 100, 150)]);
    state = withFighter(state, 'P1', { x: 100, y: 150 });
    state = step(state, [{ ...neutral('P1'), moveX: 1, moveY: 1 }, neutral('P2')]);
    const object = state.objects?.[0];
    const holder = state.fighters[0];
    expect(object).toMatchObject({ state: 'held', holder: 'P1', x: holder.x, y: holder.y, z: HELD_OBJECT_Z });
    expect(holder.x).toBeGreaterThan(100);
  });

  it('drops a held bottle in the same tick when a thrown bottle knocks the holder out', () => {
    let state = withObjects(createState(['P1', 'P2'], 'fighting'), [
      { id: 'O1', kind: 'bottle', x: 94, y: 150, z: 12, state: 'airborne', holder: 'P2', vx: 3, vz: 1.65 },
      heldBy('O2', 'P1', 100, 150),
    ]);
    state = withFighter(state, 'P1', { x: 100, y: 150, health: 20 });
    state = withFighter(state, 'P2', { x: 300, y: 150 });
    const next = step(state, [neutral('P1'), neutral('P2')]);
    expect(next.fighters.find(fighter => fighter.id === 'P1')).toMatchObject({ health: 0, koTimer: 180 });
    expect(next.objects).toEqual([{
      id: 'O2', kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground',
    }]);
  });

  it('drops a held bottle on a knockout and on Last Man Standing elimination', () => {
    const punchAlreadyActive = MOVES.punch.active + MOVES.punch.recovery;
    const armed = (mode: 'score-brawl' | 'last-man-standing') => {
      let state = withObjects(
        createState({ ids: ['P1', 'P2'], phase: 'fighting', mode }),
        [heldBy('O1', 'P1', 120, 150)],
      );
      state = withFighter(state, 'P1', { x: 120, y: 150, health: 10, facing: -1 });
      state = withFighter(state, 'P2', {
        x: 100, y: 150, facing: 1, attackMove: 'punch', attackFrames: punchAlreadyActive,
        attackCooldown: punchAlreadyActive,
      });
      return step(state, [neutral('P1'), neutral('P2')]);
    };
    const scoreBrawl = armed('score-brawl');
    expect(scoreBrawl.fighters.find(fighter => fighter.id === 'P1')?.koTimer).toBe(180);
    expect(scoreBrawl.objects?.[0]).toEqual({
      id: 'O1', kind: 'bottle', x: 120, y: 150, z: 0, state: 'ground',
    });

    const lms = armed('last-man-standing');
    expect(lms.fighters.find(fighter => fighter.id === 'P1')?.eliminated).toBe(true);
    expect(lms.phase).toBe('results');
    expect(lms.objects?.[0]).toMatchObject({ id: 'O1', state: 'ground', z: 0 });
    expect(lms.objects?.[0]).not.toHaveProperty('holder');
  });
});

describe('M12 throw arc, impact and damage', () => {
  const throwState = (target?: Partial<Fighter>, mode?: 'score-brawl' | 'deathmatch' | 'last-man-standing') => {
    const base = createState({ ids: ['P1', 'P2'], phase: 'fighting', ...(mode ? { mode } : {}) });
    let state = withObjects(base, [heldBy('O1', 'P1', 100, 150)]);
    state = withFighter(state, 'P1', { x: 100, y: 150, facing: 1 });
    if (target) state = withFighter(state, 'P2', target);
    return state;
  };

  it('throws in the facing direction with the documented initial arc state', () => {
    const state = step(throwState({ x: 368, y: 134 }), [grab('P1'), neutral('P2')]);
    expect(state.objects?.[0]).toEqual({
      id: 'O1', kind: 'bottle', x: 100 + THROW_SPEED_X, y: 150, z: THROW_START_Z + THROW_START_VZ,
      state: 'airborne', holder: 'P1', vx: THROW_SPEED_X, vz: THROW_START_VZ - 0.35,
    });
    expect(state.objects?.[0].spawnTick).toBeUndefined();
  });

  it('throws and knocks back in the negative facing direction', () => {
    let state = withObjects(createState(['P1', 'P2'], 'fighting'), [heldBy('O1', 'P1', 300, 150)]);
    state = withFighter(state, 'P1', { x: 300, y: 150, facing: -1 });
    state = withFighter(state, 'P2', { x: 270, y: 150, health: 100 });
    state = step(state, [grab('P1'), neutral('P2')]);
    expect(state.objects?.[0]).toMatchObject({ state: 'airborne', vx: -THROW_SPEED_X, x: 300 - THROW_SPEED_X });
    for (let tick = 0; tick < 30 && state.objects?.length; tick++) state = step(state, []);
    expect(state.fighters[1].health).toBe(80);
    expect(state.fighters[1].knockback).toBeCloseTo(-3, 10);
  });

  it('follows a gravity arc, breaks on the ground and is removed in the same tick', () => {
    let state = throwState({ x: 368, y: 134 });
    state = step(state, [grab('P1'), neutral('P2')]);
    const heights: number[] = [];
    let ticks = 0;
    while (state.objects?.length && ticks < 60) {
      heights.push(state.objects[0].z);
      state = step(state, []);
      ticks++;
    }
    expect(state.objects).toBeUndefined();
    expect(heights.length).toBeGreaterThan(10);
    expect(Math.max(...heights)).toBeGreaterThan(THROW_START_Z);
    expect(ticks).toBeLessThanOrEqual(30);
  });

  it('hits the first opposing fighter for 20, emits throw, and breaks', () => {
    let state = throwState({ x: 140, y: 150, health: 100 });
    state = step(state, [grab('P1'), neutral('P2')]);
    let events = [...state.events];
    for (let tick = 0; tick < 30 && !events.some(event => event.type === 'HitLanded'); tick++) {
      state = step(state, []);
      events.push(...state.events);
    }
    const hit = events.find(event => event.type === 'HitLanded');
    expect(hit).toMatchObject({ attacker: 'P1', target: 'P2', move: 'throw' });
    expect(() => parseGameEvent(hit, hit!.tick, new Set(['P1', 'P2']))).not.toThrow();
    expect(state.fighters[1].health).toBe(80);
    expect(state.fighters[1].hitsReceived).toBe(1);
    expect(state.fighters[1].hitstun).toBeGreaterThan(0);
    expect(state.objects).toBeUndefined();
    // The knockback uses the thrower's throw direction, not its later facing.
    expect(state.fighters[1].knockback).toBeCloseTo(3, 10);
  });

  it('does not tunnel past a fighter at the throw speed and breaks on a low target only once', () => {
    let state = throwState({ x: 108, y: 150, health: 100 });
    state = step(state, [grab('P1'), neutral('P2')]);
    // 100 -> 103 is already within the 8 px radius of 108 on the first frame.
    expect(state.events.filter(event => event.type === 'HitLanded')).toHaveLength(1);
    expect(state.fighters[1].health).toBe(80);
    expect(state.objects).toBeUndefined();
    const after = step(state, []);
    expect(after.events.filter(event => event.type === 'HitLanded')).toHaveLength(0);
  });

  it('hits the nearest opposing fighter, not a farther one behind it', () => {
    let state = withObjects(createState(['P1', 'P2', 'P3'], 'fighting'), [heldBy('O1', 'P1', 100, 150)]);
    state = withFighter(state, 'P1', { x: 100, y: 150, facing: 1 });
    state = withFighter(state, 'P2', { x: 140, y: 150, health: 100 });
    state = withFighter(state, 'P3', { x: 120, y: 150, health: 100 });
    state = step(state, [grab('P1'), neutral('P2'), neutral('P3')]);
    for (let tick = 0; tick < 30 && state.objects?.length; tick++) {
      state = step(state, [neutral('P1'), neutral('P2'), neutral('P3')]);
    }
    expect(state.fighters.find(fighter => fighter.id === 'P3')?.health).toBe(80);
    expect(state.fighters.find(fighter => fighter.id === 'P2')?.health).toBe(100);
  });

  it('credits Score Brawl hit points and the bottle knockout', () => {
    let state = throwState({ x: 140, y: 150, health: 20 });
    state = step(state, [grab('P1'), neutral('P2')]);
    for (let tick = 0; tick < 30 && state.fighters[0].koCount === 0; tick++) state = step(state, []);
    const attacker = state.fighters[0];
    expect(attacker.score).toBe(MOVES.throw.points + 500);
    expect(attacker.koCount).toBe(1);
    expect(state.fighters[1]).toMatchObject({ health: 0, hitsReceived: 1, koTimer: 180, score: -200 });
    expect(state.events.map(event => event.type)).toEqual(['HitLanded', 'Knockout']);
  });

  it('credits a Deathmatch frag and the KO count to the thrower', () => {
    let state = throwState({ x: 140, y: 150, health: 20 }, 'deathmatch');
    state = step(state, [grab('P1'), neutral('P2')]);
    for (let tick = 0; tick < 30 && state.fighters[0].koCount === 0; tick++) state = step(state, []);
    expect(state.fighters[0]).toMatchObject({ frags: 1, koCount: 1 });
    expect(state.fighters[1]).toMatchObject({ deaths: 1, koTimer: 180 });
  });

  it('eliminates in Last Man Standing and credits damage through the shared pipeline', () => {
    let state = throwState({ x: 140, y: 150, health: 20 }, 'last-man-standing');
    state = step(state, [grab('P1'), neutral('P2')]);
    for (let tick = 0; tick < 30 && state.phase !== 'results'; tick++) state = step(state, []);
    expect(state.fighters[0]).toMatchObject({ koCount: 1, damageDealt: MOVES.throw.damage });
    expect(state.fighters[1]).toMatchObject({ eliminated: true, health: 0 });
    expect(state.events.find(event => event.type === 'MatchEnded'))
      .toMatchObject({ reason: 'elimination', winner: 'P1' });
  });

  it('keeps the hit radius and height bounds tight', () => {
    const nearMiss = throwState({ x: 140, y: 150 + THROW_HIT_RADIUS + 1, health: 100 });
    let state = step(nearMiss, [grab('P1'), neutral('P2')]);
    for (let tick = 0; tick < 40 && state.objects?.length; tick++) state = step(state, []);
    expect(state.fighters[1].health).toBe(100);

    const high = throwState({ x: 140, y: 150, health: 100, z: 100 });
    state = step(high, [grab('P1'), neutral('P2')]);
    for (let tick = 0; tick < 40 && state.objects?.length; tick++) state = step(state, []);
    expect(state.fighters[1].health).toBe(100);
  });
});

describe('M12 replay parity', () => {
  it('replays a pickup, throw and hit sequence to the identical state and objects', () => {
    const initial = withFighter(
      withFighter(
        withObjects(createState(['P1', 'P2'], 'fighting'), [{
          id: 'O1', kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground',
        }]),
        'P1',
        { x: 100, y: 150, facing: 1 },
      ),
      'P2',
      { x: 140, y: 150 },
    );
    const inputsFor = (tick: number): PlayerInput[] =>
      tick === 0 || tick === 2 ? [grab('P1'), neutral('P2')] : [neutral('P1'), neutral('P2')];
    let state = initial;
    const frames: InputFrame[] = [];
    const checkpoints = [{ tick: state.tick, fingerprint: stateSnapshotFingerprint({ version: 1, state }) }];
    for (let tick = 0; tick < 40; tick++) {
      const inputs = inputsFor(tick);
      frames.push({ version: 1, tick, inputs });
      state = step(state, inputs);
      if ([1, 3, 14, 40].includes(state.tick)) {
        checkpoints.push({ tick: state.tick, fingerprint: stateSnapshotFingerprint({ version: 1, state }) });
      }
    }
    const result = verifyReplay({
      version: 1,
      initial: { version: 1, state: initial },
      frames,
      checkpoints,
    });
    expect(result.final.state).toEqual(state);
    expect(result.final.state.objects).toBeUndefined();
    expect(result.final.state.fighters[1].health).toBe(80);
    expect(result.checked).toBe(checkpoints.length);
  });
});

describe('M12 object wire codec', () => {
  it('carries objects through a snapshot round-trip and omits the field when empty', () => {
    let state = run(createState(['P1', 'P2'], 'fighting'), 1800);
    state = withFighter(state, 'P1', { x: 110, y: 190, facing: 1 });
    state = step(state, [grab('P1'), neutral('P2')]);
    expect(state.objects?.[0]).toMatchObject({ id: 'O1', state: 'held', holder: 'P1' });
    const encoded = parseEnvelope(state);
    const decoded = decodeStateSnapshot(encoded);
    expect(decoded.state.objects).toEqual(state.objects);
    expect(encoded).toContain('"objects"');

    const base = createState(['P1', 'P2'], 'fighting');
    const plain = parseEnvelope(base);
    expect(plain).not.toContain('"objects"');
    expect(parseEnvelope({ ...base, objects: [] })).toBe(plain);
  });

  it('accepts every reachable object state and rejects the documented invalid states', () => {
    const valid = [
      { id: 'O1', kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground', spawnTick: 5 },
      { id: 'O2', kind: 'bottle', x: 100, y: 150, z: HELD_OBJECT_Z, state: 'held', holder: 'P1' },
      { id: 'O3', kind: 'bottle', x: 100, y: 150, z: 12, state: 'airborne', holder: 'P1', vx: 3, vz: 2 },
      { id: 'O4', kind: 'bottle', x: 100, y: 150, z: 0, state: 'broken' },
    ];
    expect(() => parseStateSnapshot({
      version: 1,
      state: { ...createState(['P1', 'P2'], 'fighting'), tick: 10, objects: valid },
    })).not.toThrow();

    for (const bad of [
      { ...valid[0], kind: 'chair' },
      { ...valid[0], state: 'flying' },
      { ...valid[1], holder: 'P9' },
      { ...valid[0], x: 15 },
      { ...valid[0], x: 369 },
      { ...valid[0], y: 123 },
      { ...valid[0], y: 205 },
      { ...valid[0], z: -1 },
      { ...valid[2], holder: undefined },
      { ...valid[2], vx: undefined },
      { ...valid[0], holder: 'P1' },
      { ...valid[0], spawnTick: 11 },
      { ...valid[0], id: 'B1' },
    ]) expect(rejectsObject(bad as SimObject)).toBe(true);
  });

  it('rejects duplicate object ids, the object count cap and unknown fields', () => {
    const base = { ...createState(['P1', 'P2'], 'fighting'), tick: 10 };
    const ground = (id: string): SimObject => ({ id, kind: 'bottle', x: 100, y: 150, z: 0, state: 'ground' });
    expect(() => parseStateSnapshot({ version: 1, state: { ...base, objects: [ground('O1'), ground('O1')] } }))
      .toThrow();
    expect(() => parseStateSnapshot({
      version: 1,
      state: { ...base, objects: Array.from({ length: MAX_SNAPSHOT_OBJECTS + 1 }, (_, index) => ground(`O${index + 1}`)) },
    })).toThrow();
    expect(rejectsObject({ ...ground('O1'), extra: true })).toBe(true);
  });

  it('round-trips an existing input frame unchanged and adds the optional grab bit', () => {
    const withoutGrab = { version: 1 as const, tick: 5, inputs: [{ playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: false, punch: true }] };
    const encoded = encodeInputFrame(withoutGrab);
    expect(encoded).toBe('{"version":1,"tick":5,"inputs":[{"playerId":"P1","moveX":1,"moveY":0,"jump":false,"punch":true}]}');
    expect(decodeInputFrame(encoded)).toEqual(withoutGrab);

    const withGrab = { version: 1 as const, tick: 5, inputs: [{ ...withoutGrab.inputs[0], grab: true }] };
    expect(decodeInputFrame(encodeInputFrame(withGrab))).toEqual(withGrab);
    expect(encodeInputFrame(withGrab)).toContain('"grab":true');
    expect(() => encodeInputFrame({ ...withGrab, inputs: [{ ...withGrab.inputs[0], grab: 1 as unknown as boolean }] })).toThrow();
  });

  it('measures the maximum-object snapshot bytes', () => {
    const base = { ...createState(['P1', 'P2'], 'fighting'), tick: 600 };
    const objects: SimObject[] = [
      { id: 'O1', kind: 'bottle', x: 110, y: 190, z: 0, state: 'ground', spawnTick: 600 },
      { id: 'O2', kind: 'bottle', x: 100, y: 150, z: HELD_OBJECT_Z, state: 'held', holder: 'P1', spawnTick: 600 },
      { id: 'O3', kind: 'bottle', x: 160, y: 150, z: 14, state: 'airborne', holder: 'P2', spawnTick: 600, vx: -3, vz: 1.65 },
    ];
    const withoutObjects = byteLength(parseEnvelope(base));
    const withMaxObjects = byteLength(parseEnvelope({ ...base, objects }));
    // Measured, not estimated: 589 -> 898 bytes, 309 bytes for three objects
    // in their worst-case field sets (ground + held + airborne, all with
    // spawnTick and the airborne pair with vx/vz), i.e. 103 bytes per object.
    expect(withoutObjects).toBe(589);
    expect(withMaxObjects - withoutObjects).toBe(309);
    expect(encodeStateSnapshot({ version: 1, state: { ...base, objects } }).length).toBeGreaterThan(0);
  });
});
