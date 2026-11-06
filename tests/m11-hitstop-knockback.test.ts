import { describe, expect, it } from 'vitest';
import {
  ARENA_BOUNDS, FIGHTER_SPEED, HITSTUN_TICKS, HIT_STOP_TICKS, KNOCKBACK_PX, KO_HIT_STOP_TICKS, MOVES,
  createState, step,
} from '../src/game/simulation/step';
import { decodeStateSnapshot, encodeStateSnapshot, parseStateSnapshot } from '../src/game/protocol/stateSnapshot';
import type { Direction, GameState, Move, PlayerInput } from '../src/game/simulation/types';

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const moveRight = (playerId: string): PlayerInput => ({ ...neutral(playerId), moveX: 1 });
const activeFrames = (move: Move) => MOVES[move].active + MOVES[move].recovery;

/**
 * P1 is one active-frame window into `move` with `target` in reach, matching
 * the hit-resolution conditions in `step()`. Used to trigger a single clean hit
 * on the next tick without depending on movement or input buffering.
 */
function hitState(move: Move, options: {
  attackerX?: number;
  attackerFacing?: Direction;
  targetX?: number;
  targetHealth?: number;
  targetProtection?: number;
} = {}): GameState {
  const { attackerX = 100, attackerFacing = 1, targetX = 120, targetHealth = 100, targetProtection = 0 } = options;
  const base = createState(['P1', 'P2'], 'fighting');
  return {
    ...base,
    fighters: [
      {
        ...base.fighters[0], x: attackerX, y: 148, facing: attackerFacing,
        attackMove: move, attackFrames: activeFrames(move), attackCooldown: activeFrames(move),
      },
      { ...base.fighters[1], x: targetX, y: 148, facing: attackerFacing === 1 ? -1 : 1, health: targetHealth, protection: targetProtection },
    ],
  };
}

/** Run a state forward with neutral inputs. */
function settle(state: GameState, ticks: number): GameState {
  let next = state;
  for (let tick = 0; tick < ticks; tick++) next = step(next, next.fighters.map(f => neutral(f.id)));
  return next;
}

describe('M11 hit stop', () => {
  it('starts a 3-tick freeze on a clean hit and freezes movement, input edge detection and attack frames', () => {
    const hit = step(hitState('punch'), []);

    expect(hit.events.map(event => event.type)).toEqual(['HitLanded']);
    expect(hit.hitStopTicks).toBe(HIT_STOP_TICKS);
    expect(hit.hitStopTicks).toBe(3);
    expect(hit.fighters[1].hitstun).toBe(HITSTUN_TICKS);

    const attackerX = hit.fighters[0].x;
    const targetX = hit.fighters[1].x;
    const attackFrames = hit.fighters[0].attackFrames;
    let frozen = step(hit, [moveRight('P1'), moveRight('P2')]);

    expect(frozen.hitStopTicks).toBe(2);
    // Both fighters are frozen even though both hold right.
    expect(frozen.fighters[0].x).toBe(attackerX);
    expect(frozen.fighters[1].x).toBe(targetX);
    expect(frozen.fighters[0].attackFrames).toBe(attackFrames);
    expect(frozen.fighters[0].attackCooldown).toBe(attackFrames);
    // The match timer keeps running; hitstun is frozen with the fight.
    expect(frozen.remainingTicks).toBe(hit.remainingTicks - 1);
    expect(frozen.fighters[1].hitstun).toBe(HITSTUN_TICKS);
    // Knockback is queued but does not move a frozen fighter.
    expect(frozen.fighters[1].knockback).toBe(KNOCKBACK_PX.punch);

    frozen = step(frozen, [moveRight('P1'), moveRight('P2')]);
    expect(frozen.hitStopTicks).toBe(1);
    expect(frozen.fighters[0].x).toBe(attackerX);
    frozen = step(frozen, [moveRight('P1'), moveRight('P2')]);
    expect(frozen.hitStopTicks ?? 0).toBe(0);
    // Canonical in-memory form: a zero counter is absent, like the wire.
    expect(frozen).not.toHaveProperty('hitStopTicks');
    // The third tick is still frozen: the counter is read before it decrements.
    expect(frozen.fighters[0].x).toBe(attackerX);
    expect(frozen.fighters[1].hitstun).toBe(HITSTUN_TICKS);

    // The next tick is live again: input movement and attack recovery resume,
    // and the target begins its knockback slide over the remaining hitstun.
    const resumed = step(frozen, [moveRight('P1'), neutral('P2')]);
    expect(resumed.hitStopTicks ?? 0).toBe(0);
    expect(resumed.fighters[0].x).toBeCloseTo(attackerX + FIGHTER_SPEED, 10);
    expect(resumed.fighters[0].attackFrames).toBe(attackFrames - 1);
    expect(resumed.fighters[1].x).toBeGreaterThan(targetX);
  });

  it('refreshes on a hit during the freeze but never exceeds the 3-tick cap', () => {
    // Counter is decremented first (3 -> 2), then the same-tick hit refreshes
    // it to 3. It never becomes 4 or 5 for an ordinary hit.
    const refreshed = step({ ...hitState('punch'), hitStopTicks: HIT_STOP_TICKS }, []);
    expect(refreshed.events.map(event => event.type)).toEqual(['HitLanded']);
    expect(refreshed.hitStopTicks).toBe(HIT_STOP_TICKS);

    // A freeze that was about to expire is refreshed from zero to a full 3.
    const late = step({ ...hitState('kick'), hitStopTicks: 1 }, []);
    expect(late.hitStopTicks).toBe(HIT_STOP_TICKS);

    // Two targets hit by one active window on the same tick still cap at 3.
    const base = createState(['P1', 'P2', 'P3'], 'fighting');
    const frames = activeFrames('punch');
    const multi: GameState = {
      ...base,
      fighters: [
        { ...base.fighters[0], x: 100, y: 148, facing: 1, attackMove: 'punch', attackFrames: frames, attackCooldown: frames },
        { ...base.fighters[1], x: 118, y: 148 },
        { ...base.fighters[2], x: 126, y: 148 },
      ],
    };
    const multiHit = step(multi, []);
    expect(multiHit.events.filter(event => event.type === 'HitLanded')).toHaveLength(2);
    expect(multiHit.hitStopTicks).toBe(HIT_STOP_TICKS);

    // A normal hit during a 5-tick KO freeze cannot push the counter past the
    // KO maximum, and it cannot shrink the already-running KO freeze either.
    const duringKo = step({ ...hitState('punch'), hitStopTicks: KO_HIT_STOP_TICKS }, []);
    expect(duringKo.hitStopTicks).toBe(KO_HIT_STOP_TICKS - 1);
    expect(duringKo.hitStopTicks).toBeLessThanOrEqual(KO_HIT_STOP_TICKS);
  });

  it('uses a 5-tick freeze for a knockout and keeps the knockout lifecycle', () => {
    const knockout = step(hitState('punch', { targetHealth: 10 }), []);
    expect(knockout.events.map(event => event.type)).toEqual(['HitLanded', 'Knockout']);
    expect(knockout.hitStopTicks).toBe(KO_HIT_STOP_TICKS);
    expect(knockout.fighters[1].koTimer).toBe(180);
    expect(knockout.fighters[1].hitstun).toBe(0);
    expect(knockout.fighters[1].knockback).toBeUndefined();

    const counters: number[] = [knockout.hitStopTicks ?? 0];
    let state = knockout;
    for (let tick = 0; tick < 5; tick++) {
      state = step(state, [moveRight('P1'), moveRight('P2')]);
      counters.push(state.hitStopTicks ?? 0);
    }
    // Five frozen ticks, then the freeze ends; the KO respawn timer kept
    // running throughout, exactly as it does without hit stop.
    expect(counters).toEqual([5, 4, 3, 2, 1, 0]);
    expect(state.fighters[1].koTimer).toBe(180 - 5);
    // The KO'd fighter was frozen but is not stuck: attack frames resume.
    const beforeAttack = state.fighters[0].attackFrames;
    state = step(state, [neutral('P1'), neutral('P2')]);
    expect(state.fighters[0].attackFrames).toBe(beforeAttack - 1);
    expect(state.hitStopTicks ?? 0).toBe(0);
  });

  it('does not apply outside the fighting phase', () => {
    const countdown = { ...createState(['P1', 'P2'], 'countdown'), hitStopTicks: 5 };
    const countdownNext = step(countdown, [moveRight('P1')]);
    expect(countdownNext.phase).toBe('countdown');
    expect(countdownNext.hitStopTicks).toBe(5);
    expect(countdownNext.fighters).toEqual(countdown.fighters);

    const lobby = { ...createState(['P1', 'P2'], 'lobby'), hitStopTicks: 5 };
    const lobbyNext = step(lobby, [moveRight('P1')]);
    expect(lobbyNext.hitStopTicks).toBe(5);
    expect(lobbyNext.fighters).toEqual(lobby.fighters);

    const results = { ...createState(['P1', 'P2'], 'results'), hitStopTicks: 5 };
    const resultsNext = step(results, [moveRight('P1')]);
    expect(resultsNext.hitStopTicks).toBe(5);
    expect(resultsNext.fighters).toEqual(results.fighters);

    // No hit resolution outside fighting, even with an otherwise valid active
    // window in range: the counter can never start there.
    const armed = { ...hitState('punch'), phase: 'countdown' as const };
    const armedNext = step(armed, []);
    expect(armedNext.events).toEqual([]);
    expect(armedNext.hitStopTicks).toBeUndefined();
  });
});

describe('M11 knockback', () => {
  it('slides punch 2 px, kick 4 px and jumpkick 6 px in the attacker facing direction', () => {
    for (const move of ['punch', 'kick', 'jumpkick'] as const) {
      const hit = step(hitState(move), []);
      const startX = hit.fighters[1].x;
      expect(hit.events.filter(event => event.type === 'HitLanded')).toHaveLength(1);
      expect(hit.fighters[1].knockback).toBe(KNOCKBACK_PX[move]);
      expect(KNOCKBACK_PX[move]).toBe(move === 'punch' ? 2 : move === 'kick' ? 4 : 6);

      const landed = settle(hit, 20);
      expect(landed.fighters[1].hitstun).toBe(0);
      expect(landed.fighters[1].knockback).toBeUndefined();
      expect(landed.fighters[1].x - startX).toBeCloseTo(KNOCKBACK_PX[move], 10);
    }

    // A left-facing attacker pushes the target left.
    const left = hitState('kick', { attackerX: 200, attackerFacing: -1, targetX: 180 });
    const hit = step(left, []);
    const startX = hit.fighters[1].x;
    expect(hit.fighters[1].knockback).toBe(-KNOCKBACK_PX.kick);
    expect(settle(hit, 20).fighters[1].x - startX).toBeCloseTo(-KNOCKBACK_PX.kick, 10);
  });

  it('clamps at both x walls and never moves a fighter outside the arena', () => {
    // Push outward into the right wall.
    const rightHit = step(hitState('jumpkick', { attackerX: 348, targetX: 368 }), []);
    expect(rightHit.fighters[1].knockback).toBe(KNOCKBACK_PX.jumpkick);
    const right = settle(rightHit, 20).fighters[1];
    expect(right.x).toBe(ARENA_BOUNDS.maxX);
    expect(right.y).toBeGreaterThanOrEqual(ARENA_BOUNDS.minY);
    expect(right.y).toBeLessThanOrEqual(ARENA_BOUNDS.maxY);

    // Push outward into the left wall.
    const leftHit = step(hitState('jumpkick', { attackerX: 36, attackerFacing: -1, targetX: 16 }), []);
    expect(leftHit.fighters[1].knockback).toBe(-KNOCKBACK_PX.jumpkick);
    const left = settle(leftHit, 20).fighters[1];
    expect(left.x).toBe(ARENA_BOUNDS.minX);
    expect(left.y).toBeGreaterThanOrEqual(ARENA_BOUNDS.minY);
    expect(left.y).toBeLessThanOrEqual(ARENA_BOUNDS.maxY);

    // A clamped push is consumed, not deferred: the fighter stays at the wall
    // after the hitstun ends instead of sliding later.
    expect(left.knockback).toBeUndefined();
    expect(settle({ ...leftHit, hitStopTicks: 0 }, 200).fighters[1].x).toBe(ARENA_BOUNDS.minX);
  });

  it('keeps every fighter inside all four bounds during a deterministic edge brawl', () => {
    const ids = ['P1', 'P2', 'P3', 'P4'];
    let state = createState(ids, 'fighting');
    state = {
      ...state,
      fighters: state.fighters.map((fighter, index) => ({
        ...fighter,
        x: [18, 366, 18, 366][index],
        y: [126, 126, 202, 202][index],
        facing: (index % 2 === 0 ? 1 : -1) as Direction,
      })),
    };
    const violations: string[] = [];
    for (let tick = 0; tick < 900; tick++) {
      const inputs = state.fighters.map((fighter, index) => ({
        ...neutral(fighter.id),
        moveX: (index % 2 === 0 ? -1 : 1) as -1 | 1,
        moveY: (index < 2 ? -1 : 1) as -1 | 1,
        punch: tick % 11 === index,
        kick: tick % 17 === index,
        jumpkick: tick % 29 === index,
        jump: tick % 41 === index,
      }));
      state = step(state, inputs);
      for (const fighter of state.fighters) {
        if (fighter.x < ARENA_BOUNDS.minX || fighter.x > ARENA_BOUNDS.maxX ||
            fighter.y < ARENA_BOUNDS.minY || fighter.y > ARENA_BOUNDS.maxY ||
            ((fighter.knockback ?? 0) !== 0 && fighter.hitstun === 0) || !Number.isFinite(fighter.x)) {
          violations.push(`${tick}:${fighter.id}:${fighter.x},${fighter.y}:${fighter.knockback}/${fighter.hitstun}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('M11 trades and knockouts during hit stop', () => {
  it('resolves a same-tick trade without deadlock and lets both fighters recover', () => {
    const base = createState(['P1', 'P2'], 'fighting');
    const frames = activeFrames('punch');
    const trade: GameState = {
      ...base,
      fighters: [
        { ...base.fighters[0], x: 170, y: 160, facing: 1, health: 10, attackMove: 'punch', attackFrames: frames, attackCooldown: frames },
        { ...base.fighters[1], x: 192, y: 160, facing: -1, health: 10, attackMove: 'punch', attackFrames: frames, attackCooldown: frames },
      ],
    };
    let state = step(trade, []);
    expect(state.events.map(event => event.type)).toEqual([
      'HitLanded', 'Knockout', 'HitLanded', 'Knockout',
    ]);
    expect(state.hitStopTicks).toBe(KO_HIT_STOP_TICKS);
    expect(state.fighters.map(fighter => fighter.koTimer)).toEqual([180, 180]);

    for (let tick = 0; tick < 5; tick++) state = step(state, [neutral('P1'), neutral('P2')]);
    expect(state.hitStopTicks ?? 0).toBe(0);
    // Both respawn after the normal 180 KO ticks; the freeze did not add to it.
    state = settle(state, 180);
    expect(state.fighters.map(fighter => fighter.health)).toEqual([100, 100]);
    expect(state.fighters.map(fighter => fighter.koTimer)).toEqual([0, 0]);
    expect(state.hitStopTicks ?? 0).toBe(0);
  });

  it('can extend an active 3-tick freeze into a 5-tick KO freeze', () => {
    const base = createState(['P1', 'P2', 'P3'], 'fighting');
    const frames = activeFrames('punch');
    let state: GameState = {
      ...base,
      fighters: [
        { ...base.fighters[0], x: 100, y: 148, facing: 1, attackMove: 'punch', attackFrames: frames, attackCooldown: frames },
        { ...base.fighters[1], x: 118, y: 148 },
        // Protection expires during the freeze; the knockback victim is then
        // hit by the same frozen active window and dies.
        { ...base.fighters[2], x: 130, y: 148, health: 10, protection: 3 },
      ],
    };
    state = step(state, []);
    expect(state.events.map(event => `${event.type}:${event.target}`)).toEqual(['HitLanded:P2']);
    expect(state.hitStopTicks).toBe(HIT_STOP_TICKS);

    state = step(state, []); // protection 1, still skipped
    expect(state.hitStopTicks).toBe(HIT_STOP_TICKS - 1);
    expect(state.events).toEqual([]);
    state = step(state, []); // protection 0, same frozen active window lands
    expect(state.events.map(event => `${event.type}:${event.target}`)).toEqual(['HitLanded:P3', 'Knockout:P3']);
    expect(state.hitStopTicks).toBe(KO_HIT_STOP_TICKS);

    for (let tick = 0; tick < 5; tick++) state = step(state, []);
    expect(state.hitStopTicks ?? 0).toBe(0);
    expect(state.fighters[2].koTimer).toBe(180 - 5);
  });

  it('never leaves the counter above its maximum during a long brawl', () => {
    const ids = ['P1', 'P2', 'P3', 'P4'];
    let state = createState(ids, 'fighting');
    const violations: string[] = [];
    for (let tick = 0; tick < 1200; tick++) {
      const inputs = state.fighters.map((fighter, index) => ({
        ...neutral(fighter.id),
        moveX: ((tick >> index) % 3 - 1) as -1 | 0 | 1,
        punch: (tick + index) % 13 === 0,
        kick: (tick + index) % 19 === 0,
        jumpkick: (tick + index) % 31 === 0,
      }));
      state = step(state, inputs);
      const stop = state.hitStopTicks ?? 0;
      if (stop < 0 || stop > KO_HIT_STOP_TICKS) {
        violations.push(`${tick}:hitStop=${stop}`);
      }
      for (const fighter of state.fighters) {
        if ((fighter.knockback ?? 0) !== 0 && fighter.hitstun === 0) {
          violations.push(`${tick}:${fighter.id}:knockback=${fighter.knockback},hitstun=0`);
        }
      }
    }
    expect(violations).toEqual([]);
    // Inputs stop: every freeze and hitstun must expire, leaving no stuck state.
    state = settle(state, 30);
    expect(state.hitStopTicks ?? 0).toBe(0);
    for (const fighter of state.fighters) {
      expect(fighter.hitstun).toBe(0);
      expect(fighter.knockback).toBeUndefined();
    }
  });
});

describe('M11 determinism and protocol', () => {
  const run = (initial: GameState, ticks: number): { state: GameState; events: unknown[] } => {
    let state = initial;
    const events: unknown[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      const inputs = state.fighters.map((fighter, index) => ({
        ...neutral(fighter.id),
        moveX: ((tick >> (index % 2)) % 3 - 1) as -1 | 0 | 1,
        punch: (tick + index) % 9 === 0,
        kick: (tick + index) % 13 === 0,
      }));
      state = step(state, inputs);
      events.push(...state.events);
    }
    return { state, events };
  };

  it('is deterministic: the same inputs and seed produce the same state and events', () => {
    const initial = createState(['P1', 'P2', 'P3'], 'fighting');
    const first = run(initial, 600);
    const second = run(initial, 600);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(first.state).not.toHaveProperty('hitStopTicks');
    expect(first.state.hitStopTicks ?? 0).toBe(0);
  });

  it('round-trips a snapshot in the middle of a freeze and continues identically', () => {
    const hit = step(hitState('punch'), []);
    expect(hit.hitStopTicks).toBe(HIT_STOP_TICKS);
    const restored = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: hit })).state;
    expect(restored).toEqual(hit);
    expect(encodeStateSnapshot({ version: 1, state: restored })).toBe(encodeStateSnapshot({ version: 1, state: hit }));

    const first = run(hit, 240);
    const second = run(restored, 240);
    expect(second.state).toEqual(first.state);
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
  });

  it('canonically omits zero counters and treats absent as zero', () => {
    const idle = createState(['P1', 'P2'], 'fighting');
    expect(idle).not.toHaveProperty('hitStopTicks');
    expect(idle.fighters[0]).not.toHaveProperty('knockback');

    const idleBytes = encodeStateSnapshot({ version: 1, state: idle });
    expect(idleBytes).not.toContain('hitStopTicks');
    expect(idleBytes).not.toContain('knockback');

    // Explicit zeros are accepted by the strict parser but normalised away, so
    // the canonical encoder emits the same bytes as an absent field.
    const explicitZeros = {
      ...idle,
      hitStopTicks: 0,
      fighters: idle.fighters.map(fighter => ({ ...fighter, knockback: 0 })),
    };
    const parsed = parseStateSnapshot({ version: 1, state: explicitZeros });
    expect(parsed.state).not.toHaveProperty('hitStopTicks');
    expect(parsed.state.fighters[0]).not.toHaveProperty('knockback');
    expect(encodeStateSnapshot(parsed)).toBe(idleBytes);

    // A live freeze and slide are the only cases that spend wire bytes.
    const hit = step(hitState('punch'), []);
    const activeBytes = encodeStateSnapshot({ version: 1, state: hit });
    expect(activeBytes).toContain('hitStopTicks');
    expect(activeBytes).toContain('knockback');
    expect(activeBytes.length).toBeGreaterThan(idleBytes.length);

    // Once both are zero they disappear from the encoded state again.
    const settled = settle(hit, 20);
    expect(settled).not.toHaveProperty('hitStopTicks');
    expect(settled.fighters[1]).not.toHaveProperty('knockback');
    expect(encodeStateSnapshot({ version: 1, state: settled })).not.toContain('hitStopTicks');
  });

  it('keeps the codec bounds on the new counters', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    for (const invalid of [
      { ...state, hitStopTicks: -1 },
      { ...state, hitStopTicks: 1.5 },
      { ...state, hitStopTicks: KO_HIT_STOP_TICKS + 1 },
      {
        ...state,
        fighters: state.fighters.map((fighter, index) => index === 0
          ? { ...fighter, hitstun: 0, knockback: 2 }
          : fighter),
      },
      { ...state, fighters: state.fighters.map((fighter, index) => index === 0 ? { ...fighter, knockback: NaN } : fighter) },
    ]) {
      expect(() => parseStateSnapshot({ version: 1, state: invalid })).toThrow();
    }
    const activeKnockback = {
      ...state,
      fighters: state.fighters.map((fighter, index) => index === 0
        ? { ...fighter, hitstun: 3, knockback: -4 }
        : fighter),
    };
    expect(() => parseStateSnapshot({ version: 1, state: activeKnockback })).not.toThrow();
  });
});
