import type { Fighter, GameState, Move, Phase } from '../simulation/types';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES } from '../simulation/step';
import { COMBAT_MOVES, parseGameEvent } from './gameEvent';

/** Transport-independent, versioned representation of the full deterministic simulation state. */
export const SNAPSHOT_VERSION = 1 as const;
export const MAX_SNAPSHOT_BYTES = 65536;
export const MAX_SNAPSHOT_FIGHTERS = 4;
export const MAX_SNAPSHOT_EVENTS = 64;
export type StateSnapshot = { version: typeof SNAPSHOT_VERSION; state: GameState };
/**
 * Highest tick the parser accepts. `step()` increments the tick by one, so
 * `MAX_SAFE_INTEGER` (which would advance to a non-safe integer) is rejected.
 * A snapshot at this terminal tick can be parsed and encoded for inspection,
 * but it cannot be advanced: `stepBuffered` and `verifyReplay` fail closed when
 * a step would leave the accepted tick domain. Tests step from
 * `MAX_SNAPSHOT_TICK - 1`.
 */
export const MAX_SNAPSHOT_TICK = Number.MAX_SAFE_INTEGER - 1;
/**
 * Fighter health at spawn and respawn in `src/game/simulation/step.ts`. The
 * simulation does not export this rule constant yet; the guard test in
 * `stateSnapshot.test.ts` fails if the simulation starts health differently.
 */
export const MAX_HEALTH = 100;
/**
 * The hit-resolution loop in `step()` can add at most one hit and one knockout
 * per opponent to a single fighter per tick, so the parser reserves that much
 * headroom below `MAX_SAFE_INTEGER` to keep stepped counters safe integers.
 * The top of the accepted range is terminal like `MAX_SNAPSHOT_TICK`: one more
 * increment can reach `MAX_SAFE_INTEGER`, which the parser rejects, but no
 * counter can overflow into an unsafe integer. Advancing APIs fail closed
 * instead of returning such a step result.
 */
const MAX_FIGHTER_COUNTER = Number.MAX_SAFE_INTEGER - (MAX_SNAPSHOT_FIGHTERS - 1);

const phases: Phase[] = ['lobby', 'countdown', 'fighting', 'results'];
const fighterKeys = ['id', 'x', 'y', 'z', 'vz', 'facing', 'health', 'score', 'koCount', 'hitsReceived',
  'attackCooldown', 'attackFrames', 'attackMove', 'hitTargets', 'hitstun', 'koTimer', 'protection', 'previousButtons'];
const stateKeys = ['tick', 'fighters', 'phase', 'countdownTicks', 'remainingTicks', 'events'];
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, expected: string[]) => Object.keys(x).every(k => expected.includes(k));
const nonnegative = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const counter = (x: unknown): x is number => nonnegative(x) && x <= MAX_FIGHTER_COUNTER;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const string = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(string) && new Set(x).size === x.length;

function totalAttackTicks(move: Move): number {
  const profile = MOVES[move];
  return profile.startup + profile.active + profile.recovery;
}

/**
 * `step()` seeds `attackFrames` and `attackCooldown` from a move duration and
 * never assigns a larger value, so no simulation state can exceed the longest
 * move. The knockout path clears `attackMove`/`attackFrames` but leaves the
 * current cooldown behind, so a nonzero residual cooldown is valid state and
 * must not be tied to `attackFrames`.
 */
const MAX_ATTACK_TICKS = Math.max(...COMBAT_MOVES.map(totalAttackTicks));

/**
 * Every label `step()` can write into `previousButtons`: the enabled combat
 * moves in fixed order, plus `jump`. The simulator never records any other
 * string, so the codec rejects unknown labels instead of passing them through.
 */
export const BUTTON_LABELS = ['punch', 'kick', 'jumpkick', 'jump'] as const;

/**
 * Labels are unique by construction in `step()`, so the whitelist alone caps
 * the array at four entries; the explicit length check keeps that bound local.
 */
const buttons = (x: unknown): x is string[] =>
  strings(x) && x.length <= BUTTON_LABELS.length &&
  x.every(label => (BUTTON_LABELS as readonly string[]).includes(label));

/**
 * `step()` sets `attackFrames` to the full move duration and clears both fields
 * together, so an active move always has 1..duration frames left and an idle
 * fighter has no move and zero remaining frames.
 */
function coherentAttack(move: unknown, frames: unknown): boolean {
  if (move === null) return frames === 0;
  if (!COMBAT_MOVES.includes(move as Move)) return false;
  return typeof frames === 'number' && Number.isSafeInteger(frames) && frames >= 1 &&
    frames <= totalAttackTicks(move as Move);
}

function fighter(x: unknown): x is Fighter {
  if (!obj(x) || !keys(x, fighterKeys) || Object.keys(x).length !== fighterKeys.length || !string(x.id)) return false;
  if (!['x', 'y', 'z', 'vz', 'score'].every(k => finite(x[k]))) return false;
  if ((x.z as number) < 0) return false; // step() clamps z to >= 0
  if (typeof x.health !== 'number' || !Number.isSafeInteger(x.health) || x.health < 0 || x.health > MAX_HEALTH) return false;
  if (x.facing !== -1 && x.facing !== 1) return false;
  if (!counter(x.hitsReceived) || !counter(x.koCount)) return false;
  if (!['attackFrames', 'hitstun', 'koTimer', 'protection'].every(k => nonnegative(x[k]))) return false;
  if (!nonnegative(x.attackCooldown) || x.attackCooldown > MAX_ATTACK_TICKS) return false;
  if (!coherentAttack(x.attackMove, x.attackFrames)) return false;
  return strings(x.hitTargets) && x.hitTargets.length <= MAX_SNAPSHOT_FIGHTERS && buttons(x.previousButtons);
}

/**
 * Timers are bounded by the simulation constants that seed them. A `fighting`
 * state must leave at least one remaining tick, and a `countdown` state must
 * too because it transitions into `fighting`.
 */
function timersValid(state: Record<string, unknown>): boolean {
  const phase = state.phase as Phase;
  if (!nonnegative(state.countdownTicks) || state.countdownTicks > COUNTDOWN_TICKS) return false;
  if (!nonnegative(state.remainingTicks) || state.remainingTicks > MATCH_TICKS) return false;
  return (phase !== 'fighting' && phase !== 'countdown') || state.remainingTicks >= 1;
}

export function parseStateSnapshot(value: unknown): StateSnapshot {
  if (!obj(value) || !keys(value, ['version', 'state']) || Object.keys(value).length !== 2 ||
      value.version !== SNAPSHOT_VERSION || !obj(value.state)) throw new Error('Invalid snapshot envelope');
  const state = value.state;
  if (!keys(state, stateKeys) || Object.keys(state).length !== stateKeys.length ||
      !nonnegative(state.tick) || state.tick > MAX_SNAPSHOT_TICK ||
      !phases.includes(state.phase as Phase) || !timersValid(state) ||
      !Array.isArray(state.fighters) || state.fighters.length < 1 ||
      state.fighters.length > MAX_SNAPSHOT_FIGHTERS || !state.fighters.every(fighter)) {
    throw new Error('Malformed simulation state');
  }
  const fighters = state.fighters as Fighter[];
  const roster = new Set(fighters.map(f => f.id));
  // A hit target must be another fighter in the roster. `step()` skips
  // `a.id === t.id` before its hit-target loop and only pushes the opponent it
  // just hit, so a fighter listing itself is unreachable state and is rejected
  // alongside unknown IDs even though the self ID is a roster member.
  if (roster.size !== fighters.length ||
      fighters.some(f => f.hitTargets.some(id => id === f.id || !roster.has(id))) ||
      !Array.isArray(state.events) || state.events.length > MAX_SNAPSHOT_EVENTS) {
    throw new Error('Malformed simulation state');
  }
  for (const event of state.events) parseGameEvent(event, state.tick, roster);
  return { version: SNAPSHOT_VERSION, state: state as unknown as GameState };
}

/** Sort object keys recursively so semantically identical snapshots have identical wire bytes. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (obj(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function encodeStateSnapshot(snapshot: StateSnapshot): string {
  const json = JSON.stringify(canonical(parseStateSnapshot(snapshot)));
  if (new TextEncoder().encode(json).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('State snapshot exceeds size limit');
  return json;
}

/**
 * Fail closed unless `state` can be re-encoded as a StateSnapshot. Advancing
 * APIs call this on step output: the terminal tick and counter boundaries are
 * accepted for inspection, but a step from them can produce a state this codec
 * rejects, so such a step must not be returned or consumed.
 */
export function assertEncodableState(state: GameState): void {
  try {
    encodeStateSnapshot({ version: SNAPSHOT_VERSION, state });
  } catch (error) {
    throw new Error('Simulation state is not encodable after this step', { cause: error });
  }
}

export function decodeStateSnapshot(json: string): StateSnapshot {
  if (new TextEncoder().encode(json).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('State snapshot exceeds size limit');
  return parseStateSnapshot(JSON.parse(json) as unknown);
}
