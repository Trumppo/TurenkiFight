import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { COUNTDOWN_TICKS, MATCH_TICKS, createState, step } from '../src/game/simulation/step';
import { botInput, botNeutralInput } from '../src/game/input/botPolicy';
import type { GameEvent, GameState, ModeId, PlayerInput } from '../src/game/simulation/types';

const BOT_SEED = 0x5eed;
const BOT_IDS = ['P2', 'P3', 'P4'] as const;

const neutral = (playerId: string): PlayerInput => ({ playerId, moveX: 0, moveY: 0, jump: false });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fighterPosition(state: GameState, id: string, x: number, y: number, facing: 1 | -1 = 1): GameState {
  return {
    ...state,
    fighters: state.fighters.map(fighter => fighter.id === id ? { ...fighter, x, y, facing } : fighter),
  };
}

/** A deterministic human input trace; keeps P1 fighting but out of the bots' way. */
function humanInput(state: GameState): PlayerInput {
  return {
    playerId: 'P1',
    moveX: Math.floor(state.tick / 90) % 2 ? 1 : -1,
    moveY: 0,
    jump: state.tick % 137 === 0,
    punch: state.tick % 53 === 0,
    kick: state.tick % 211 === 0,
  };
}

function runBotMatch(mode: ModeId): { state: GameState; events: GameEvent[]; ticks: number } {
  let state = createState({ ids: ['P1', 'P2', 'P3', 'P4'], phase: 'countdown', mode });
  const events: GameEvent[] = [];
  const limit = COUNTDOWN_TICKS + MATCH_TICKS + 10;
  let ticks = 0;
  while (state.phase !== 'results' && ticks < limit) {
    const inputs = [humanInput(state), ...BOT_IDS.map(id => botInput(state, id, BOT_SEED))];
    state = step(state, inputs);
    events.push(...state.events);
    ticks++;
  }
  return { state, events, ticks };
}

describe('M8 bot policy', () => {
  it('is pure: same state, player and seed give the same input and never mutate the state', () => {
    const state = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting' });
    const before = JSON.stringify(state);
    const first = botInput(state, 'P2', 123);
    const second = botInput(state, 'P2', 123);
    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('varies deterministically with the seed across ticks', () => {
    const base = createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    const inRange = fighterPosition(fighterPosition(base, 'P1', 120, 160, -1), 'P2', 100, 160, 1);
    const sample = (seed: number) => {
      const seen: string[] = [];
      for (let tick = 0; tick < 96; tick++) {
        const state = { ...inRange, tick };
        seen.push(JSON.stringify(botInput(state, 'P2', seed)));
      }
      return seen;
    };
    const first = sample(7);
    expect(sample(7)).toEqual(first);
    expect(sample(8)).not.toEqual(first);
  });

  it('moves toward the nearest living opponent in both axes', () => {
    const base = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting' });
    const state = fighterPosition(
      fighterPosition(fighterPosition(base, 'P1', 300, 160, -1), 'P3', 40, 140, 1),
      'P2', 200, 190, 1,
    );
    // P2 is nearest to P1 (dx +100) and must move right and up, not toward P3.
    expect(botInput(state, 'P2', BOT_SEED)).toMatchObject({ moveX: 1, moveY: -1 });
    // Once P1 is eliminated, the only living opponent is P3 on the left.
    const afterElimination = {
      ...state,
      fighters: state.fighters.map(fighter => fighter.id === 'P1' ? { ...fighter, eliminated: true } : fighter),
    };
    expect(botInput(afterElimination, 'P2', BOT_SEED)).toMatchObject({ moveX: -1, moveY: -1 });
  });

  it('jumps occasionally while approaching instead of every tick', () => {
    const base = createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    const far = fighterPosition(fighterPosition(base, 'P1', 360, 160, -1), 'P2', 40, 160, 1);
    let jumps = 0;
    for (let tick = 0; tick < 2000; tick++) {
      if (botInput({ ...far, tick }, 'P2', BOT_SEED).jump) jumps++;
    }
    expect(jumps).toBeGreaterThan(0);
    expect(jumps).toBeLessThan(200);
  });

  it('attacks when the opponent is inside reach and depth, and not while facing away', () => {
    const base = createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    const inRange = fighterPosition(fighterPosition(base, 'P1', 120, 160, -1), 'P2', 100, 160, 1);
    // A jump-in may replace a ground attack inside the band, so sample a short
    // window: the bot must still choose punch/kick when it stays grounded.
    const decisions = Array.from({ length: 12 }, (_, tick) => botInput({ ...inRange, tick }, 'P2', BOT_SEED));
    expect(decisions.some(input => input.punch || input.kick)).toBe(true);
    expect(decisions.every(input => input.jumpkick === false)).toBe(true);

    const behind = fighterPosition(fighterPosition(base, 'P1', 40, 160, -1), 'P2', 60, 160, 1);
    const noAttacks = Array.from({ length: 12 }, (_, tick) => botInput({ ...behind, tick }, 'P2', BOT_SEED));
    expect(noAttacks.every(input => !input.punch && !input.kick && !input.jumpkick)).toBe(true);
  });

  it('returns neutral input for eliminated, knocked-out, orphaned and non-fighting bots', () => {
    const base = createState({ ids: ['P1', 'P2', 'P3'], phase: 'fighting' });
    const neutralFor = (state: GameState, id = 'P2') => {
      const input = botInput(state, id, BOT_SEED);
      expect(input).toEqual(botNeutralInput(id));
    };
    neutralFor({ ...base, fighters: base.fighters.map(f => f.id === 'P2' ? { ...f, eliminated: true } : f) });
    neutralFor({ ...base, fighters: base.fighters.map(f => f.id === 'P2' ? { ...f, koTimer: 1 } : f) });
    neutralFor({ ...base, fighters: base.fighters.filter(f => f.id !== 'P2') });
    neutralFor({ ...base, phase: 'lobby' });
    neutralFor({ ...base, phase: 'results' });
    // No living opponent left: a bot has nothing to attack.
    neutralFor({ ...base, fighters: base.fighters.map(f => f.id === 'P2' ? f : { ...f, eliminated: true }) });
  });
});

describe('M8 bots fight in the simulation', () => {
  it('lands hits within a bounded number of ticks instead of idling', () => {
    let state = createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    const start = state.fighters.find(f => f.id === 'P2')!;
    const hitTicks: number[] = [];
    for (let tick = 0; tick < 1200 && state.phase !== 'results'; tick++) {
      state = step(state, [neutral('P1'), botInput(state, 'P2', BOT_SEED)]);
      hitTicks.push(...state.events.filter(event => event.type === 'HitLanded' && event.attacker === 'P2').map(event => event.tick));
    }
    const bot = state.fighters.find(f => f.id === 'P2')!;
    const human = state.fighters.find(f => f.id === 'P1')!;
    expect(hitTicks.length).toBeGreaterThan(0);
    expect(hitTicks[0]).toBeLessThan(600);
    expect(human.hitsReceived).toBeGreaterThan(0);
    expect(human.health).toBeLessThan(100);
    expect(bot.x).not.toBe(start.x);
  });

  it('Score Brawl: bot hits score points, KOs earn score and the KO respawns', () => {
    let state = createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    state = fighterPosition(state, 'P2', 100, 160, 1);
    state = fighterPosition(state, 'P1', 125, 160, -1);
    state = { ...state, fighters: state.fighters.map(f => f.id === 'P1' ? { ...f, health: 10 } : f) };
    // A jump-in can replace the first attack and delay the KO by one jump arc,
    // so allow a few hundred ticks while still failing on a non-fighting bot.
    for (let tick = 0; tick < 240 && !state.fighters.find(f => f.id === 'P2')!.koCount; tick++) {
      state = step(state, [neutral('P1'), botInput(state, 'P2', BOT_SEED)]);
    }
    const bot = state.fighters.find(f => f.id === 'P2')!;
    const human = state.fighters.find(f => f.id === 'P1')!;
    expect(bot.score).toBeGreaterThanOrEqual(500);
    expect(bot.koCount).toBe(1);
    expect(human.koTimer).toBeGreaterThan(0);
    for (let tick = 0; tick < 181; tick++) state = step(state, [neutral('P1'), botInput(state, 'P2', BOT_SEED)]);
    expect(state.fighters.find(f => f.id === 'P1')!.health).toBe(100);
    expect(state.fighters.find(f => f.id === 'P1')!.protection).toBeGreaterThan(0);
  });

  it('Last Man Standing: a bot KO eliminates it permanently and the match ends', () => {
    let state = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'last-man-standing' });
    state = fighterPosition(state, 'P1', 100, 160, 1);
    state = fighterPosition(state, 'P2', 125, 160, -1);
    // P2 is in hit recovery, so it cannot jump over P1's punch. This keeps the
    // test about elimination and respawn rules rather than about jump timing.
    state = { ...state, fighters: state.fighters.map(f => f.id === 'P2' ? { ...f, health: 10, hitstun: 6 } : f) };
    for (let tick = 0; tick < 20 && state.phase !== 'results'; tick++) {
      state = step(state, [tick === 0 ? { ...neutral('P1'), punch: true } : neutral('P1'), botInput(state, 'P2', BOT_SEED)]);
    }
    const bot = state.fighters.find(f => f.id === 'P2')!;
    expect(bot.eliminated).toBe(true);
    expect(bot.koTimer).toBe(0);
    expect(state.phase).toBe('results');
    expect(state.events.find(event => event.type === 'MatchEnded')).toMatchObject({ reason: 'elimination', winner: 'P1' });
    expect(botInput(state, 'P2', BOT_SEED)).toEqual(botNeutralInput('P2'));
  });

  it('Deathmatch: a bot earns a frag, then keeps playing after the target respawns', () => {
    let state = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
    state = fighterPosition(state, 'P2', 100, 160, 1);
    state = fighterPosition(state, 'P1', 125, 160, -1);
    state = { ...state, fighters: state.fighters.map(f => f.id === 'P1' ? { ...f, health: 10 } : f) };
    for (let tick = 0; tick < 40 && (state.fighters.find(f => f.id === 'P2')!.frags ?? 0) === 0; tick++) {
      state = step(state, [neutral('P1'), botInput(state, 'P2', BOT_SEED)]);
    }
    expect(state.fighters.find(f => f.id === 'P2')!.frags).toBe(1);
    expect(state.fighters.find(f => f.id === 'P1')!.deaths).toBe(1);
    for (let tick = 0; tick < 181; tick++) state = step(state, [neutral('P1'), botInput(state, 'P2', BOT_SEED)]);
    expect(state.fighters.find(f => f.id === 'P1')!.health).toBe(100);
    expect(state.phase).not.toBe('results');
  });
});

describe('M8 bot match determinism', () => {
  for (const mode of ['score-brawl', 'last-man-standing', 'deathmatch'] as const) {
    it(`replays a four-player ${mode} bot match with identical state and ordered events`, () => {
      const first = runBotMatch(mode);
      const second = runBotMatch(mode);
      expect(second.ticks).toBe(first.ticks);
      expect(second.state).toEqual(first.state);
      expect(second.events).toEqual(first.events);
      expect(first.state.phase).toBe('results');
      expect(first.ticks).toBeLessThanOrEqual(COUNTDOWN_TICKS + MATCH_TICKS);
      expect(hash(first.state)).toBe(hash(second.state));
      expect(hash(first.events)).toBe(hash(second.events));
    });
  }

  it('pins the four-player Score Brawl bot replay hashes', () => {
    const run = runBotMatch('score-brawl');
    // M12 bot mobility changed both pins: jump-ins and evasive hops alter the
    // approach timings and the ordered event stream. Old state
    // f0dd005875e324dfee537229610322a8244d29062d81b4fea357374e68deab8d.
    // Old events 77c6ec27349433eac34df9d827e0f78ccb1691f27beeb2882c0673c30a3b783c.
    expect(hash(run.state)).toBe('82bbd3e105d1ce784c69f94dfe2dffd8d76830bbbdbc14a8237e63ab5848925f');
    expect(hash(run.events)).toBe('36dae47bfe81e2c8b8f8ba377c2c1dafd656acbc749b4eb676f8b36893e6b32e');
  });
});
