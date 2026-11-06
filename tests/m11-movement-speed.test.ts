import { describe, expect, it } from 'vitest';
import { FIGHTER_SPEED, FIGHTER_SPEED_PX_PER_SECOND, TICK_RATE, createState, step } from '../src/game/simulation/step';
import { botInput } from '../src/game/input/botPolicy';
import type { GameState, PlayerInput } from '../src/game/simulation/types';

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });

describe('M11 movement speed (+20 %)', () => {
  it('moves each axis at 1.56 px/tick, which is 93.6 px/s at 60 Hz', () => {
    expect(FIGHTER_SPEED).toBe(1.56);
    expect(FIGHTER_SPEED_PX_PER_SECOND).toBeCloseTo(93.6, 10);
    expect(FIGHTER_SPEED / 1.3).toBeCloseTo(1.2, 12);

    const start = { ...createState(), phase: 'fighting' as const };
    const right = step(start, [{ ...neutral('P1'), moveX: 1 }]).fighters[0];
    const down = step(start, [{ ...neutral('P1'), moveY: 1 }]).fighters[0];
    expect(right.x - start.fighters[0].x).toBeCloseTo(FIGHTER_SPEED, 12);
    expect(down.y - start.fighters[0].y).toBeCloseTo(FIGHTER_SPEED, 12);
  });

  it('normalises diagonal movement so it is not faster than axis movement', () => {
    const start = { ...createState(), phase: 'fighting' as const };
    const cardinal = step(start, [{ ...neutral('P1'), moveX: 1 }]).fighters[0];
    const diagonal = step(start, [{ ...neutral('P1'), moveX: 1, moveY: 1 }]).fighters[0];
    const cardinalDistance = cardinal.x - start.fighters[0].x;
    const diagonalDistance = Math.hypot(
      diagonal.x - start.fighters[0].x,
      diagonal.y - start.fighters[0].y,
    );
    expect(diagonalDistance).toBeCloseTo(cardinalDistance, 10);
    expect(diagonalDistance).toBeCloseTo(FIGHTER_SPEED, 10);
  });

  it('keeps all eight fighters inside the arena when they hold diagonal input at every corner', () => {
    // Two fighters per corner, each starting just inside the arena and holding
    // diagonal input outward. Bounds are x [16, 368] and y [124, 204].
    const corners = [
      { startX: 20, startY: 128, x: 16, y: 124, moveX: -1, moveY: -1 },
      { startX: 20, startY: 200, x: 16, y: 204, moveX: -1, moveY: 1 },
      { startX: 364, startY: 128, x: 368, y: 124, moveX: 1, moveY: -1 },
      { startX: 364, startY: 200, x: 368, y: 204, moveX: 1, moveY: 1 },
    ] as const;
    const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    let state: GameState = createState(ids, 'fighting');
    state = {
      ...state,
      fighters: state.fighters.map((fighter, index) => {
        const corner = corners[index % corners.length];
        return { ...fighter, x: corner.startX, y: corner.startY };
      }),
    };

    for (let tick = 0; tick < 240; tick++) {
      state = step(state, state.fighters.map((fighter, index) => {
        const corner = corners[index % corners.length];
        return { ...neutral(fighter.id), moveX: corner.moveX, moveY: corner.moveY };
      }));
    }

    for (const [index, fighter] of state.fighters.entries()) {
      const corner = corners[index % corners.length];
      expect(fighter.x, fighter.id).toBeGreaterThanOrEqual(16);
      expect(fighter.x, fighter.id).toBeLessThanOrEqual(368);
      expect(fighter.y, fighter.id).toBeGreaterThanOrEqual(124);
      expect(fighter.y, fighter.id).toBeLessThanOrEqual(204);
      // Outward diagonal input must pin the fighter exactly on its corner.
      expect(fighter.x, fighter.id).toBe(corner.x);
      expect(fighter.y, fighter.id).toBe(corner.y);
    }
  });

  it('moves a bot through the same movement code at the human speed', () => {
    const base = createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    const state: GameState = {
      ...base,
      fighters: base.fighters.map(fighter => fighter.id === 'P1'
        ? { ...fighter, x: 200, y: 160, facing: 1 as const }
        : { ...fighter, x: 100, y: 160, facing: 1 as const }),
    };
    const botMove = botInput(state, 'P2', 0x5eed);
    expect(botMove.moveX).toBe(1);
    expect(botMove.moveY).toBe(0);
    const next = step(state, [neutral('P1'), botMove]);
    const moved = next.fighters.find(fighter => fighter.id === 'P2')!;
    expect(moved.x - state.fighters.find(fighter => fighter.id === 'P2')!.x).toBeCloseTo(FIGHTER_SPEED, 12);
  });

  it('is deterministic: the same inputs produce the same final state twice', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const run = () => {
      let state = createState({ ids, phase: 'fighting', mode: 'deathmatch' });
      const events: unknown[] = [];
      for (let tick = 0; tick < 900; tick++) {
        const inputs = ids.map((id, index) => ({
          playerId: id,
          moveX: ((tick >> (index % 3)) % 3 - 1) as -1 | 0 | 1,
          moveY: ((tick >> ((index + 1) % 3)) % 3 - 1) as -1 | 0 | 1,
          jump: (tick + index) % 97 === 0,
          punch: (tick + index) % 43 === 0,
          kick: (tick + index) % 71 === 0,
        }));
        state = step(state, inputs);
        events.push(...state.events);
        if (state.phase === 'results') break;
      }
      return { state, events };
    };

    const first = run();
    const second = run();
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
  });

  it('derives px/s from the single speed constant and the fixed tick rate', () => {
    expect(TICK_RATE).toBe(60);
    expect(FIGHTER_SPEED_PX_PER_SECOND).toBe(FIGHTER_SPEED * TICK_RATE);
  });
});
