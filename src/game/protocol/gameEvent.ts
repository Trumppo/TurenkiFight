import type { GameEvent, Move } from '../simulation/types';

/**
 * Single strict validator for simulation events on the wire.
 *
 * `StateSnapshot` events and `EventBatch` events share the same schema, so the
 * per-event rules live here instead of being duplicated (and drifting) in both
 * codecs. `tick` is the only tick an event may carry: a state only holds the
 * events emitted by the step that produced it, and a batch holds one tick.
 *
 * `roster`, when supplied, rejects participant IDs that are not in the match
 * roster. StateSnapshot passes the fighter IDs; EventBatch has no roster field
 * on the wire, so a host that wants that check calls `parseEventBatch(batch, roster)`.
 *
 * Self-targeting is rejected because `src/game/simulation/step.ts` never emits
 * `HitLanded`/`Knockout` for a fighter against itself (the hit scan skips
 * `a.id === t.id`) and `Respawned` carries no attacker.
 */
export const GAME_EVENT_TYPES: readonly GameEvent['type'][] = [
  'HitLanded',
  'Knockout',
  'Respawned',
  'MatchStarted',
  'MatchEnded',
];
export const COMBAT_MOVES: readonly Move[] = ['punch', 'kick', 'jumpkick'];

const fields = ['tick', 'type', 'attacker', 'target', 'move'];
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;

export function parseGameEvent(value: unknown, tick: number, roster?: ReadonlySet<string>): GameEvent {
  if (!obj(value) || Object.keys(value).some(key => !fields.includes(key)) ||
      Object.keys(value).length > fields.length || value.tick !== tick ||
      !GAME_EVENT_TYPES.includes(value.type as GameEvent['type'])) {
    throw new Error('Malformed game event');
  }
  const type = value.type as GameEvent['type'];
  const participant = (player: unknown): player is string => id(player) && (!roster || roster.has(player));
  if (type === 'HitLanded') {
    if (!participant(value.attacker) || !participant(value.target) || value.attacker === value.target ||
        !COMBAT_MOVES.includes(value.move as Move)) throw new Error('Invalid combat event');
  } else if (type === 'Knockout') {
    if (!participant(value.attacker) || !participant(value.target) || value.attacker === value.target ||
        value.move !== undefined) throw new Error('Invalid knockout event');
  } else if (type === 'Respawned') {
    if (!participant(value.target) || value.attacker !== undefined || value.move !== undefined) {
      throw new Error('Invalid respawn event');
    }
  } else if (value.attacker !== undefined || value.target !== undefined || value.move !== undefined) {
    throw new Error('Invalid lifecycle event');
  }
  return {
    tick,
    type,
    ...(value.attacker !== undefined ? { attacker: value.attacker as string } : {}),
    ...(value.target !== undefined ? { target: value.target as string } : {}),
    ...(value.move !== undefined ? { move: value.move as Move } : {}),
  };
}
