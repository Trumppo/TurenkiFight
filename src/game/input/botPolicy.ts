import { MOVES } from '../simulation/step';
import type { Fighter, GameState, PlayerInput } from '../simulation/types';

/**
 * Deterministic local bot policy (M8 slice A, mobility in M12).
 *
 * `botInput` is a pure function of the current state, the bot's player id and a
 * seed: it never reads the wall clock, never calls `Math.random` and never
 * mutates the state. Per-tick variation is derived by mixing the seed with the
 * player id and tick, so replaying the same match produces the same inputs.
 *
 * Behaviour is intentionally small: walk toward the nearest opponent that is
 * still in the match, attack when in reach and jump. Jumps serve three
 * purposes:
 *
 * - `jump-in`: the target is outside punch reach but inside the jump-in band
 *   (up to 1.5x kick reach), so the bot can jump and land the existing
 *   `jumpkick` on the way down without skipping a point-blank kill;
 * - `approach`: the target is farther away and a hop breaks up the walk;
 * - `evasive`: the bot is hurt or cornered and hops instead of attacking, so
 *   its movement is not purely linear.
 *
 * Approach and evasive jumps are gated by `isJumpDecisionTick`, a per-bot
 * cadence derived from the seed. A 30-tick jump arc plus a per-tick probability
 * would let a bot hop again as soon as it lands; the cadence is a deterministic
 * cooldown that needs no bot memory in the simulation state. Jump-ins are
 * evaluated every idle tick because the band is transient, and the attack
 * recovery cycle spaces them out.
 *
 * There is one difficulty and no pathfinding, blocking, throwing or combos;
 * the game has no throw move. Tuning constants live here so presentation and
 * simulation stay untouched by bot decisions.
 */
export const BOT_TUNING = {
  /** Stop closing horizontally inside punch reach; this keeps the bot facing the target. */
  standoffDistance: 26,
  /** Stop closing vertically once within this depth difference. */
  depthTolerance: 6,
  /** Attack once the opponent is within this depth band. */
  attackDepth: 12,
  /** Do not attack while farther away on the x axis than this. */
  maxAttackDistance: MOVES.kick.reach,
  /**
   * A jump decision is taken only every this many ticks, per bot. The period is
   * longer than a full jump arc (about 31 ticks), so a landed bot cannot hop
   * again before its next decision tick; this is the deterministic equivalent
   * of a jump cooldown without storing bot memory in the simulation state.
   */
  jumpDecisionPeriod: 40,
  /**
   * Chance per decision tick of an approach jump. The target must be farther
   * than the jump-in band, so this is the long walk back into the fight.
   */
  jumpChance: 0.6,
  /** Jump-in band ends at this multiple of kick reach (about 1.5x kick reach). */
  jumpInReachFactor: 1.5,
  /**
   * Chance per idle tick of a jump-in while the target is inside the band and
   * strictly outside punch reach. A jump-in replaces one ground attack and uses
   * the airborne `jumpkick`. The lower bound matters: at point-blank range the
   * bot must punch/kick rather than spend a 31-tick jump arc on a kill it could
   * already land. This is evaluated every tick rather than on the decision
   * cadence because the band is transient and a 40-tick cadence would usually
   * miss it. The attack cycle itself spaces the jumps out: the bot can only
   * consider a jump-in when it is grounded and idle.
   */
  jumpInChance: 0.12,
  /**
   * Chance per decision tick of an evasive hop while hurt or cornered. The
   * cadence keeps a cornered bot from hopping every time it can act.
   */
  evasiveJumpChance: 0.6,
  /** At or below this health a bot counts as hurt and may hop defensively. */
  hurtHealthThreshold: 40,
  /** Distance from a side wall at which a bot counts as cornered. */
  cornerMargin: 32,
  /**
   * Mirrors the horizontal movement clamp in `step.ts` (16..368). The bot
   * policy is a pure input function, so it cannot ask the simulation for the
   * live arena bounds; the value is pinned by a test in
   * `tests/m12-bot-mobility.test.ts`.
   */
  arenaMinX: 16,
  arenaMaxX: 368,
  /** Horizontal gaps at or below this are treated as exactly overlapping. */
  minHorizontalDistance: 1,
} as const;

/**
 * Why the bot wants to jump this tick. The reason is part of the public API so
 * tests can assert the conditions instead of inferring them from a noisy match.
 */
export type BotJumpReason = 'jump-in' | 'approach' | 'evasive';

/** Input used whenever a bot has nothing to do (not fighting, KO, eliminated). */
export function botNeutralInput(playerId: string): PlayerInput {
  return { playerId, moveX: 0, moveY: 0, jump: false };
}

/**
 * Mixes seed, player id, tick and a salt into a stable 32-bit value, then into
 * [0, 1). FNV-1a style mixing is enough here: this is variety, not security.
 */
function noise(seed: number, playerId: string, tick: number, salt: number): number {
  let hash = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let index = 0; index < playerId.length; index++) {
    hash = Math.imul(hash ^ playerId.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (tick >>> 0), 0x01000193) >>> 0;
  hash = Math.imul(hash ^ (salt >>> 0), 0x01000193) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d) >>> 0;
  hash ^= hash >>> 12;
  return (hash >>> 0) / 4294967296;
}

/** A fighter is a valid bot target only while still in the match and upright. */
function isTargetable(fighter: Fighter): boolean {
  return !fighter.eliminated && fighter.koTimer === 0;
}

/** Nearest targetable opponent; ties are broken by stable player id. */
function nearestOpponent(state: GameState, selfId: string): Fighter | undefined {
  const self = state.fighters.find(fighter => fighter.id === selfId);
  if (!self) return undefined;
  let best: Fighter | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fighter of state.fighters) {
    if (fighter.id === selfId || !isTargetable(fighter)) continue;
    const distance = (fighter.x - self.x) ** 2 + (fighter.y - self.y) ** 2;
    if (distance < bestDistance || (distance === bestDistance && best !== undefined && fighter.id.localeCompare(best.id) < 0)) {
      best = fighter;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * True on the ticks where this bot is allowed to decide about a jump. The
 * phase offset spreads bots out so a whole roster does not hop in lockstep.
 */
export function isJumpDecisionTick(seed: number, playerId: string, tick: number): boolean {
  const period = BOT_TUNING.jumpDecisionPeriod;
  const offset = Math.floor(noise(seed, playerId, 0, 5) * period);
  return (tick + offset) % period === 0;
}

/** A bot is cornered when it stands near a side wall and the target is inboard. */
function isCornered(self: Fighter, target: Fighter): boolean {
  const nearWall = self.x <= BOT_TUNING.arenaMinX + BOT_TUNING.cornerMargin
    || self.x >= BOT_TUNING.arenaMaxX - BOT_TUNING.cornerMargin;
  if (!nearWall) return false;
  const arenaCenterX = (BOT_TUNING.arenaMinX + BOT_TUNING.arenaMaxX) / 2;
  return Math.abs(self.x - arenaCenterX) > Math.abs(target.x - arenaCenterX);
}

/** Hurt or cornered: the situations in which a hop should break up a straight line. */
function isEvasiveSituation(self: Fighter, target: Fighter): boolean {
  return self.health <= BOT_TUNING.hurtHealthThreshold || isCornered(self, target);
}

/**
 * The jump conditions shared by `botInput` and the tests. `null` means the bot
 * stays grounded this tick. Attacks are resolved separately: `botInput` skips a
 * jump when it is attacking, except for jump-ins and evasive hops, which trade
 * one melee tick for the jump.
 */
function jumpReason(state: GameState, self: Fighter, target: Fighter, seed: number): BotJumpReason | null {
  if (self.z !== 0 || self.attackMove !== null || self.hitstun !== 0) return null;
  const tick = state.tick;

  const dx = target.x - self.x;
  const distance = Math.abs(dx);
  const inDepth = Math.abs(target.y - self.y) <= BOT_TUNING.attackDepth;
  const inFront = dx * self.facing > 0;
  const jumpInRange = BOT_TUNING.maxAttackDistance * BOT_TUNING.jumpInReachFactor;
  const decisionTick = isJumpDecisionTick(seed, self.id, tick);

  // A jump-in must not preempt a point-blank attack: inside punch reach the
  // bot can land a punch/kick now instead of spending a 31-tick jump arc. The
  // band therefore starts just outside punch reach and ends at 1.5x kick reach.
  if (distance > MOVES.punch.reach && distance <= jumpInRange && inDepth && inFront) {
    if (noise(seed, self.id, tick, 6) < BOT_TUNING.jumpInChance) return 'jump-in';
  } else if (distance > jumpInRange && decisionTick && noise(seed, self.id, tick, 2) < BOT_TUNING.jumpChance) {
    return 'approach';
  }
  if (decisionTick && isEvasiveSituation(self, target) && noise(seed, self.id, tick, 4) < BOT_TUNING.evasiveJumpChance) {
    return 'evasive';
  }
  return null;
}

/**
 * Public wrapper around `jumpReason` for unit tests and future presentation
 * debugging. It resolves the same self/target pair as `botInput`.
 */
export function botJumpReason(state: GameState, playerId: string, seed: number): BotJumpReason | null {
  if (state.phase !== 'fighting') return null;
  const self = state.fighters.find(fighter => fighter.id === playerId);
  if (!self || self.eliminated || self.koTimer > 0) return null;
  const target = nearestOpponent(state, playerId);
  if (!target) return null;
  return jumpReason(state, self, target, seed);
}

/**
 * One tick of bot input. The caller passes the same seed for the whole match;
 * using the state tick keeps the result reproducible from a replay.
 */
export function botInput(state: GameState, playerId: string, seed: number): PlayerInput {
  if (state.phase !== 'fighting') return botNeutralInput(playerId);
  const self = state.fighters.find(fighter => fighter.id === playerId);
  if (!self || self.eliminated || self.koTimer > 0) return botNeutralInput(playerId);
  const target = nearestOpponent(state, playerId);
  if (!target) return botNeutralInput(playerId);

  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const tick = state.tick;

  const distance = Math.abs(dx);
  const inDepth = Math.abs(dy) <= BOT_TUNING.attackDepth;
  const inFront = dx * self.facing > 0;
  let moveX: -1 | 0 | 1 = 0;
  if (distance > BOT_TUNING.standoffDistance || (!inFront && distance > BOT_TUNING.minHorizontalDistance)) {
    moveX = dx > 0 ? 1 : -1;
  } else if (distance <= BOT_TUNING.minHorizontalDistance) {
    // Exactly overlapping: step deterministically to one side so facing is
    // re-established instead of standing inside the opponent forever.
    moveX = noise(seed, playerId, tick, 3) < 0.5 ? -1 : 1;
  }
  // Vertical drift is tolerated inside the attack band; otherwise close it.
  let moveY: -1 | 0 | 1 = 0;
  if (Math.abs(dy) > BOT_TUNING.depthTolerance) moveY = dy > 0 ? 1 : -1;

  const attack = { punch: false, kick: false, jumpkick: false };
  const canAct = self.attackMove === null && self.hitstun === 0;
  if (canAct && inDepth && inFront && distance <= BOT_TUNING.maxAttackDistance) {
    if (self.z > 0) {
      // Jump variants can only start while airborne. Press on the way down so
      // the jumpkick active frames line up with the landing, not the ascent.
      if (self.vz < 0 && Math.abs(target.z - self.z) <= MOVES.jumpkick.height) attack.jumpkick = true;
    } else if (distance <= MOVES.punch.reach) {
      // Within both punch and kick reach: the seed picks a move so two bots
      // approaching the same target do not look like clones.
      if (noise(seed, playerId, tick, 1) < 0.5) attack.punch = true;
      else attack.kick = true;
    } else {
      attack.kick = true;
    }
  }

  const reason = jumpReason(state, self, target, seed);
  // A jump-in or evasive hop replaces the ground attack that tick: that is what
  // makes the jumpkick part of a jump-in instead of a cosmetic hop. Approach
  // jumps only happen outside attack reach, so they never compete with an attack.
  const preemptsAttack = reason === 'jump-in' || reason === 'evasive';
  if (preemptsAttack) {
    attack.punch = false;
    attack.kick = false;
    attack.jumpkick = false;
  }
  const jump = reason !== null && (preemptsAttack || (!attack.punch && !attack.kick && !attack.jumpkick));

  return { playerId, moveX, moveY, jump, ...attack };
}

/** Convenience wrapper: one input per requested bot, in the given order. */
export function botInputs(state: GameState, botIds: readonly string[], seed: number): PlayerInput[] {
  return botIds.map(playerId => botInput(state, playerId, seed));
}
