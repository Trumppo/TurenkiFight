import type { Fighter, GameEvent, GameState, ModeId, Move, ObjectKind, ObjectState, Phase, SimObject } from '../simulation/types';
import { ARENA_BOUNDS, COUNTDOWN_TICKS, KO_HIT_STOP_TICKS, MATCH_TICKS, MOVES } from '../simulation/step';
import { COMBAT_MOVES, END_REASONS, parseGameEvent } from './gameEvent';
import { MAX_PLAYERS } from './players';

/** Transport-independent, versioned representation of the full deterministic simulation state. */
export const SNAPSHOT_VERSION = 1 as const;
/**
 * Pre-parse UTF-8 cap. The schema-maximal eight-fighter snapshot measures
 * 83,686 bytes with the optional M11 hit-stop/knockback counters present
 * (83,373 bytes when both are absent, which is the common idle case). The old
 * 65,536-byte cap would reject a state the parser accepts. Doubling the cap
 * keeps it defensive: every schema-valid snapshot is encodable, while real
 * eight-player snapshots are far smaller (see `stateSnapshot.test.ts`). Raising
 * this cap does not change the bytes emitted for any roster.
 */
export const MAX_SNAPSHOT_BYTES = 131072;
/** Derived from the single roster bound; a snapshot carries a full match roster. */
export const MAX_SNAPSHOT_FIGHTERS = MAX_PLAYERS;
export const MAX_SNAPSHOT_EVENTS = 64;
/**
 * Defensive schema bound for the object list. The simulation keeps at most
 * `OBJECT_SPAWN_TABLE.maxUnbroken` (3) live objects, but the codec accepts a
 * bounded larger list so inspection and future object types do not need a codec
 * edit.
 */
export const MAX_SNAPSHOT_OBJECTS = 32;
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
/**
 * Optional mode fields are allowed on the wire but must match the mode that
 * created them. `damageDealt` is part of the mode state (LMS and Deathmatch
 * tie-breaks read it) even though it has no Score Brawl value.
 */
const requiredFighterKeys = ['id', 'x', 'y', 'z', 'vz', 'facing', 'health', 'score', 'koCount', 'hitsReceived',
  'attackCooldown', 'attackFrames', 'attackMove', 'hitTargets', 'hitstun', 'koTimer', 'protection', 'previousButtons'];
const modeFighterKeys = ['eliminated', 'frags', 'deaths', 'damageDealt'];
/** Optional and canonically omitted when zero; absent means 0. */
const optionalFighterKeys = ['knockback'];
const fighterKeys = [...requiredFighterKeys, ...modeFighterKeys, ...optionalFighterKeys];
const requiredStateKeys = ['tick', 'fighters', 'phase', 'countdownTicks', 'remainingTicks', 'events'];
/** Optional and canonically omitted when zero/empty; absent means 0 or none. */
const optionalStateKeys = ['hitStopTicks', 'objects'];
const stateKeys = [...requiredStateKeys, 'mode', ...optionalStateKeys];
/** Object fields emitted by the simulation; unknown keys are rejected. */
const objectKeys = ['id', 'kind', 'x', 'y', 'z', 'state', 'holder', 'spawnTick', 'vx', 'vz'];
const objectKinds: readonly ObjectKind[] = ['bottle'];
const objectStates: readonly ObjectState[] = ['ground', 'held', 'airborne', 'broken'];
/** Stable generated id: `O1`, `O2`, ... (no random or external sequence). */
const objectIdPattern = /^O[1-9][0-9]*$/;
/**
 * Score Brawl is the historical default and omits `mode`, so an explicit
 * `score-brawl` value is not canonical and is rejected by the decoder.
 */
const snapshotModes: readonly ModeId[] = ['last-man-standing', 'deathmatch'];
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const has = (x: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(x, key);
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
 * moves in fixed order, plus `jump` and `grab`. The simulator never records any
 * other string, so the codec rejects unknown labels instead of passing them through.
 */
export const BUTTON_LABELS = ['punch', 'kick', 'jumpkick', 'jump', 'grab'] as const;

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

function parseFighter(value: unknown, mode: ModeId | undefined): Fighter | null {
  if (!obj(value) || !keys(value, fighterKeys)) return null;
  const x = value;
  const id = x.id;
  if (!string(id)) return null;
  if (!requiredFighterKeys.every(key => has(x, key))) return null;
  if (!['x', 'y', 'z', 'vz', 'score'].every(k => finite(x[k]))) return null;
  if ((x.z as number) < 0) return null; // step() clamps z to >= 0
  if (typeof x.health !== 'number' || !Number.isSafeInteger(x.health) || x.health < 0 || x.health > MAX_HEALTH) return null;
  if (x.facing !== -1 && x.facing !== 1) return null;
  if (!counter(x.hitsReceived) || !counter(x.koCount)) return null;
  if (!['attackFrames', 'hitstun', 'koTimer', 'protection'].every(k => nonnegative(x[k]))) return null;
  // Knockback is an optional signed, fractional px remainder. Absent means 0.
  // A nonzero slide without hitstun is unreachable state, and an explicit zero
  // is accepted but canonicalised away before encoding.
  if (has(x, 'knockback')) {
    if (!finite(x.knockback)) return null;
    if ((x.knockback as number) !== 0 && (x.hitstun as number) === 0) return null;
  }
  if (!nonnegative(x.attackCooldown) || x.attackCooldown > MAX_ATTACK_TICKS) return null;
  if (!coherentAttack(x.attackMove, x.attackFrames)) return null;
  if (!strings(x.hitTargets) || x.hitTargets.length > MAX_SNAPSHOT_FIGHTERS || !buttons(x.previousButtons)) return null;

  const carriesModeState = modeFighterKeys.some(key => has(x, key));
  if (carriesModeState && mode === undefined) return null;
  // `eliminated` is a true-only marker: an absent field means "alive", so the
  // canonical form omits `false` and the decoder rejects it as non-canonical.
  if (has(x, 'eliminated')) {
    if (mode !== 'last-man-standing' || x.eliminated !== true) return null;
  }
  if (has(x, 'frags')) {
    if (mode !== 'deathmatch' || !counter(x.frags)) return null;
  }
  if (has(x, 'deaths')) {
    if (mode !== 'deathmatch' || !counter(x.deaths)) return null;
  }
  if (has(x, 'damageDealt') && !counter(x.damageDealt)) return null;
  // Deathmatch always spawns and steps the frag table together.
  if (mode === 'deathmatch' && (!has(x, 'frags') || !has(x, 'deaths'))) return null;
  // Last Man Standing eliminates on the knockout that reaches zero health, so
  // every zero-health fighter is eliminated and every eliminated fighter has
  // zero health. Damage never leaves one of the two without the other.
  if (mode === 'last-man-standing' && ((x.health === 0) !== (x.eliminated === true))) return null;

  return {
    id,
    x: x.x as number,
    y: x.y as number,
    z: x.z as number,
    vz: x.vz as number,
    facing: x.facing as Fighter['facing'],
    health: x.health,
    score: x.score as number,
    koCount: x.koCount as number,
    hitsReceived: x.hitsReceived as number,
    attackCooldown: x.attackCooldown as number,
    attackFrames: x.attackFrames as number,
    attackMove: x.attackMove as Move | null,
    hitTargets: [...(x.hitTargets as string[])],
    hitstun: x.hitstun as number,
    ...(has(x, 'knockback') && x.knockback !== 0 ? { knockback: x.knockback as number } : {}),
    koTimer: x.koTimer as number,
    protection: x.protection as number,
    previousButtons: [...(x.previousButtons as string[])],
    ...(x.eliminated === true ? { eliminated: true } : {}),
    ...(has(x, 'frags') ? { frags: x.frags as number } : {}),
    ...(has(x, 'deaths') ? { deaths: x.deaths as number } : {}),
    ...(has(x, 'damageDealt') ? { damageDealt: x.damageDealt as number } : {}),
  };
}

/**
 * Strict object validation. The rules mirror what the simulation can emit:
 * - `kind` and `state` are closed unions.
 * - coordinates stay inside the playable arena; `z` is never negative.
 * - `holder` must be a roster member and is required exactly while held or
 *   airborne (a thrown bottle keeps its thrower for attribution).
 * - `vx`/`vz` exist only while airborne and are required there; without them a
 *   snapshot could not restore the exact arc deterministically.
 * - `spawnTick` may not be in the future.
 */
function parseObject(value: unknown, roster: ReadonlySet<string>, tick: number): SimObject | null {
  if (!obj(value) || !keys(value, objectKeys)) return null;
  if (typeof value.id !== 'string' || !objectIdPattern.test(value.id)) return null;
  if (!objectKinds.includes(value.kind as ObjectKind)) return null;
  if (!objectStates.includes(value.state as ObjectState)) return null;
  if (!['x', 'y', 'z'].every(key => finite(value[key]))) return null;
  const x = value.x as number, y = value.y as number, z = value.z as number;
  if (z < 0 || x < ARENA_BOUNDS.minX || x > ARENA_BOUNDS.maxX ||
      y < ARENA_BOUNDS.minY || y > ARENA_BOUNDS.maxY) return null;
  if (has(value, 'spawnTick') && (!nonnegative(value.spawnTick) || (value.spawnTick as number) > tick)) return null;
  const holder = value.holder;
  if (holder !== undefined && (typeof holder !== 'string' || !roster.has(holder))) return null;
  const state = value.state as ObjectState;
  const hasMotion = has(value, 'vx') || has(value, 'vz');
  switch (state) {
    case 'ground':
      // A ground bottle rests on the floor and belongs to nobody.
      if (holder !== undefined || hasMotion || z !== 0) return null;
      break;
    case 'held':
      if (holder === undefined || hasMotion) return null;
      break;
    case 'airborne':
      if (holder === undefined || !finite(value.vx) || !finite(value.vz)) return null;
      break;
    case 'broken':
      if (holder !== undefined || hasMotion) return null;
      break;
  }
  return {
    id: value.id,
    kind: 'bottle',
    x, y, z,
    state,
    ...(holder !== undefined ? { holder: holder as string } : {}),
    ...(has(value, 'spawnTick') ? { spawnTick: value.spawnTick as number } : {}),
    ...(state === 'airborne' ? { vx: value.vx as number, vz: value.vz as number } : {}),
  };
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
  if (!keys(state, stateKeys) || !requiredStateKeys.every(key => has(state, key)) ||
      !nonnegative(state.tick) || state.tick > MAX_SNAPSHOT_TICK ||
      (has(state, 'hitStopTicks') &&
        (!nonnegative(state.hitStopTicks) || (state.hitStopTicks as number) > KO_HIT_STOP_TICKS)) ||
      !phases.includes(state.phase as Phase) || !timersValid(state) ||
      !Array.isArray(state.fighters) || state.fighters.length < 1 ||
      state.fighters.length > MAX_SNAPSHOT_FIGHTERS) {
    throw new Error('Malformed simulation state');
  }
  // `mode` is present only for the rules-driven modes; Score Brawl omits it and
  // an explicit `score-brawl` value is not canonical.
  const mode = has(state, 'mode') ? state.mode : undefined;
  if (mode !== undefined && !snapshotModes.includes(mode as ModeId)) {
    throw new Error('Malformed simulation state');
  }
  const fighters: Fighter[] = [];
  for (const raw of state.fighters) {
    const parsed = parseFighter(raw, mode as ModeId | undefined);
    if (parsed === null) throw new Error('Malformed simulation state');
    fighters.push(parsed);
  }
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
  const objects: SimObject[] = [];
  if (has(state, 'objects')) {
    if (!Array.isArray(state.objects) || state.objects.length > MAX_SNAPSHOT_OBJECTS) {
      throw new Error('Malformed simulation state');
    }
    const objectIds = new Set<string>();
    for (const raw of state.objects) {
      const parsed = parseObject(raw, roster, state.tick as number);
      if (parsed === null || objectIds.has(parsed.id)) throw new Error('Malformed simulation state');
      objectIds.add(parsed.id);
      objects.push(parsed);
    }
  }
  const events: GameEvent[] = state.events.map(event => parseGameEvent(event, state.tick as number, roster));
  for (const event of events) {
    if (event.type !== 'MatchEnded') continue;
    const carriesOutcome = event.reason !== undefined || event.winner !== undefined;
    // Score Brawl keeps the historical `{ tick, type }` event exactly. The
    // rules-driven modes always report both the end reason and the winner
    // (possibly null for a draw).
    if (mode === undefined ? carriesOutcome : event.reason === undefined || event.winner === undefined) {
      throw new Error('Malformed simulation state');
    }
    if (event.reason !== undefined && !END_REASONS.includes(event.reason)) {
      throw new Error('Malformed simulation state');
    }
  }
  return {
    version: SNAPSHOT_VERSION,
    state: {
      tick: state.tick as number,
      fighters,
      phase: state.phase as Phase,
      countdownTicks: state.countdownTicks as number,
      remainingTicks: state.remainingTicks as number,
      ...(has(state, 'hitStopTicks') && state.hitStopTicks !== 0
        ? { hitStopTicks: state.hitStopTicks as number }
        : {}),
      ...(objects.length ? { objects } : {}),
      events,
      ...(mode === undefined ? {} : { mode: mode as ModeId }),
    },
  };
}

/** Sort object keys recursively so semantically identical snapshots have identical wire bytes. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (obj(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function withoutKey(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

/**
 * Canonical wire-form normalisations applied before strict validation:
 * - a zero `hitStopTicks` or `knockback` is omitted; absent means zero, so an
 *   idle snapshot keeps its pre-M11 bytes even though the in-memory object may
 *   carry explicit zeros.
 * - an empty `objects` array is omitted; absent means no objects, so a state
 *   without objects keeps its pre-M12 bytes.
 * - Last Man Standing `eliminated: false` is omitted as before.
 * The decoder still rejects unknown keys and out-of-range values. An explicit
 * zero or empty list on the wire is accepted and normalised away by the decoder.
 */
function canonicalEncodeInput(value: unknown): unknown {
  if (!obj(value) || !obj(value.state)) return value;
  const state = value.state;
  let nextState: Record<string, unknown> = state;
  if (has(nextState, 'hitStopTicks') && nextState.hitStopTicks === 0) {
    nextState = withoutKey(nextState, 'hitStopTicks');
  }
  if (has(nextState, 'objects') && Array.isArray(nextState.objects) && nextState.objects.length === 0) {
    nextState = withoutKey(nextState, 'objects');
  }
  if (!Array.isArray(nextState.fighters)) return { ...value, state: nextState };
  const mode = nextState.mode;
  return {
    ...value,
    state: {
      ...nextState,
      fighters: nextState.fighters.map(fighter => {
        if (!obj(fighter)) return fighter;
        let next = fighter;
        if (has(next, 'knockback') && next.knockback === 0) next = withoutKey(next, 'knockback');
        if (mode === 'last-man-standing' && next.eliminated === false) next = withoutKey(next, 'eliminated');
        return next;
      }),
    },
  };
}

export function encodeStateSnapshot(snapshot: StateSnapshot): string {
  const json = JSON.stringify(canonical(parseStateSnapshot(canonicalEncodeInput(snapshot))));
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
