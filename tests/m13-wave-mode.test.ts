import { describe, expect, it } from 'vitest';
import {
  ARENA_BOUNDS,
  COUNTDOWN_TICKS,
  MODE_RULES,
  MOVES,
  WAVE_RULES,
  createState,
  modeWinner,
  step,
} from '../src/game/simulation/step';
import { rankMatch } from '../src/game/simulation/ranking';
import { botInput, botInputs } from '../src/game/input/botPolicy';
import {
  decodeStateSnapshot,
  encodeStateSnapshot,
  MAX_SNAPSHOT_FIGHTERS,
  parseStateSnapshot,
} from '../src/game/protocol/stateSnapshot';
import { END_REASONS, parseGameEvent } from '../src/game/protocol/gameEvent';
import { stateSnapshotFingerprint } from '../src/game/protocol/fingerprint';
import type { Fighter, GameState, Move, PlayerInput, Team } from '../src/game/simulation/types';
import {
  SCORE_BRAWL_FIGHTING_BYTES,
  SCORE_BRAWL_FIGHTING_FINGERPRINT,
} from './fixtures/scoreBrawlSnapshotBytes';
import {
  FOUR_PLAYER_SCORE_BRAWL_FIGHTING_BYTES,
  FOUR_PLAYER_SCORE_BRAWL_FIGHTING_SHA256,
} from './fixtures/fourPlayerScoreBrawlBytes';

const ROSTER = ['P1', 'P2', 'E1', 'E2'] as const;
const TEAMS: Readonly<Record<string, Team>> = {
  P1: 'players',
  P2: 'players',
  E1: 'enemies',
  E2: 'enemies',
};

const wave = (phase: GameState['phase'] = 'fighting'): GameState =>
  createState({ ids: [...ROSTER], phase, mode: 'wave', teams: TEAMS });

/**
 * Pinned fingerprint of the seeded all-bot wave fixture (four fighters, 900
 * ticks, seed 20261106). Captured from the M13 implementation; update only
 * deliberately with the old and new value in the PR notes.
 */
const WAVE_MATCH_FINGERPRINT = '3d978e84';

const fighter = (state: GameState, id: string): Fighter => {
  const found = state.fighters.find(item => item.id === id);
  if (!found) throw new Error(`Missing fighter ${id}`);
  return found;
};

const advance = (state: GameState, ticks: number, inputs: PlayerInput[] = []): GameState => {
  let current = state;
  for (let tick = 0; tick < ticks; tick++) current = step(current, inputs);
  return current;
};

/**
 * Put the attacker just left of the target and start a punch that is already
 * in its active frames. Used to drive hits without depending on input timing.
 */
function attackTick(
  state: GameState,
  attackerId: string,
  targetId: string,
  move: Move = 'punch',
  targetHealth = 100,
): GameState {
  const target = fighter(state, targetId);
  const profile = MOVES[move];
  const x = Math.max(ARENA_BOUNDS.minX, target.x - 20);
  const fighters = state.fighters.map(item => {
    if (item.id === attackerId) {
      return {
        ...item, x, y: target.y, z: target.z, vz: 0, facing: 1 as const,
        health: 100, koTimer: 0, hitstun: 0, protection: 0,
        attackMove: move, attackFrames: profile.startup + profile.active + profile.recovery - profile.startup,
        attackCooldown: profile.startup + profile.active + profile.recovery,
        hitTargets: [],
      };
    }
    if (item.id === targetId) return { ...item, health: targetHealth, protection: 0 };
    return item;
  });
  return step({ ...state, fighters }, []);
}

const knockout = (state: GameState, attackerId: string, targetId: string): GameState =>
  attackTick(state, attackerId, targetId, 'punch', 1);

const endEvent = (state: GameState) => {
  const ended = [...state.events].reverse().find(event => event.type === 'MatchEnded');
  if (!ended) throw new Error('MatchEnded missing');
  return ended;
};

describe('Team filtering (ADR 0005)', () => {
  it('never damages a teammate with punch, kick or jumpkick', () => {
    for (const move of ['punch', 'kick', 'jumpkick'] as const) {
      const start = wave();
      const hit = attackTick(start, 'P1', 'P2', move);
      const teammate = fighter(hit, 'P2');
      expect(teammate.health).toBe(100);
      expect(teammate.hitsReceived).toBe(0);
      expect(hit.events.some(event => event.type === 'HitLanded')).toBe(false);

      // The same setup on the other team still lands, so the filter is not
      // accidentally disabling combat.
      const hostile = attackTick(wave(), 'P1', 'E1', move);
      expect(fighter(hostile, 'E1').health).toBe(100 - MOVES[move].damage);
      expect(hostile.events).toContainEqual(expect.objectContaining({
        type: 'HitLanded', attacker: 'P1', target: 'E1', move,
      }));
    }
  });

  it('never damages a teammate with a thrown bottle', () => {
    const base = wave();
    const withPositions = (targetId: 'P2' | 'E1'): GameState => ({
      ...base,
      fighters: base.fighters.map(item =>
        item.id === 'P2' ? { ...item, x: targetId === 'P2' ? 120 : 300, y: 148 }
          : item.id === 'E1' ? { ...item, x: targetId === 'E1' ? 120 : 300, y: 148 } : item),
    });
    const bottle = {
      id: 'O1', kind: 'bottle' as const, x: 118, y: 148, z: 12,
      state: 'airborne' as const, holder: 'P1', spawnTick: 0, vx: 3, vz: 2,
    };
    const friendly = step({ ...withPositions('P2'), objects: [{ ...bottle }] }, []);
    expect(fighter(friendly, 'P2').health).toBe(100);
    expect(friendly.objects?.[0].state).toBe('airborne');

    // The same throw aimed at the enemy slot instead still lands and breaks.
    const hostile = step({ ...withPositions('E1'), objects: [{ ...bottle }] }, []);
    expect(fighter(hostile, 'E1').health).toBe(80);
    expect(hostile.objects).toBeUndefined();
  });
});

describe('Wave lifecycle', () => {
  it('pins the first-slice timing constants', () => {
    expect(WAVE_RULES).toEqual({
      count: 3,
      countdownTicks: 120,
      firstWaveEnemies: 1,
      enemyTeam: 'enemies',
      scoringTeam: 'players',
    });
    expect(MODE_RULES.wave.wave).toEqual(WAVE_RULES);
    expect(MODE_RULES.wave.tieBreak).toEqual(['score']);
    expect(COUNTDOWN_TICKS).toBe(180);
  });

  it('starts wave 1 immediately with one enemy and keeps later slots out', () => {
    const state = wave();
    expect(state.mode).toBe('wave');
    expect(state.wave).toEqual({ index: 0, countdownTicks: 0, remaining: 1 });
    expect(fighter(state, 'E1').eliminated).toBeUndefined();
    expect(fighter(state, 'E1').health).toBe(100);
    expect(fighter(state, 'E2').eliminated).toBe(true);
    expect(fighter(state, 'E2').health).toBe(0);
  });

  it('clears a wave, counts down exactly and revives the active enemies at spawn points', () => {
    const start = wave();
    const spawnE1 = { x: fighter(start, 'E1').x, y: fighter(start, 'E1').y };
    const spawnE2 = { x: fighter(start, 'E2').x, y: fighter(start, 'E2').y };

    let state = knockout(start, 'P1', 'E1');
    expect(state.phase).toBe('fighting');
    expect(fighter(state, 'E1').eliminated).toBe(true);
    expect(state.wave).toEqual({ index: 1, countdownTicks: WAVE_RULES.countdownTicks, remaining: 0 });

    state = advance(state, WAVE_RULES.countdownTicks - 1);
    expect(state.wave).toEqual({ index: 1, countdownTicks: 1, remaining: 0 });

    state = step(state, []);
    expect(state.wave).toEqual({ index: 1, countdownTicks: 0, remaining: 2 });
    expect(state.events.filter(event => event.type === 'Respawned').map(event => event.target))
      .toEqual(['E1', 'E2']);
    expect({ x: fighter(state, 'E1').x, y: fighter(state, 'E1').y }).toEqual(spawnE1);
    expect({ x: fighter(state, 'E2').x, y: fighter(state, 'E2').y }).toEqual(spawnE2);
    expect(fighter(state, 'E1').eliminated).toBeUndefined();
    expect(fighter(state, 'E2').eliminated).toBeUndefined();
    expect(fighter(state, 'E1').protection).toBe(90);
  });

  it('ends a three-wave match with waves-cleared and ranks by score', () => {
    let state = wave();
    // Wave 1 has one enemy.
    state = knockout(state, 'P1', 'E1');
    state = advance(state, WAVE_RULES.countdownTicks);
    // Wave 2 has two enemies.
    state = knockout(state, 'P1', 'E1');
    state = knockout(state, 'P1', 'E2');
    expect(state.wave).toEqual({ index: 2, countdownTicks: WAVE_RULES.countdownTicks, remaining: 0 });
    state = advance(state, WAVE_RULES.countdownTicks);
    expect(state.wave).toEqual({ index: 2, countdownTicks: 0, remaining: 2 });
    // Wave 3 is capped by the two enemy slots.
    state = knockout(state, 'P1', 'E1');
    state = knockout(state, 'P1', 'E2');

    expect(state.phase).toBe('results');
    expect(state.wave).toEqual({ index: 3, countdownTicks: 0, remaining: 0 });
    const ended = endEvent(state);
    expect(ended).toMatchObject({ reason: 'waves-cleared', winner: 'P1' });
    const ranking = rankMatch(state, [...state.events]);
    expect(ranking.draw).toBe(false);
    expect(ranking.winners).toEqual(['P1']);
    expect(ranking.order[0]).toMatchObject({ id: 'P1', rank: 1, metric: 3000 });
    // The enemy slots only lose the Score Brawl target penalty when a player
    // knocks them out; enemy attacks never write score in either direction.
    expect(fighter(state, 'E1').score).toBe(-600);
    expect(fighter(state, 'E2').score).toBe(-400);
  });

  it('scores each player for their own knockouts and draws when the top score is tied', () => {
    let state = wave();
    state = knockout(state, 'P1', 'E1');
    state = advance(state, WAVE_RULES.countdownTicks);
    state = knockout(state, 'P2', 'E1');
    state = knockout(state, 'P2', 'E2');
    state = advance(state, WAVE_RULES.countdownTicks);
    state = knockout(state, 'P1', 'E1');
    state = knockout(state, 'P1', 'E2');

    expect(state.phase).toBe('results');
    // P1 scored three KOs, P2 two; the enemy slots only carry the target penalty.
    expect(fighter(state, 'P1').score).toBe(1800);
    expect(fighter(state, 'P2').score).toBe(1200);
    expect(endEvent(state)).toMatchObject({ reason: 'waves-cleared', winner: 'P1' });

    // Ranking shares the top place only on an exact score tie, and the winner
    // rule is score-only (a tie is a draw, not a KOs/hits-received tie-break).
    const tied = wave('results').fighters.map(item => ({ ...item, score: item.team === 'players' ? 600 : 0 }));
    expect(modeWinner(tied, MODE_RULES.wave)).toBeNull();
    expect(modeWinner(tied.map(item => item.id === 'P1' ? { ...item, score: 700 } : item), MODE_RULES.wave)).toBe('P1');
  });

  it('ends on the timer with time and a score ranking when no wave is cleared', () => {
    let state = { ...wave(), remainingTicks: 1 };
    state = step(state, []);
    expect(state.phase).toBe('results');
    expect(state.remainingTicks).toBe(0);
    const ended = endEvent(state);
    expect(ended).toMatchObject({ reason: 'time', winner: null });
    const ranking = rankMatch(state, [...state.events]);
    expect(ranking.draw).toBe(true);
    expect(ranking.order.every(entry => entry.rank === 1)).toBe(true);
  });

  it('never eliminates a player and respawns them after the normal KO timer', () => {
    let state = attackTick(wave(), 'E1', 'P2', 'punch', 1);
    expect(fighter(state, 'P2').health).toBe(0);
    expect(fighter(state, 'P2').eliminated).toBeUndefined();
    expect(fighter(state, 'P2').koTimer).toBe(180);
    // Enemy KOs on players do not score: no hit points and no KO credit.
    expect(fighter(state, 'E1').score).toBe(0);
    expect(fighter(state, 'P2').score).toBe(0);
    expect(fighter(state, 'E1').koCount).toBe(1);

    state = advance(state, 180);
    expect(fighter(state, 'P2').health).toBe(100);
    expect(fighter(state, 'P2').koTimer).toBe(0);
    expect(state.events.map(event => event.type)).toContain('Respawned');
  });

  it('counts down during hit stop so wave timing stays a function of ticks', () => {
    let state = knockout(wave(), 'P1', 'E1');
    expect(state.hitStopTicks).toBe(5);
    const before = state.wave?.countdownTicks ?? 0;
    state = step(state, []);
    expect(state.wave?.countdownTicks).toBe(before - 1);
  });
});

describe('Wave bots and determinism', () => {
  it('targets the opposing team and never a teammate', () => {
    const base = wave();
    const fighters = base.fighters.map(item =>
      item.id === 'P1' ? { ...item, x: 100, y: 148, facing: 1 as const }
        : item.id === 'P2' ? { ...item, x: 120, y: 148 }
          : item.id === 'E1' ? { ...item, x: 350, y: 148 } : item);
    const state = { ...base, fighters };

    // P2 is adjacent but allied; the player bot walks toward the far enemy.
    const playerBot = botInput(state, 'P1', 7);
    expect(playerBot.moveX).toBe(1);
    expect(playerBot.punch).toBe(false);
    expect(playerBot.kick).toBe(false);
    expect(playerBot.jumpkick).toBe(false);

    // The enemy bot walks toward the nearest player, never its ally E2.
    const enemyBot = botInput(state, 'E1', 7);
    expect(enemyBot.moveX).toBe(-1);
  });

  it('replays a seeded all-bot wave match to the same fingerprint and codec round-trip', () => {
    const run = (ticks: number): GameState => {
      let state = wave();
      for (let tick = 0; tick < ticks; tick++) {
        state = step(state, botInputs(state, [...ROSTER], 20261106));
      }
      return state;
    };
    const first = run(900);
    const second = run(900);
    expect(stateSnapshotFingerprint({ version: 1, state: second }))
      .toBe(stateSnapshotFingerprint({ version: 1, state: first }));

    let original = run(600);
    let restored = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: original })).state;
    for (let tick = 0; tick < 300; tick++) {
      const inputs = botInputs(original, [...ROSTER], 20261106);
      original = step(original, inputs);
      restored = step(restored, inputs);
    }
    expect(restored).toEqual(original);
    expect(stateSnapshotFingerprint({ version: 1, state: original })).toBe(WAVE_MATCH_FINGERPRINT);
  });
});

describe('Wave wire shape', () => {
  it('round-trips teams and wave progress and omits them outside wave mode', () => {
    const state = wave();
    const encoded = encodeStateSnapshot({ version: 1, state });
    expect(encoded).toContain('"mode":"wave"');
    expect(encoded).toContain('"wave":{"countdownTicks":0,"index":0,"remaining":1}');
    expect(encoded).toContain('"team":"players"');
    expect(decodeStateSnapshot(encoded)).toEqual({ version: 1, state });

    // Existing modes keep their pinned bytes: no team and no wave field.
    expect(encodeStateSnapshot({ version: 1, state: createState(['P1', 'P2'], 'fighting') }))
      .toBe(SCORE_BRAWL_FIGHTING_BYTES);
    expect(stateSnapshotFingerprint({ version: 1, state: createState(['P1', 'P2'], 'fighting') }))
      .toBe(SCORE_BRAWL_FIGHTING_FINGERPRINT);
    expect(encodeStateSnapshot({ version: 1, state: createState(['P1', 'P2', 'P3', 'P4'], 'fighting') }))
      .toBe(FOUR_PLAYER_SCORE_BRAWL_FIGHTING_BYTES);
    expect(FOUR_PLAYER_SCORE_BRAWL_FIGHTING_SHA256)
      .toBe('1d23bad2d6686a6196d3267a608c6b9c12ebd0ec84af2dbc7b5691538fc603f7');
    const scoreBrawlBytes = encodeStateSnapshot({ version: 1, state: createState(['P1', 'P2'], 'fighting') });
    expect(scoreBrawlBytes).not.toContain('"team"');
    expect(scoreBrawlBytes).not.toContain('"wave"');
  });

  it('accepts waves-cleared only as a match end reason', () => {
    expect(END_REASONS).toContain('waves-cleared');
    expect(parseGameEvent({ tick: 5, type: 'MatchEnded', reason: 'waves-cleared', winner: 'P1' }, 5))
      .toEqual({ tick: 5, type: 'MatchEnded', reason: 'waves-cleared', winner: 'P1' });
    expect(() => parseGameEvent({ tick: 5, type: 'HitLanded', attacker: 'P1', target: 'E1', move: 'punch', reason: 'waves-cleared' }, 5))
      .toThrow();
  });

  it('rejects wave fields outside wave mode and malformed wave progress', () => {
    const base = wave();
    const scoreBrawl = createState(['P1', 'P2'], 'fighting');
    const rejects = (state: unknown) => expect(() => parseStateSnapshot({ version: 1, state })).toThrow(/Malformed/);

    rejects({ ...scoreBrawl, wave: { index: 0, countdownTicks: 0, remaining: 0 } });
    rejects({ ...base, mode: undefined, wave: undefined });
    const withoutWave = { ...base } as Record<string, unknown>;
    delete withoutWave.wave;
    rejects(withoutWave);
    // Wave state extra/unknown fields, wrong types and out-of-range values.
    rejects({ ...base, wave: { index: 0, countdownTicks: 0, remaining: 1, extra: true } });
    rejects({ ...base, wave: { index: WAVE_RULES.count + 1, countdownTicks: 0, remaining: 1 } });
    rejects({ ...base, wave: { index: 0, countdownTicks: WAVE_RULES.countdownTicks + 1, remaining: 1 } });
    rejects({ ...base, wave: { index: -1, countdownTicks: 0, remaining: 1 } });
    rejects({ ...base, wave: { index: 0, countdownTicks: 0, remaining: -1 } });
    rejects({ ...base, wave: { index: 0, countdownTicks: 0, remaining: MAX_SNAPSHOT_FIGHTERS + 1 } });
    rejects({ ...base, wave: { index: 0, countdownTicks: 0, remaining: 2 } });

    // A wave state needs a team on every fighter and both sides present.
    const noTeam = base.fighters.map(item => item.id === 'P2'
      ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'team'))
      : item);
    rejects({ ...base, fighters: noTeam });
    const badTeam = base.fighters.map(item => item.id === 'P2' ? { ...item, team: 'neutrals' } : item);
    rejects({ ...base, fighters: badTeam });
    const allPlayers = base.fighters.map(item => {
      const { eliminated: _eliminated, ...rest } = item;
      return { ...rest, team: 'players' as const, health: 100 };
    });
    rejects({ ...base, fighters: allPlayers, wave: { index: 0, countdownTicks: 0, remaining: 0 } });

    // An explicit `eliminated: false` is not canonical and is rejected, while
    // the encoder normalises it away for in-memory round-trips.
    const aliveMarker = base.fighters.map(item => item.id === 'P1' ? { ...item, eliminated: false } : item);
    rejects({ ...base, fighters: aliveMarker });
    expect(decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: { ...base, fighters: aliveMarker } })).state)
      .toEqual(base);
  });

  it('rejects team assignments that do not cover the roster at match creation', () => {
    expect(() => createState({ ids: [...ROSTER], mode: 'wave' })).toThrow(/team assignment/);
    expect(() => createState({ ids: [...ROSTER], mode: 'wave', teams: { P1: 'players', P2: 'players', E1: 'enemies' } }))
      .toThrow(/every fighter/);
    expect(() => createState({ ids: [...ROSTER], mode: 'wave', teams: { ...TEAMS, E1: 'players', E2: 'players' } }))
      .toThrow(/at least one player and one enemy/);
    expect(() => createState({ ids: [...ROSTER], mode: 'wave', teams: { ...TEAMS, Z9: 'enemies' } }))
      .toThrow(/unknown player/);
  });
});
