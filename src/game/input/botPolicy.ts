import { MOVES } from '../simulation/step';
import type { Fighter, GameState, PlayerInput } from '../simulation/types';

/**
 * Deterministic local bot policy (M8 slice A).
 *
 * `botInput` is a pure function of the current state, the bot's player id and a
 * seed: it never reads the wall clock, never calls `Math.random` and never
 * mutates the state. Per-tick variation is derived by mixing the seed with the
 * player id and tick, so replaying the same match produces the same inputs.
 *
 * Behaviour is intentionally small: walk toward the nearest opponent that is
 * still in the match, attack when in reach and occasionally jump. There is one
 * difficulty, no pathfinding, blocking or combos. Tuning constants live here so
 * presentation (lobby/HUD) and simulation stay untouched by bot decisions.
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
  /** Probability per tick of an occasional jump while approaching. */
  jumpChance: 0.02,
  /** Horizontal gaps at or below this are treated as exactly overlapping. */
  minHorizontalDistance: 1,
} as const;

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
      // Jump variants can only start while already airborne.
      if (Math.abs(target.z - self.z) <= MOVES.jumpkick.height) attack.jumpkick = true;
    } else if (distance <= MOVES.punch.reach) {
      // Within both punch and kick reach: the seed picks a move so two bots
      // approaching the same target do not look like clones.
      if (noise(seed, playerId, tick, 1) < 0.5) attack.punch = true;
      else attack.kick = true;
    } else {
      attack.kick = true;
    }
  }

  const jump = self.z === 0
    && canAct
    && !attack.punch && !attack.kick && !attack.jumpkick
    && distance > BOT_TUNING.maxAttackDistance
    && noise(seed, playerId, tick, 2) < BOT_TUNING.jumpChance;

  return { playerId, moveX, moveY, jump, ...attack };
}

/** Convenience wrapper: one input per requested bot, in the given order. */
export function botInputs(state: GameState, botIds: readonly string[], seed: number): PlayerInput[] {
  return botIds.map(playerId => botInput(state, playerId, seed));
}
