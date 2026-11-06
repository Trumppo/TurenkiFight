import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES, createState, step } from '../src/game/simulation/step';
import {
  BOT_TUNING, botInput, botItemIntent, botNeutralInput, isItemDecisionTick, isThrowDecisionTick,
} from '../src/game/input/botPolicy';
import type { Fighter, GameEvent, GameState, ModeId, PlayerInput, SimObject } from '../src/game/simulation/types';

/**
 * M12 bot items: pickup, throw, bounds and combat preservation.
 *
 * The fixture numbers below were measured before and after the bot learned to
 * use the object layer. Baseline on the same eight-bot fixtures (no item use):
 * - last-man-standing, seed 0x5eed: 663 ticks, 63 hits, 72 events.
 * - score-brawl, 3660 ticks: 437 hits, 20 jumpkicks, 543 events.
 *
 * After the change the one-minute Score Brawl fixture picks up four bottles,
 * throws all four, lands four thrown hits and records 457 total hits, so the
 * melee hit stream did not collapse. The short Last Man Standing fixture is
 * unchanged because its only bottle spawns at tick 600 and the match ends at
 * tick 663 with no bot in pickup reach.
 */
const BOT_SEED = 0x5eed;
const BOT_IDS = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function withFighter(state: GameState, id: string, patch: Partial<Fighter>): GameState {
  return { ...state, fighters: state.fighters.map(fighter => fighter.id === id ? { ...fighter, ...patch } : fighter) };
}

function withObjects(state: GameState, objects: SimObject[]): GameState {
  return { ...state, objects };
}

function bottle(id: string, x: number, y: number): SimObject {
  return { id, kind: 'bottle', x, y, z: 0, state: 'ground' };
}

function heldBy(id: string, holder: string, x: number, y: number): SimObject {
  return { id, kind: 'bottle', x, y, z: 12, state: 'held', holder };
}

const atTick = (state: GameState, tick: number): GameState => ({ ...state, tick });

/** First pickup decision tick at or after `from`. */
function pickupTick(seed: number, playerId: string, from = 0): number {
  for (let tick = from; tick < from + BOT_TUNING.itemDecisionPeriod; tick++) {
    if (isItemDecisionTick(seed, playerId, tick)) return tick;
  }
  throw new Error(`No pickup decision tick within ${BOT_TUNING.itemDecisionPeriod} ticks`);
}

/** First throw decision tick at or after `from`. */
function throwTick(seed: number, playerId: string, from = 0): number {
  for (let tick = from; tick < from + BOT_TUNING.throwDecisionPeriod; tick++) {
    if (isThrowDecisionTick(seed, playerId, tick)) return tick;
  }
  throw new Error(`No throw decision tick within ${BOT_TUNING.throwDecisionPeriod} ticks`);
}

/**
 * A two-fighter scene with explicit positions. P2 is the bot under test and P1
 * the only target, so `nearestOpponent` is unambiguous.
 */
function scene(
  selfX: number,
  selfY: number,
  facing: 1 | -1,
  targetX: number,
  targetY: number,
  objects: SimObject[] = [],
): GameState {
  const base = createState(['P1', 'P2'], 'fighting');
  const placed = withFighter(
    withFighter(base, 'P1', { x: targetX, y: targetY, facing: facing === 1 ? -1 : 1 }),
    'P2',
    { x: selfX, y: selfY, facing },
  );
  return withObjects(placed, objects);
}

describe('M12 bot pickup conditions', () => {
  it('picks up an in-reach bottle near the target and spends the tick on the grab', () => {
    const state = atTick(scene(200, 160, 1, 224, 160, [bottle('O1', 212, 160)]), pickupTick(BOT_SEED, 'P2'));
    expect(botItemIntent(state, 'P2', BOT_SEED)).toEqual({ action: 'pickup', objectId: 'O1' });

    const input = botInput(state, 'P2', BOT_SEED);
    expect(input.grab).toBe(true);
    expect(input.punch || input.kick || input.jumpkick).toBe(false);
    expect(input.jump).toBe(false);
    // The action owns the tick, so the bot does not walk past the bottle while
    // the simulation resolves movement before the pickup stage.
    expect(input.moveX).toBe(0);
    expect(input.moveY).toBe(0);
  });

  it('ignores a bottle that is out of reach, behind the bot, or far from the target', () => {
    const cases: Array<[string, GameState]> = [
      ['out of reach', scene(200, 160, 1, 224, 160, [bottle('O1', 230, 160)])],
      ['behind', scene(200, 160, 1, 224, 160, [bottle('O1', 188, 160)])],
      ['far from the target', scene(200, 160, 1, 330, 160, [bottle('O1', 212, 160)])],
    ];
    for (const [label, base] of cases) {
      const state = atTick(base, pickupTick(BOT_SEED, 'P2'));
      expect(botItemIntent(state, 'P2', BOT_SEED), label).toBeNull();
      expect(botInput(state, 'P2', BOT_SEED).grab, label).not.toBe(true);
    }
  });

  it('never picks up a second bottle while holding, attacking, stunned, airborne or knocked out', () => {
    const holding = scene(200, 160, 1, 224, 160, [heldBy('O1', 'P2', 200, 160), bottle('O2', 212, 160)]);
    for (let tick = 0; tick < BOT_TUNING.itemDecisionPeriod; tick++) {
      expect(botItemIntent(atTick(holding, tick), 'P2', BOT_SEED)?.action, `tick ${tick}`).not.toBe('pickup');
    }

    const base = scene(200, 160, 1, 224, 160, [bottle('O1', 212, 160)]);
    const tick = pickupTick(BOT_SEED, 'P2');
    const blocked: Array<[string, Partial<Fighter>]> = [
      ['attacking', { attackMove: 'punch', attackFrames: 20 }],
      ['stunned', { hitstun: 1 }],
      ['airborne', { z: 12, vz: 2 }],
      ['knocked out', { koTimer: 1 }],
      ['eliminated', { eliminated: true }],
    ];
    for (const [label, patch] of blocked) {
      const state = atTick(withFighter(base, 'P2', patch), tick);
      expect(botItemIntent(state, 'P2', BOT_SEED), label).toBeNull();
      expect(botInput(state, 'P2', BOT_SEED).grab, label).not.toBe(true);
    }
  });

  it('detours only to a nearby bottle and never leaves an attackable target', () => {
    // Target is outside kick reach; a bottle 20 px above the bot is on the way.
    const nearby = atTick(scene(200, 160, 1, 260, 150, [bottle('O1', 200, 140)]), 1);
    const detour = botInput(nearby, 'P2', BOT_SEED);
    // Walking straight at the target would be moveX 1; the bottle wins instead.
    expect(detour.moveX).toBe(0);
    expect(detour.moveY).toBe(-1);

    // Inside attack reach the bot must fight, not step aside for the bottle.
    const inFight = atTick(scene(200, 160, 1, 225, 160, [bottle('O1', 200, 140)]), 1);
    const fight = botInput(inFight, 'P2', BOT_SEED);
    expect(fight.moveY).toBe(0);

    // A bottle far from the target is ignored even when it is close to the bot.
    const unrelated = atTick(scene(200, 160, 1, 320, 160, [bottle('O1', 200, 140)]), 1);
    const walk = botInput(unrelated, 'P2', BOT_SEED);
    expect(walk.moveX).toBe(1);
    expect(walk.moveY).toBe(0);
  });

  it('lets only one bot claim a contested bottle', () => {
    // P2 and P3 face each other over a single bottle. Both would be eligible;
    // the simulation's ordered pickup stage must give it to exactly one of them.
    let state = createState(['P1', 'P2', 'P3'], 'fighting');
    state = withFighter(state, 'P1', { x: 340, y: 160, facing: -1 });
    state = withFighter(state, 'P2', { x: 190, y: 160, facing: 1 });
    state = withFighter(state, 'P3', { x: 206, y: 160, facing: -1 });
    state = withObjects(state, [bottle('O1', 198, 160)]);

    let pickups = 0;
    for (let tick = 0; tick < BOT_TUNING.itemDecisionPeriod * 4; tick++) {
      const before = (state.objects ?? []).find(object => object.id === 'O1');
      state = step(state, [neutral('P1'), botInput(state, 'P2', BOT_SEED), botInput(state, 'P3', BOT_SEED)]);
      const after = (state.objects ?? []).find(object => object.id === 'O1');
      if (before?.state === 'ground' && after?.state === 'held') pickups++;
      const holders = (state.objects ?? []).filter(object => object.state === 'held');
      expect(holders.length, `tick ${tick}`).toBeLessThanOrEqual(1);
    }
    expect(pickups).toBe(1);
  });
});

describe('M12 bot throw conditions', () => {
  it('throws a held bottle at an in-front target inside range and aligned depth', () => {
    const state = atTick(scene(200, 160, 1, 240, 160, [heldBy('O1', 'P2', 200, 160)]), throwTick(BOT_SEED, 'P2'));
    expect(botItemIntent(state, 'P2', BOT_SEED)).toEqual({ action: 'throw', objectId: 'O1' });

    const input = botInput(state, 'P2', BOT_SEED);
    expect(input.grab).toBe(true);
    expect(input.punch || input.kick || input.jumpkick).toBe(false);
    expect(input.jump).toBe(false);
  });

  it('does not throw behind the bot, past the arc, on another depth line or on a non-throw tick', () => {
    const cases: Array<[string, GameState]> = [
      ['behind', scene(200, 160, 1, 160, 160, [heldBy('O1', 'P2', 200, 160)])],
      ['too far', scene(200, 160, 1, 250, 160, [heldBy('O1', 'P2', 200, 160)])],
      ['off depth', scene(200, 160, 1, 240, 190, [heldBy('O1', 'P2', 200, 160)])],
    ];
    for (const [label, base] of cases) {
      const state = atTick(base, throwTick(BOT_SEED, 'P2'));
      expect(botItemIntent(state, 'P2', BOT_SEED), label).toBeNull();
      expect(botInput(state, 'P2', BOT_SEED).grab, label).not.toBe(true);
    }

    // Same throwable geometry, but the tick is not on the throw cadence.
    const offCadence = atTick(
      scene(200, 160, 1, 240, 160, [heldBy('O1', 'P2', 200, 160)]),
      throwTick(BOT_SEED, 'P2') + 1,
    );
    expect(botItemIntent(offCadence, 'P2', BOT_SEED)).toBeNull();
  });

  it('throws in attack recovery but not during startup or active frames', () => {
    const base = scene(200, 160, 1, 240, 160, [heldBy('O1', 'P2', 200, 160)]);
    const tick = throwTick(BOT_SEED, 'P2');
    const recovery = withFighter(base, 'P2', { attackMove: 'punch', attackFrames: 5 });
    expect(botItemIntent(atTick(recovery, tick), 'P2', BOT_SEED)).toEqual({ action: 'throw', objectId: 'O1' });
    expect(botInput(atTick(recovery, tick), 'P2', BOT_SEED).grab).toBe(true);

    const total = MOVES.punch.startup + MOVES.punch.active + MOVES.punch.recovery;
    for (const attackFrames of [total - 1, total - MOVES.punch.startup]) {
      const early = withFighter(base, 'P2', { attackMove: 'punch', attackFrames });
      expect(botItemIntent(atTick(early, tick), 'P2', BOT_SEED), `attackFrames ${attackFrames}`).toBeNull();
    }
  });

  it('does not throw while airborne, stunned, knocked out or without a target', () => {
    const base = scene(200, 160, 1, 240, 160, [heldBy('O1', 'P2', 200, 160)]);
    const tick = throwTick(BOT_SEED, 'P2');
    for (const [label, patch] of [
      ['airborne', { z: 12, vz: 2 }],
      ['stunned', { hitstun: 1 }],
      ['knocked out', { koTimer: 1 }],
      ['eliminated', { eliminated: true }],
    ] as Array<[string, Partial<Fighter>]>) {
      expect(botItemIntent(atTick(withFighter(base, 'P2', patch), tick), 'P2', BOT_SEED), label).toBeNull();
    }
    const noTarget = atTick(withFighter(base, 'P1', { eliminated: true }), tick);
    expect(botItemIntent(noTarget, 'P2', BOT_SEED)).toBeNull();
  });
});

describe('M12 bot item bounds', () => {
  it('gives each bot exactly one pickup and one throw decision tick per cadence', () => {
    for (let seed = 0; seed < 25; seed++) {
      for (const id of BOT_IDS) {
        const pickups = Array.from({ length: BOT_TUNING.itemDecisionPeriod }, (_, tick) => tick)
          .filter(tick => isItemDecisionTick(seed, id, tick));
        expect(pickups).toHaveLength(1);
        expect(isItemDecisionTick(seed, id, pickups[0] + BOT_TUNING.itemDecisionPeriod)).toBe(true);
        expect(isItemDecisionTick(seed, id, pickups[0] + 1)).toBe(false);

        const throws = Array.from({ length: BOT_TUNING.throwDecisionPeriod }, (_, tick) => tick)
          .filter(tick => isThrowDecisionTick(seed, id, tick));
        expect(throws).toHaveLength(1);
        expect(isThrowDecisionTick(seed, id, throws[0] + BOT_TUNING.throwDecisionPeriod)).toBe(true);
        expect(isThrowDecisionTick(seed, id, throws[0] + 1)).toBe(false);
      }
    }
    expect(new Set(BOT_IDS.map(id => pickupTick(BOT_SEED, id))).size).toBeGreaterThan(1);
  });

  it('always leaves at least one throw period before the next pickup opportunity', () => {
    // This is the memory-free guarantee behind "no re-pickup immediately after
    // a throw": throw ticks are on the pickup residue class modulo the throw
    // period, so the next pickup is at least one throw period later.
    for (let seed = 0; seed < 40; seed++) {
      for (const id of BOT_IDS) {
        for (let tick = 0; tick < 400; tick++) {
          if (!isThrowDecisionTick(seed, id, tick)) continue;
          let nextPickup = tick + 1;
          while (nextPickup < tick + BOT_TUNING.itemDecisionPeriod && !isItemDecisionTick(seed, id, nextPickup)) nextPickup++;
          expect(nextPickup - tick, `seed ${seed} ${id} tick ${tick}`).toBeGreaterThanOrEqual(BOT_TUNING.throwDecisionPeriod);
        }
      }
    }
  });

  it('presses grab only on its own cadence and never picks up right after a throw', () => {
    const pickupBase = scene(200, 160, 1, 224, 160, [bottle('O1', 212, 160)]);
    const pickupPresses: number[] = [];
    for (let tick = 0; tick < BOT_TUNING.itemDecisionPeriod * 2; tick++) {
      if (botInput(atTick(pickupBase, tick), 'P2', BOT_SEED).grab) pickupPresses.push(tick);
    }
    expect(pickupPresses).toHaveLength(2);
    expect(pickupPresses[1] - pickupPresses[0]).toBe(BOT_TUNING.itemDecisionPeriod);
    for (const tick of pickupPresses) expect(isItemDecisionTick(BOT_SEED, 'P2', tick)).toBe(true);

    const throwBase = scene(200, 160, 1, 240, 160, [heldBy('O1', 'P2', 200, 160)]);
    const throwPresses: number[] = [];
    for (let tick = 0; tick < BOT_TUNING.throwDecisionPeriod * 2; tick++) {
      if (botInput(atTick(throwBase, tick), 'P2', BOT_SEED).grab) throwPresses.push(tick);
    }
    expect(throwPresses).toHaveLength(2);
    expect(throwPresses[1] - throwPresses[0]).toBe(BOT_TUNING.throwDecisionPeriod);
    for (const tick of throwPresses) expect(isThrowDecisionTick(BOT_SEED, 'P2', tick)).toBe(true);

    // A real throw does not allow the same bot to pick up another ground bottle
    // on the following ticks; only its next pickup decision tick can do that.
    const throwAt = throwTick(BOT_SEED, 'P2');
    const contest = atTick(
      scene(200, 160, 1, 240, 160, [heldBy('O1', 'P2', 200, 160), bottle('O2', 212, 160)]),
      throwAt,
    );
    const afterThrow = step(contest, [neutral('P1'), botInput(contest, 'P2', BOT_SEED)]);
    expect(afterThrow.objects?.find(object => object.id === 'O1')?.state).not.toBe('held');
    for (let offset = 1; offset < BOT_TUNING.throwDecisionPeriod; offset++) {
      const probe = atTick(afterThrow, throwAt + offset);
      expect(botItemIntent(probe, 'P2', BOT_SEED)?.action, `+${offset}`).not.toBe('pickup');
    }
  });
});

interface ItemFixtureRun {
  mode: ModeId;
  ticks: number;
  phase: GameState['phase'];
  state: GameState;
  events: GameEvent[];
  pickups: number;
  throws: number;
  thrownHits: number;
  totalHits: number;
  punches: number;
  kicks: number;
  jumpkicks: number;
  eventCount: number;
  objectsLeft: number;
  holders: string[];
  throwsByBot: Record<string, number>;
  pickupsByBot: Record<string, number>;
  grabPressesByBot: Record<string, number>;
  minGrabGap: number | null;
}

/**
 * Runs one fixed eight-bot match and counts item actions from the simulation's
 * own transitions, not from the bot inputs alone. A held object that becomes
 * airborne or disappears was thrown; a ground object that becomes held was
 * picked up. This also counts a point-blank throw that breaks in the same tick.
 */
function runEightBotFixture(mode: ModeId, limit: number, seed = BOT_SEED): ItemFixtureRun {
  let state = createState(BOT_IDS, 'countdown', { mode });
  const events: GameEvent[] = [];
  let pickups = 0;
  let throws = 0;
  let totalHits = 0;
  let punches = 0;
  let kicks = 0;
  let jumpkicks = 0;
  const throwsByBot: Record<string, number> = {};
  const pickupsByBot: Record<string, number> = {};
  const grabPressesByBot: Record<string, number> = {};
  const lastGrabTick: Record<string, number> = {};
  const gaps: number[] = [];
  let ticks = 0;
  while (state.phase !== 'results' && ticks < limit) {
    const inputs = BOT_IDS.map(id => botInput(state, id, seed));
    for (const input of inputs) {
      if (!input.grab) continue;
      grabPressesByBot[input.playerId] = (grabPressesByBot[input.playerId] ?? 0) + 1;
      if (lastGrabTick[input.playerId] !== undefined) gaps.push(state.tick - lastGrabTick[input.playerId]);
      lastGrabTick[input.playerId] = state.tick;
    }
    const before = new Map<string, SimObject>((state.objects ?? []).map(object => [object.id, { ...object }]));
    state = step(state, inputs);
    const after = new Map<string, SimObject>((state.objects ?? []).map(object => [object.id, { ...object }]));
    for (const [id, object] of before) {
      if (object.state !== 'held' || !object.holder) continue;
      const next = after.get(id);
      if (!next || next.state === 'airborne') {
        throws++;
        throwsByBot[object.holder] = (throwsByBot[object.holder] ?? 0) + 1;
      }
    }
    for (const [id, object] of after) {
      if (object.state !== 'held' || !object.holder) continue;
      const previous = before.get(id);
      if (!previous || previous.state === 'ground') {
        pickups++;
        pickupsByBot[object.holder] = (pickupsByBot[object.holder] ?? 0) + 1;
      }
    }
    for (const event of state.events) {
      if (event.type !== 'HitLanded') continue;
      totalHits++;
      if (event.move === 'punch') punches++;
      if (event.move === 'kick') kicks++;
      if (event.move === 'jumpkick') jumpkicks++;
    }
    events.push(...state.events);
    ticks++;
  }
  return {
    mode,
    ticks,
    phase: state.phase,
    state,
    events,
    pickups,
    throws,
    thrownHits: events.filter(event => event.type === 'HitLanded' && event.move === 'throw').length,
    totalHits,
    punches,
    kicks,
    jumpkicks,
    eventCount: events.length,
    objectsLeft: state.objects?.length ?? 0,
    holders: (state.objects ?? []).filter(object => object.state === 'held').map(object => object.holder!),
    throwsByBot,
    pickupsByBot,
    grabPressesByBot,
    minGrabGap: gaps.length ? Math.min(...gaps) : null,
  };
}

describe('M12 bot item fixtures', () => {
  it('records the one-minute Score Brawl item usage and preserves the melee hit stream', () => {
    const run = runEightBotFixture('score-brawl', 3660);
    // Four pickups and four throws from the fixed bottle schedule. Every throw
    // hit, and total hits rose from 437 before item use to 457, so fighting was
    // not replaced by item play.
    expect(run.phase).toBe('fighting');
    expect(run.pickups).toBe(4);
    expect(run.throws).toBe(4);
    expect(run.thrownHits).toBe(4);
    expect(run.totalHits).toBe(457);
    expect(run.punches).toBe(171);
    expect(run.kicks).toBe(261);
    expect(run.jumpkicks).toBe(21);
    expect(run.eventCount).toBe(567);
    expect(run.holders).toEqual([]);
    expect(run.objectsLeft).toBe(2);
    // The minimum gap between any two grab presses is the throw cadence; the
    // pickup cadence is longer, so neither item action can run every tick.
    expect(run.minGrabGap).toBe(BOT_TUNING.throwDecisionPeriod);
    expect(run.throwsByBot).toEqual({ P7: 1, P2: 2, P5: 1 });
    for (const id of BOT_IDS) {
      expect(run.throwsByBot[id] ?? 0, id).toBeLessThanOrEqual(run.pickupsByBot[id] ?? 0);
    }
  });

  it('leaves the short last-man-standing fixture unchanged because the bottle spawns too late', () => {
    const run = runEightBotFixture('last-man-standing', COUNTDOWN_TICKS + MATCH_TICKS + 10);
    expect(run.ticks).toBe(663);
    expect(run.phase).toBe('results');
    expect(run.pickups).toBe(0);
    expect(run.throws).toBe(0);
    expect(run.thrownHits).toBe(0);
    // Baseline before bot items: 63 hits and 72 events. The only bottle spawns
    // at tick 600 and the match ends at 663 with no bot in pickup reach.
    expect(run.totalHits).toBe(63);
    expect(run.eventCount).toBe(72);
    expect(run.holders).toEqual([]);
  });

  it('replays the same item match from the same seed and changes it with another seed', () => {
    const first = runEightBotFixture('score-brawl', 3660);
    const second = runEightBotFixture('score-brawl', 3660);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(hash(second.state)).toBe(hash(first.state));
    expect(hash(second.events)).toBe(hash(first.events));

    const other = runEightBotFixture('score-brawl', 3660, BOT_SEED + 1);
    expect(hash(other.events)).not.toBe(hash(first.events));
  });
});
