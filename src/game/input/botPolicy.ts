import {
  MOVES,
  OBJECT_PICKUP_REACH_X,
  OBJECT_PICKUP_REACH_Y,
} from '../simulation/step';
import type { Fighter, GameState, PlayerInput, SimObject } from '../simulation/types';

/**
 * Deterministic local bot policy (M8 slice A, mobility and items in M12).
 *
 * `botInput` is a pure function of the current state, the bot's player id and a
 * seed: it never reads the wall clock, never calls `Math.random` and never
 * mutates the state. Per-tick variation is derived by mixing the seed with the
 * player id and tick, so replaying the same match produces the same inputs.
 *
 * Behaviour is intentionally small: walk toward the nearest opponent that is
 * still in the match, attack when in reach, jump, and use the M12 object layer
 * with the same `grab` action as a human. Items are opportunistic, never a
 * chase:
 *
 * - **Pickup** only when the bot is already within the simulation's pickup
 *   reach of a ground bottle and that bottle is close to the bot's current
 *   target. A short detour is allowed for a bottle within `pickupInterestRadius`
 *   while the target is not in an attackable position; farther bottles are
 *   ignored so a bot never abandons a fight to fetch one across the arena.
 * - **Throw** only at the nearest targetable opponent when it is roughly in
 *   front and inside the bottle's actual flight range. Otherwise the bot keeps
 *   fighting or closes distance while holding.
 * - **Bounds without bot memory:** pickup and throw each have a seeded decision
 *   cadence derived from one phase. The pickup cadence bounds hoarding, the
 *   throw cadence bounds throw rate, and the throw phase is aligned with the
 *   pickup residue so the next pickup after a throw is at least one throw
 *   period away. The simulation itself allows one holder per object and one
 *   object per holder. Together that caps the item behaviour without adding any
 *   field to the simulation state.
 *
 * Jumps serve three purposes:
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
  /**
   * Pickup decisions run on a per-bot seeded cadence. This is the
   * deterministic equivalent of a pickup cooldown without storing bot memory in
   * the simulation state: the next pickup attempt is at least this many ticks
   * after the previous one, which bounds hoarding. At 60 Hz this is one attempt
   * per 0.8 s.
   */
  itemDecisionPeriod: 48,
  /**
   * Throws get their own, shorter cadence. A bottle is consumed by the throw,
   * so supply (not this cooldown) usually limits the real throw count; the
   * cadence bounds the maximum rate to one per 0.4 s. It divides
   * `itemDecisionPeriod` and shares its phase, so every throw tick lies on the
   * pickup residue class modulo this period: after a throw the next pickup
   * opportunity is at least this many ticks away. That is what makes "no
   * re-pickup right after a throw" a property of the cadence rather than bot
   * memory.
   */
  throwDecisionPeriod: 24,
  /**
   * A ground bottle is only worth a short detour while the bot's target is not
   * in an attackable position. Bottles farther than this from the bot are
   * ignored, so a bot never abandons a fight to fetch one across the arena.
   */
  pickupInterestRadius: 56,
  /**
   * The bottle must also be near the bot's current target. This is what makes a
   * pickup "on the way" rather than a detour to an unrelated corner.
   */
  pickupTargetRadius: 110,
  /**
   * Throw only inside the bottle's real flight range. The fixed arc from
   * `step.ts` lands after about 17 ticks and 51 px, so a farther throw would
   * always hit the floor first. Keeping a little margin also makes the throw
   * readable rather than a guaranteed miss.
   */
  throwMaxDistance: 48,
  /** Throw only when the target is roughly on the same depth line. */
  throwDepth: 10,
} as const;

/**
 * Why the bot wants to jump this tick. The reason is part of the public API so
 * tests can assert the conditions instead of inferring them from a noisy match.
 */
export type BotJumpReason = 'jump-in' | 'approach' | 'evasive';

/**
 * The item action a bot would take on this tick, if any. Exposed for the same
 * reason as `BotJumpReason`: tests assert the conditions directly instead of
 * reconstructing them from a noisy match.
 */
export type BotItemIntent =
  | { readonly action: 'pickup'; readonly objectId: string }
  | { readonly action: 'throw'; readonly objectId: string };

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
 * The per-bot pickup phase. All item cadences derive from this one seeded
 * offset so their phases stay aligned as described in `BOT_TUNING`.
 */
function itemOffset(seed: number, playerId: string): number {
  return Math.floor(noise(seed, playerId, 0, 8) * BOT_TUNING.itemDecisionPeriod);
}

/**
 * True on the ticks where this bot is allowed to start a pickup. Like
 * `isJumpDecisionTick`, the phase offset spreads bots out so a whole roster
 * does not grab in lockstep. This cadence is the memory-free bound that stops a
 * re-pickup right after a throw.
 */
export function isItemDecisionTick(seed: number, playerId: string, tick: number): boolean {
  const period = BOT_TUNING.itemDecisionPeriod;
  return (tick + itemOffset(seed, playerId)) % period === 0;
}

/**
 * Throw-only cadence. It reuses the pickup phase modulo the shorter throw
 * period, so throw ticks always lie on the pickup residue class: the next
 * pickup after a throw is at least `throwDecisionPeriod` ticks away even though
 * the bot stores no memory. The bottle supply is the real throw rate limit.
 */
export function isThrowDecisionTick(seed: number, playerId: string, tick: number): boolean {
  const period = BOT_TUNING.throwDecisionPeriod;
  const offset = itemOffset(seed, playerId) % period;
  return (tick + offset) % period === 0;
}

/** The bottle this bot is holding, if any. */
function heldObject(state: GameState, playerId: string): SimObject | undefined {
  return (state.objects ?? []).find(object => object.state === 'held' && object.holder === playerId);
}

/** The bot is able to take an item action this tick. */
function canAct(self: Fighter): boolean {
  return !self.eliminated && self.koTimer === 0 && self.health > 0 && self.z === 0
    && self.attackMove === null && self.hitstun === 0;
}

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Mirrors the simulation's pickup geometry: a ground bottle in front of the
 * fighter and inside the fixed reach. Keeping the rule here means a bot never
 * presses `grab` for a pickup the simulation would reject, so the press edge is
 * not wasted.
 */
function canPickUp(object: SimObject, self: Fighter): boolean {
  return object.state === 'ground'
    && (object.x - self.x) * self.facing >= 0
    && Math.abs(object.x - self.x) <= OBJECT_PICKUP_REACH_X
    && Math.abs(object.y - self.y) <= OBJECT_PICKUP_REACH_Y;
}

/** Nearest candidate by Manhattan distance; ties break by stable object id. */
function closestObject(objects: readonly SimObject[], from: Fighter): SimObject | undefined {
  let best: SimObject | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const object of objects) {
    const distance = manhattan(object, from);
    if (distance < bestDistance
      || (distance === bestDistance && best !== undefined && object.id.localeCompare(best.id) < 0)) {
      best = object;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A bottle the bot can pick up now. Besides the simulation's reach the bottle
 * must be near the bot's current target, so a pickup never pulls the bot out of
 * the fight it is already in.
 */
function pickupCandidate(state: GameState, self: Fighter, target: Fighter): SimObject | undefined {
  const bottles = (state.objects ?? []).filter(object =>
    canPickUp(object, self) && manhattan(object, target) <= BOT_TUNING.pickupTargetRadius);
  return closestObject(bottles, self);
}

/**
 * A nearby bottle worth a short detour while the target is not attackable. The
 * bottle must be near both the bot and the target; this is deliberately a
 * detour, not a fetch across the arena.
 */
function detourCandidate(state: GameState, self: Fighter, target: Fighter): SimObject | undefined {
  const bottles = (state.objects ?? []).filter(object =>
    object.state === 'ground'
    && manhattan(object, self) <= BOT_TUNING.pickupInterestRadius
    && manhattan(object, target) <= BOT_TUNING.pickupTargetRadius);
  return closestObject(bottles, self);
}

/** The nearest opponent is close enough and aligned enough for a throw. */
function canThrow(self: Fighter, target: Fighter): boolean {
  const dx = target.x - self.x;
  return dx * self.facing >= 0
    && Math.abs(dx) <= BOT_TUNING.throwMaxDistance
    && Math.abs(target.y - self.y) <= BOT_TUNING.throwDepth;
}

/**
 * True when the fighter is past the active frames of its current attack. A
 * throw is allowed in this window so a holding bot can replace the recovery of
 * a melee attack with the throw instead of waiting for a fully idle tick. That
 * keeps the throw rate useful without punching and throwing on the same active
 * frame.
 */
function inAttackRecovery(self: Fighter): boolean {
  if (!self.attackMove || self.attackMove === 'throw') return true;
  const move = MOVES[self.attackMove];
  const elapsed = move.startup + move.active + move.recovery - self.attackFrames;
  return elapsed >= move.startup + move.active;
}

/** A throw needs a grounded, unstunned holder but tolerates attack recovery. */
function canThrowNow(self: Fighter): boolean {
  return !self.eliminated && self.koTimer === 0 && self.health > 0 && self.z === 0
    && self.hitstun === 0 && inAttackRecovery(self);
}

/**
 * Resolve the item action behind the pickup/throw cadences. The simulation
 * still owns the actual pickup/throw; this only decides whether to press
 * `grab` on this tick.
 */
function itemIntent(state: GameState, self: Fighter, target: Fighter, seed: number): BotItemIntent | null {
  const held = heldObject(state, self.id);
  if (held) {
    if (!isThrowDecisionTick(seed, self.id, state.tick)) return null;
    return canThrowNow(self) && canThrow(self, target)
      ? { action: 'throw', objectId: held.id }
      : null;
  }
  if (!isItemDecisionTick(seed, self.id, state.tick)) return null;
  if (!canAct(self)) return null;
  const bottle = pickupCandidate(state, self, target);
  return bottle ? { action: 'pickup', objectId: bottle.id } : null;
}

/**
 * Public wrapper around `itemIntent` for unit tests and future presentation
 * debugging. Resolves the same self/target pair as `botInput`.
 */
export function botItemIntent(state: GameState, playerId: string, seed: number): BotItemIntent | null {
  if (state.phase !== 'fighting') return null;
  const self = state.fighters.find(fighter => fighter.id === playerId);
  if (!self || self.eliminated || self.koTimer > 0 || self.health <= 0) return null;
  const target = nearestOpponent(state, playerId);
  if (!target) return null;
  return itemIntent(state, self, target, seed);
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
  const attackable = inDepth && inFront && distance <= BOT_TUNING.maxAttackDistance;
  const canAttackNow = self.attackMove === null && self.hitstun === 0;
  const item = itemIntent(state, self, target, seed);
  const holding = heldObject(state, playerId) !== undefined;

  // Only detour to a bottle when the target is not in an attackable position.
  // A nearby bottle then reads as "on the way", not as abandoning a fight.
  const detour = !item && !holding && canAct(self) && !attackable
    ? detourCandidate(state, self, target)
    : undefined;

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

  if (item) {
    // Stand still on the action tick. The simulation resolves movement before
    // pickup/throw, so a stable facing makes the grab press reliable.
    moveX = 0;
    moveY = 0;
  } else if (detour) {
    // Walk to the nearby bottle, turning toward it if it is behind. The target
    // is outside attack reach, so this is not abandoning an active exchange.
    const bottleDx = detour.x - self.x;
    const bottleDy = detour.y - self.y;
    if (bottleDx * self.facing < 0 || Math.abs(bottleDx) > BOT_TUNING.minHorizontalDistance) {
      moveX = bottleDx > 0 ? 1 : -1;
    } else {
      moveX = 0;
    }
    moveY = Math.abs(bottleDy) > BOT_TUNING.minHorizontalDistance ? (bottleDy > 0 ? 1 : -1) : 0;
  }

  const attack = { punch: false, kick: false, jumpkick: false };
  if (!item && canAttackNow && attackable) {
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

  // An item action owns the tick: a pickup or throw must never be preempted by
  // a jump. A detour does not suppress jumps, so a bot that is merely walking
  // toward a nearby bottle keeps its normal mobility and combat timing.
  const reason = item ? null : jumpReason(state, self, target, seed);
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

  const input: PlayerInput = { playerId, moveX, moveY, jump, ...attack };
  if (item) input.grab = true;
  return input;
}

/** Convenience wrapper: one input per requested bot, in the given order. */
export function botInputs(state: GameState, botIds: readonly string[], seed: number): PlayerInput[] {
  return botIds.map(playerId => botInput(state, playerId, seed));
}
