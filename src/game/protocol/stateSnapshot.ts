import type { Fighter, GameEvent, GameState, Move, Phase } from '../simulation/types';

/** Transport-independent, versioned representation of the full deterministic simulation state. */
export const SNAPSHOT_VERSION = 1 as const;
export type StateSnapshot = { version: typeof SNAPSHOT_VERSION; state: GameState };

const phases: Phase[] = ['lobby', 'countdown', 'fighting', 'results'];
const moves: Move[] = ['punch', 'kick', 'jumpkick'];
const events: GameEvent['type'][] = ['HitLanded', 'Knockout', 'Respawned', 'MatchStarted', 'MatchEnded'];
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, expected: string[]) => Object.keys(x).every(k => expected.includes(k));
const nonnegative = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const string = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(string) && new Set(x).size === x.length;

function fighter(x: unknown): x is Fighter {
  if (!obj(x) || !keys(x, ['id','x','y','z','vz','facing','health','score','koCount','hitsReceived','attackCooldown','attackFrames','attackMove','hitTargets','hitstun','koTimer','protection','previousButtons'])) return false;
  return string(x.id) && ['x','y','z','vz','health','score'].every(k => finite(x[k])) &&
    (x.facing === -1 || x.facing === 1) &&
    ['koCount','hitsReceived','attackCooldown','attackFrames','hitstun','koTimer','protection'].every(k => nonnegative(x[k])) &&
    (x.attackMove === null || moves.includes(x.attackMove as Move)) &&
    strings(x.hitTargets) && strings(x.previousButtons) &&
    Object.keys(x).length === 18;
}

function gameEvent(x: unknown): x is GameEvent {
  if (!obj(x) || !keys(x, ['tick','type','attacker','target','move'])) return false;
  return nonnegative(x.tick) && events.includes(x.type as GameEvent['type']) &&
    (x.attacker === undefined || string(x.attacker)) &&
    (x.target === undefined || string(x.target)) &&
    (x.move === undefined || moves.includes(x.move as Move));
}

export function parseStateSnapshot(value: unknown): StateSnapshot {
  if (!obj(value) || !keys(value, ['version','state']) || Object.keys(value).length !== 2 ||
      value.version !== SNAPSHOT_VERSION || !obj(value.state)) throw new Error('Invalid snapshot envelope');
  const state = value.state;
  if (!keys(state, ['tick','fighters','phase','countdownTicks','remainingTicks','events']) ||
      Object.keys(state).length !== 6 || !nonnegative(state.tick) ||
      !phases.includes(state.phase as Phase) || !nonnegative(state.countdownTicks) ||
      !nonnegative(state.remainingTicks) || !Array.isArray(state.fighters) ||
      state.fighters.length < 1 || !state.fighters.every(fighter) ||
      new Set((state.fighters as Fighter[]).map(f => f.id)).size !== state.fighters.length ||
      !Array.isArray(state.events) || !state.events.every(gameEvent) ||
      (state.events as GameEvent[]).some(e => e.tick > (state.tick as number))) {
    throw new Error('Malformed simulation state');
  }
  return { version: SNAPSHOT_VERSION, state: state as unknown as GameState };
}

/** Canonical key order is provided by the simulation's stable object shape. */
export function encodeStateSnapshot(snapshot: StateSnapshot): string {
  return JSON.stringify(parseStateSnapshot(snapshot));
}

export function decodeStateSnapshot(json: string): StateSnapshot {
  return parseStateSnapshot(JSON.parse(json) as unknown);
}
