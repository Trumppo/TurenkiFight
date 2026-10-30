import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createState, step, MATCH_TICKS, COUNTDOWN_TICKS, MOVES } from '../src/game/simulation/step';
import type { GameState, PlayerInput } from '../src/game/simulation/types';

const ids = ['P1', 'P2', 'P3', 'P4'] as const;
const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// xorshift32: seed and scheduling are independent of wall clock, browser and images.
function rng(seed: number): () => number {
  let x = seed >>> 0 || 0x6d2b79f5;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}
function inputFrame(random: () => number): PlayerInput[] {
  return ids.map(playerId => {
    const flags = random();
    const direction = random();
    const vertical = random();
    return { playerId,
      moveX: ((direction % 3) - 1) as -1 | 0 | 1,
      moveY: ((vertical % 3) - 1) as -1 | 0 | 1,
      jump: (flags & 31) === 0,
      punch: (flags & 7) === 0,
      kick: (flags & 15) === 1,
      jumpkick: (flags & 31) === 2 };
  });
}
function simulate(seed: number, frames = 72): { state: GameState; digest: string } {
  const random = rng(seed);
  let state = createState([...ids], 'fighting');
  const digest = createHash('sha256');
  for (let tick = 0; tick < frames; tick++) {
    const inputs = inputFrame(random);
    state = step(state, inputs);
    digest.update(JSON.stringify(state.events));
  }
  digest.update(JSON.stringify(state));
  return { state, digest: digest.digest('hex') };
}

describe('M1.5 robustness: seeded deterministic simulation', () => {
  it('replays 1,000 seeded 4-fighter match segments with identical results and event checksums', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const first = simulate(seed);
      const repeated = simulate(seed);
      expect(repeated.digest).toBe(first.digest);
      expect(repeated.state).toEqual(first.state);
      expect(first.state.tick).toBe(72);
      seen.add(first.digest);
    }
    expect(seen.size).toBeGreaterThan(900);
  }, 30000);

  it('replays a full 120-second match for selected documented seeds', () => {
    for (const seed of [1, 42, 20261030]) {
      const first = simulate(seed, MATCH_TICKS);
      const second = simulate(seed, MATCH_TICKS);
      expect(first.digest).toBe(second.digest);
      expect(first.state.phase).toBe('results');
      expect(first.state.remainingTicks).toBe(0);
      expect(first.state.tick).toBe(MATCH_TICKS);
    }
  }, 30000);

  it('completes 1,000 seeded full-length 120-second four-player matches', () => {
    // Independent full-match campaign: seeds 1..1000, 7,200 active ticks each.
    // Keep the per-tick input generation sparse to make this CI-friendly, while
    // still exercising all input sources and attack phases during every match.
    const checksums = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const random = rng(seed);
      let state = createState([...ids], 'fighting');
      const digest = createHash('sha256');
      for (let tick = 0; tick < MATCH_TICKS; tick++) {
        const frame = tick % 120 === 0 ? inputFrame(random) : [];
        state = step(state, frame);
        if (state.events.length) digest.update(JSON.stringify(state.events));
      }
      expect(state.phase).toBe('results');
      expect(state.tick).toBe(MATCH_TICKS);
      expect(state.remainingTicks).toBe(0);
      digest.update(JSON.stringify(state));
      checksums.add(digest.digest('hex'));
    }
    expect(checksums.size).toBeGreaterThan(900);
  }, 180000);

  it('credits four simultaneous attacks as two mutual KO pairs on the same tick', () => {
    const state = createState([...ids], 'fighting');
    const positions = [100, 120, 260, 280];
    for (const [i, fighter] of state.fighters.entries()) {
      fighter.x = positions[i]; fighter.y = 150; fighter.health = 10;
      fighter.facing = (i % 2 === 0 ? 1 : -1);
      fighter.attackMove = 'punch';
      fighter.attackFrames = MOVES.punch.active + MOVES.punch.recovery + 1;
    }
    const original = JSON.stringify(state);
    const next = step(state, []);
    expect(next.events.map(e => e.type)).toEqual([
      'HitLanded', 'Knockout', 'HitLanded', 'Knockout',
      'HitLanded', 'Knockout', 'HitLanded', 'Knockout',
    ]);
    expect(next.events.filter(e => e.type === 'Knockout').map(e => [e.attacker, e.target]))
      .toEqual([['P1', 'P2'], ['P2', 'P1'], ['P3', 'P4'], ['P4', 'P3']]);
    expect(next.fighters.map(f => f.score)).toEqual([400, 400, 400, 400]);
    expect(next.fighters.map(f => f.koCount)).toEqual([1, 1, 1, 1]);
    expect(next.fighters.map(f => f.koTimer)).toEqual([180, 180, 180, 180]);
    expect(hash(next)).toBe(hash(step(state, [])));
    expect(JSON.stringify(state)).toBe(original);
  });

  it('respawn occurs after 180 ticks, protection persists and cancels upon attacking', () => {
    let state = createState([...ids], 'fighting');
    state.fighters[0].koTimer = 180; state.fighters[0].health = 0;
    for (let i = 0; i < 179; i++) state = step(state, []);
    expect(state.fighters[0].health).toBe(0);
    state = step(state, []);
    expect(state.fighters[0].health).toBe(100);
    expect(state.fighters[0].protection).toBe(90);
    const protectedState = step(state, []);
    expect(protectedState.fighters[0].protection).toBe(89);
    state = step(protectedState, [{ ...neutral('P1'), punch: true }]);
    expect(state.fighters[0].protection).toBe(0);
  });

  it('ends precisely at countdown 180 plus active tick 7200 and freezes the result', () => {
    let state = createState([...ids]);
    for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) state = step(state, []);
    expect(state.phase).toBe('fighting');
    expect(state.remainingTicks).toBe(MATCH_TICKS);
    for (let tick = 0; tick < MATCH_TICKS - 1; tick++) state = step(state, []);
    expect(state.phase).toBe('fighting');
    expect(state.remainingTicks).toBe(1);
    state = step(state, []);
    expect(state.phase).toBe('results');
    expect(state.remainingTicks).toBe(0);
    const score = state.fighters.map(f => f.score);
    expect(step(state, ids.map(neutral)).fighters.map(f => f.score)).toEqual(score);
  });

  it('accepts identical device-agnostic PlayerInput from test, future bot or network adapter', () => {
    const start = createState([...ids], 'fighting');
    const frame = ids.map(id => ({ ...neutral(id), punch: id === 'P1' }));
    const fromKeyboard = step(start, frame);
    const fromGamepad = step(start, structuredClone(frame));
    const fromBot = step(start, structuredClone(frame));
    expect(hash(fromKeyboard)).toBe(hash(fromGamepad));
    expect(hash(fromKeyboard)).toBe(hash(fromBot));
    // A disconnected controller is represented by a neutral frame (or omitted input).
    expect(step(start, [neutral('P1')]).fighters).toEqual(step(start, []).fighters);
  });
});
