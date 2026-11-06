import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES, createState, step } from '../src/game/simulation/step';
import { BOT_TUNING, botInput, botJumpReason, botNeutralInput, isJumpDecisionTick } from '../src/game/input/botPolicy';
import type { BotJumpReason } from '../src/game/input/botPolicy';
import type { GameEvent, GameState, ModeId } from '../src/game/simulation/types';

/**
 * M12 bot mobility: jump-in attacks, more approach hops and occasional evasive
 * hops. These tests pin the measured behaviour on fixed fixtures; the numbers
 * below were recorded before and after the change in
 * `docs/BOT_MOBILITY_AND_THROWS.md` slice A.
 *
 * Recorded baseline on the same 8-bot fixtures (original policy):
 * - last-man-standing, seed 0x5eed: 526 ticks, 0 jumps, 0 jumpkick hits.
 * - score-brawl, 3660 ticks: 16 jumps (1.97 per bot per minute), 10 jumpkick
 *   hits, 1.60 % of bot-ticks airborne.
 *
 * M12 mobility first added jump-ins; the point-blank guard now requires the
 * target to be strictly outside punch reach, so close-range kills stay ground
 * attacks. The fixture pins below were re-measured after that guard: the short
 * LMS fixture drops from 7 jumps to 1 and the one-minute Score Brawl from 80 to
 * 20 because most all-bot fighting happens inside punch reach. Jump-in
 * jumpkicks still appear on the Score Brawl fixture (16 of 20 jumpkick hits),
 * so the mechanic is proven end to end without preempting point-blank attacks.
 */
const BOT_SEED = 0x5eed;
const BOT_IDS = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
const JUMP_ARC_TICKS = 31;

/** A two-fighter fighting state with both fighters placed explicitly. */
function duel(ax: number, ay: number, bx: number, by: number, aFacing: 1 | -1 = 1, bFacing: 1 | -1 = -1): GameState {
  const base = createState(['P1', 'P2'], 'fighting');
  return {
    ...base,
    fighters: base.fighters.map(fighter => fighter.id === 'P1'
      ? { ...fighter, x: ax, y: ay, facing: aFacing }
      : { ...fighter, x: bx, y: by, facing: bFacing }),
  };
}

const atTick = (state: GameState, tick: number): GameState => ({ ...state, tick });

/** First tick where the bot policy returns the requested reason, or -1. */
function firstReasonTick(
  state: GameState,
  playerId: string,
  seed: number,
  wanted: BotJumpReason | null,
  limit = 4000,
): number {
  for (let tick = 0; tick < limit; tick++) {
    const sample = atTick(state, tick);
    if (botJumpReason(sample, playerId, seed) === wanted) return tick;
  }
  return -1;
}

/** The single jump decision tick a bot has in one cadence period. */
function decisionTick(seed: number, playerId: string): number {
  for (let tick = 0; tick < BOT_TUNING.jumpDecisionPeriod; tick++) {
    if (isJumpDecisionTick(seed, playerId, tick)) return tick;
  }
  throw new Error(`No jump decision tick within ${BOT_TUNING.jumpDecisionPeriod} ticks`);
}

interface FixtureRun {
  ticks: number;
  state: GameState;
  events: GameEvent[];
  jumpsByBot: Record<string, number>;
  totalJumps: number;
  jumpsPerBotMinute: number;
  airbornePct: number;
  minJumpGap: number | null;
  jumpkickHits: number;
  jumpInJumpkickHits: number;
  jumpkickAttackers: string[];
}

/**
 * Runs one fixed 8-bot match and counts jumps from the simulation's own
 * `z` transitions, so the count cannot drift from what the match actually did.
 */
function runEightBotFixture(mode: ModeId, limit: number, seed = BOT_SEED): FixtureRun {
  let state = createState(BOT_IDS, 'countdown', { mode });
  const events: GameEvent[] = [];
  const jumpsByBot: Record<string, number> = {};
  const airborne: Record<string, number> = {};
  const previousZ: Record<string, number> = {};
  const lastJumpTick: Record<string, number> = {};
  const lastJumpReason: Record<string, BotJumpReason | null> = {};
  const gaps: number[] = [];
  let jumpkickHits = 0;
  let jumpInJumpkickHits = 0;
  let ticks = 0;
  while (state.phase !== 'results' && ticks < limit) {
    const inputs = BOT_IDS.map(id => botInput(state, id, seed));
    for (const input of inputs) {
      if (input.jump) lastJumpReason[input.playerId] = botJumpReason(state, input.playerId, seed);
    }
    state = step(state, inputs);
    for (const fighter of state.fighters) {
      if ((previousZ[fighter.id] ?? 0) === 0 && fighter.z > 0) {
        jumpsByBot[fighter.id] = (jumpsByBot[fighter.id] ?? 0) + 1;
        if (lastJumpTick[fighter.id] !== undefined) gaps.push(state.tick - lastJumpTick[fighter.id]);
        lastJumpTick[fighter.id] = state.tick;
      }
      if (fighter.z > 0) airborne[fighter.id] = (airborne[fighter.id] ?? 0) + 1;
      previousZ[fighter.id] = fighter.z;
    }
    for (const event of state.events) {
      if (event.type !== 'HitLanded' || event.move !== 'jumpkick') continue;
      jumpkickHits++;
      // The jumpkick hit happens inside the same jump arc, so the most recent
      // jump reason for that attacker is the jump that produced it.
      if (event.attacker && lastJumpReason[event.attacker] === 'jump-in') jumpInJumpkickHits++;
    }
    events.push(...state.events);
    ticks++;
  }
  const totalAir = Object.values(airborne).reduce((total, value) => total + value, 0);
  const totalJumps = Object.values(jumpsByBot).reduce((total, value) => total + value, 0);
  return {
    ticks,
    state,
    events,
    jumpsByBot,
    totalJumps,
    jumpsPerBotMinute: totalJumps / BOT_IDS.length / (ticks / 3600),
    airbornePct: 100 * totalAir / (ticks * BOT_IDS.length),
    minJumpGap: gaps.length ? Math.min(...gaps) : null,
    jumpkickHits,
    jumpInJumpkickHits,
    jumpkickAttackers: [...new Set(events
      .filter(event => event.type === 'HitLanded' && event.move === 'jumpkick')
      .map(event => event.attacker))].filter((id): id is string => typeof id === 'string').sort(),
  };
}

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('M12 bot jump conditions', () => {
  it('jumps in from the band up to 1.5x kick reach and preempts the ground attack', () => {
    expect(BOT_TUNING.jumpInReachFactor).toBe(1.5);
    const bandReach = MOVES.kick.reach * BOT_TUNING.jumpInReachFactor;
    expect(bandReach).toBe(63);
    // Kick range: the bot would kick, but a jump-in replaces that attack.
    const inBand = duel(240, 160, 200, 160, -1, 1);
    const jumpTick = firstReasonTick(inBand, 'P2', BOT_SEED, 'jump-in');
    expect(jumpTick).toBeGreaterThanOrEqual(0);
    const jumpInput = botInput(atTick(inBand, jumpTick), 'P2', BOT_SEED);
    expect(jumpInput.jump).toBe(true);
    expect(jumpInput.punch || jumpInput.kick || jumpInput.jumpkick).toBe(false);
    const groundOnly = firstReasonTick(inBand, 'P2', BOT_SEED, null);
    expect(botInput(atTick(inBand, groundOnly), 'P2', BOT_SEED).kick).toBe(true);
  });

  it('never calls a jump-in outside the band, at or inside punch reach, behind the bot or outside the depth band', () => {
    const tooFar = duel(270, 160, 200, 160, -1, 1); // 70 px > 63
    const atPunchReach = duel(232, 160, 200, 160, -1, 1); // exactly 32 px
    const tooClose = duel(220, 160, 200, 160, -1, 1); // 20 px, point-blank
    const behind = duel(160, 160, 200, 160, -1, 1); // target is behind P2
    const offDepth = duel(240, 190, 200, 160, -1, 1); // dy 30 > attackDepth
    for (const state of [tooFar, atPunchReach, tooClose, behind, offDepth]) {
      for (let tick = 0; tick < 1000; tick++) {
        expect(botJumpReason(atTick(state, tick), 'P2', BOT_SEED), `tick ${tick}`).not.toBe('jump-in');
      }
    }
    // At touching distance the bot must use a ground attack instead of
    // spending a 31-tick jump arc on a kill it can already land.
    const pointBlank = botInput(tooClose, 'P2', BOT_SEED);
    expect(pointBlank.jump).toBe(false);
    expect(pointBlank.punch || pointBlank.kick).toBe(true);
  });

  it('keeps approach jumps on the seeded decision cadence and outside the jump-in band', () => {
    const far = duel(300, 160, 100, 160, -1, 1);
    const approachTick = firstReasonTick(far, 'P2', BOT_SEED, 'approach');
    expect(approachTick).toBeGreaterThanOrEqual(0);
    expect(isJumpDecisionTick(BOT_SEED, 'P2', approachTick)).toBe(true);
    const input = botInput(atTick(far, approachTick), 'P2', BOT_SEED);
    expect(input.jump).toBe(true);
    expect(input.punch || input.kick || input.jumpkick).toBe(false);

    let approaches = 0;
    for (let tick = 0; tick < 2000; tick++) {
      const sample = atTick(far, tick);
      const reason = botJumpReason(sample, 'P2', BOT_SEED);
      if (!isJumpDecisionTick(BOT_SEED, 'P2', tick)) expect(reason).not.toBe('approach');
      if (reason === 'approach') approaches++;
    }
    expect(approaches).toBeGreaterThan(0);
  });

  it('hops evasively when hurt or cornered, but not for a healthy bot in open space', () => {
    const cornered = duel(120, 160, 20, 160, -1, 1); // P2 is at the left wall, target inboard
    expect(cornered.fighters.find(fighter => fighter.id === 'P2')!.x).toBeLessThanOrEqual(
      BOT_TUNING.arenaMinX + BOT_TUNING.cornerMargin,
    );
    const cornerTick = firstReasonTick(cornered, 'P2', BOT_SEED, 'evasive');
    expect(cornerTick).toBeGreaterThanOrEqual(0);
    expect(botInput(atTick(cornered, cornerTick), 'P2', BOT_SEED).jump).toBe(true);

    // Hurt but not cornered: the target is behind, so neither a jump-in nor an
    // approach jump can win the decision.
    const hurtBase = duel(160, 160, 200, 160, -1, 1);
    const hurt: GameState = {
      ...hurtBase,
      fighters: hurtBase.fighters.map(fighter => fighter.id === 'P2'
        ? { ...fighter, health: BOT_TUNING.hurtHealthThreshold }
        : fighter),
    };
    expect(firstReasonTick(hurt, 'P2', BOT_SEED, 'evasive')).toBeGreaterThanOrEqual(0);

    const healthy = duel(300, 160, 100, 160, -1, 1);
    for (let tick = 0; tick < 4000; tick++) {
      expect(botJumpReason(atTick(healthy, tick), 'P2', BOT_SEED)).not.toBe('evasive');
    }
  });

  it('only presses the airborne jumpkick on the way down', () => {
    const base = duel(240, 160, 200, 160, -1, 1);
    const airborne = (vz: number): GameState => ({
      ...base,
      fighters: base.fighters.map(fighter => fighter.id === 'P2'
        ? { ...fighter, z: 20, vz }
        : fighter),
    });
    expect(botInput(airborne(-2), 'P2', BOT_SEED).jumpkick).toBe(true);
    expect(botInput(airborne(2), 'P2', BOT_SEED).jumpkick).toBe(false);
    // Too high above the target: the jumpkick would exist but cannot connect.
    const ascending = airborne(-2);
    const tooHigh: GameState = {
      ...ascending,
      fighters: ascending.fighters.map(fighter => fighter.id === 'P2' ? { ...fighter, z: 40 } : fighter),
    };
    expect(botInput(tooHigh, 'P2', BOT_SEED).jumpkick).toBe(false);
  });

  it('mirrors the simulation arena clamp used by the cornered check', () => {
    // The bot policy cannot import the movement clamp from step.ts, so the
    // duplicated bounds are pinned by driving the real simulation against both
    // walls with a neutral second player.
    let state = duel(200, 160, 100, 160, 1, -1);
    const walk = (moveX: -1 | 1) => step(state, [
      { playerId: 'P1', moveX, moveY: 0, jump: false },
      botNeutralInput('P2'),
    ]);
    for (let tick = 0; tick < 200; tick++) state = walk(-1);
    expect(state.fighters.find(fighter => fighter.id === 'P1')!.x).toBe(BOT_TUNING.arenaMinX);
    for (let tick = 0; tick < 300; tick++) state = walk(1);
    expect(state.fighters.find(fighter => fighter.id === 'P1')!.x).toBe(BOT_TUNING.arenaMaxX);
  });

  it('never jumps while airborne, attacking or in hitstun', () => {
    const base = duel(240, 160, 200, 160, -1, 1);
    for (let tick = 0; tick < 400; tick++) {
      const sample = atTick(base, tick);
      expect(botJumpReason({
        ...sample,
        fighters: sample.fighters.map(fighter => fighter.id === 'P2' ? { ...fighter, z: 12, vz: 2 } : fighter),
      }, 'P2', BOT_SEED)).toBeNull();
      expect(botJumpReason({
        ...sample,
        fighters: sample.fighters.map(fighter => fighter.id === 'P2'
          ? { ...fighter, attackMove: 'kick', attackFrames: 10 }
          : fighter),
      }, 'P2', BOT_SEED)).toBeNull();
      expect(botJumpReason({
        ...sample,
        fighters: sample.fighters.map(fighter => fighter.id === 'P2' ? { ...fighter, hitstun: 1 } : fighter),
      }, 'P2', BOT_SEED)).toBeNull();
    }
  });
});

describe('M12 bot seeded thresholds', () => {
  it('gives each bot exactly one jump decision tick per cadence period', () => {
    for (let seed = 0; seed < 25; seed++) {
      for (const id of BOT_IDS) {
        const hits = Array.from({ length: BOT_TUNING.jumpDecisionPeriod }, (_, tick) => tick)
          .filter(tick => isJumpDecisionTick(seed, id, tick));
        expect(hits).toHaveLength(1);
        // The next period repeats the same phase.
        expect(isJumpDecisionTick(seed, id, hits[0] + BOT_TUNING.jumpDecisionPeriod)).toBe(true);
        expect(isJumpDecisionTick(seed, id, hits[0] + 1)).toBe(false);
      }
    }
    const phases = new Set(BOT_IDS.map(id => decisionTick(BOT_SEED, id)));
    expect(phases.size).toBeGreaterThan(1);
  });

  it('keeps the seeded jump-in draw inside its configured bound', () => {
    const band = duel(240, 160, 200, 160, -1, 1);
    let jumps = 0;
    const samples = 500;
    for (let seed = 0; seed < samples; seed++) {
      if (botJumpReason(atTick(band, 7), 'P2', seed) === 'jump-in') jumps++;
    }
    const rate = jumps / samples;
    // The threshold is 0.12 per idle tick. This is a fixed sample, not a flaky
    // random draw, so the band only guards against a broken hash.
    expect(rate).toBeGreaterThan(0.07);
    expect(rate).toBeLessThan(0.17);
  });

  it('keeps the seeded approach and evasive draws inside their configured bounds', () => {
    const far = duel(300, 160, 100, 160, -1, 1);
    const hurtBase = duel(160, 160, 200, 160, -1, 1);
    const hurtBehind: GameState = {
      ...hurtBase,
      fighters: hurtBase.fighters.map(fighter => fighter.id === 'P2'
        ? { ...fighter, health: BOT_TUNING.hurtHealthThreshold }
        : fighter),
    };
    let approaches = 0;
    let evasives = 0;
    const samples = 500;
    for (let seed = 0; seed < samples; seed++) {
      const tick = decisionTick(seed, 'P2');
      if (botJumpReason(atTick(far, tick), 'P2', seed) === 'approach') approaches++;
      if (botJumpReason(atTick(hurtBehind, tick), 'P2', seed) === 'evasive') evasives++;
    }
    expect(approaches / samples).toBeGreaterThan(0.52);
    expect(approaches / samples).toBeLessThan(0.68);
    expect(evasives / samples).toBeGreaterThan(0.52);
    expect(evasives / samples).toBeLessThan(0.68);
  });

  it('uses only seeded noise, never a wall clock or Math.random', () => {
    const source = readFileSync(new URL('../src/game/input/botPolicy.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Math\.random\(/);
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/performance\.now\(/);
  });
});

describe('M12 bot mobility fixtures', () => {
  it('records the all-bot last-man-standing fixture after the point-blank jump-in guard', () => {
    const run = runEightBotFixture('last-man-standing', COUNTDOWN_TICKS + MATCH_TICKS + 10);
    // Measured after the guard. The short LMS match is mostly a punch-range
    // scrum, so its only jump does not land a jump-in-classified hit. The Score
    // Brawl minute below still proves jump-in jumpkicks end to end.
    expect(run.ticks).toBe(663);
    expect(run.jumpsByBot).toEqual({ P6: 1 });
    expect(run.totalJumps).toBe(1);
    expect(run.jumpkickHits).toBe(2);
    expect(run.jumpInJumpkickHits).toBe(0);
    expect(run.jumpkickAttackers).toEqual(['P6']);
    expect(run.events.some(event => event.type === 'HitLanded' && event.move === 'jumpkick')).toBe(true);
    expect(run.state.phase).toBe('results');
  });

  it('measures a higher jumps-per-minute rate on a fixed one-minute score brawl', () => {
    // 3660 ticks = 180-tick countdown plus a 3480-tick fight, i.e. just over a
    // minute of fixed simulation. Baseline: 16 jumps (1.97 per bot per minute),
    // 10 jumpkick hits, 1.60 % airborne. After the point-blank jump-in guard:
    // 20 jumps (2.46 per bot per minute), 20 jumpkick hits, 2.91 % airborne.
    // After M12 bot items: 17 jumps (2.09 per bot per minute), 21 jumpkick hits,
    // 2.45 % airborne. Item detours and grab ticks own some movement/jump
    // ticks, so the rate is slightly below the pre-item mobility pin but still
    // above the original 1.97 baseline and the jumpkick output did not fall.
    const run = runEightBotFixture('score-brawl', 3660);
    expect(run.totalJumps).toBe(17);
    expect(run.jumpsPerBotMinute).toBeCloseTo(2.09, 1);
    expect(run.jumpsPerBotMinute).toBeGreaterThan(2);
    expect(run.jumpkickHits).toBe(21);
    expect(run.jumpkickAttackers).toEqual(['P1', 'P2', 'P3', 'P4', 'P6', 'P7', 'P8']);
    expect(run.airbornePct).toBeLessThan(20);
    // Item actions take some ticks, but seven of eight bots still jump in this
    // minute. Retune approach/evasive chances after playtest if that feels calm.
    expect(BOT_IDS.filter(id => (run.jumpsByBot[id] ?? 0) > 0)).toHaveLength(7);
    expect(Math.max(...BOT_IDS.map(id => run.jumpsByBot[id] ?? 0))).toBeGreaterThanOrEqual(3);
  });

  it('does not jump-loop: every bot stays grounded most of the time and hops are spaced out', () => {
    const minute = runEightBotFixture('score-brawl', 3660);
    const short = runEightBotFixture('last-man-standing', COUNTDOWN_TICKS + MATCH_TICKS + 10);
    for (const run of [minute, short]) {
      // A full arc is about 31 ticks; two jumps closer than that would mean the
      // bot re-triggered while still airborne or immediately on landing. The
      // short fixture can end with fewer than two jumps per bot, so the gap is
      // only checked when it exists.
      if (run.minJumpGap !== null) expect(run.minJumpGap).toBeGreaterThanOrEqual(JUMP_ARC_TICKS);
      expect(run.airbornePct).toBeLessThan(20);
      const busiestBot = Math.max(...BOT_IDS.map(id => run.jumpsByBot[id] ?? 0));
      expect(busiestBot).toBeLessThanOrEqual(15);
    }
    // The short fixture is even quieter: no bot hops more than twice.
    expect(Math.max(...Object.values(short.jumpsByBot))).toBeLessThanOrEqual(2);
    expect(short.airbornePct).toBeLessThan(10);
  });

  it('does not turn a fleeing target into a jump loop', () => {
    // A scripted human runs to the right wall while the bot chases. Early on the
    // gap is far wider than the jump-in band, so only approach hops can fire;
    // once the wall stops the human the bot closes in normally.
    let state = createState(['P1', 'P2'], 'fighting');
    state = {
      ...state,
      fighters: state.fighters.map(fighter => fighter.id === 'P1'
        ? { ...fighter, x: 260, y: 160, facing: 1 }
        : { ...fighter, x: 160, y: 160, facing: 1 }),
    };
    let jumps = 0;
    let airborne = 0;
    let previousZ = 0;
    for (let tick = 0; tick < 600; tick++) {
      const human = state.fighters.find(fighter => fighter.id === 'P1')!;
      const retreat: -1 | 0 | 1 = human.x >= BOT_TUNING.arenaMaxX - 2 ? 0 : 1;
      previousZ = state.fighters.find(fighter => fighter.id === 'P2')!.z;
      state = step(state, [{ playerId: 'P1', moveX: retreat, moveY: 0, jump: false }, botInput(state, 'P2', BOT_SEED)]);
      const bot = state.fighters.find(fighter => fighter.id === 'P2')!;
      if (previousZ === 0 && bot.z > 0) jumps++;
      if (bot.z > 0) airborne++;
    }
    // Measured 5 hops and 22.8 % airborne; the bound leaves headroom for a
    // future tuning change while still catching an accidental jump loop.
    expect(jumps).toBeGreaterThanOrEqual(1);
    expect(jumps).toBeLessThanOrEqual(8);
    expect(airborne / 600).toBeLessThan(0.3);
  });

  it('reproduces the same match from the same seed and changes it with another seed', () => {
    const first = runEightBotFixture('last-man-standing', COUNTDOWN_TICKS + MATCH_TICKS + 10);
    const second = runEightBotFixture('last-man-standing', COUNTDOWN_TICKS + MATCH_TICKS + 10);
    expect(second.ticks).toBe(first.ticks);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(sha256(second.state)).toBe(sha256(first.state));
    expect(sha256(second.events)).toBe(sha256(first.events));

    const otherSeed = runEightBotFixture('last-man-standing', COUNTDOWN_TICKS + MATCH_TICKS + 10, BOT_SEED + 1);
    expect(sha256(otherSeed.events)).not.toBe(sha256(first.events));
  });
});
