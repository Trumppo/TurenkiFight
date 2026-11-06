import type { EndReason, GameEvent, Move, PlayerId } from '../simulation/types';

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
/**
 * Moves a `HitLanded` event may carry. `throw` is a projectile hit resolved by
 * the same pipeline; fighter `attackMove` validation deliberately keeps using
 * `COMBAT_MOVES` so a thrown object can never become a fighter attack state.
 */
export const HIT_MOVES: readonly Move[] = ['punch', 'kick', 'jumpkick', 'throw'];
/** End reasons the simulation can attach to `MatchEnded`. */
export const END_REASONS: readonly EndReason[] = ['elimination', 'frag-limit', 'time', 'waves-cleared'];

const fields = ['tick', 'type', 'attacker', 'target', 'move', 'reason', 'winner'];
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;

export function parseGameEvent(value: unknown, tick: number, roster?: ReadonlySet<string>): GameEvent {
  if (!obj(value) || Object.keys(value).some(key => !fields.includes(key)) ||
      Object.keys(value).length > fields.length || value.tick !== tick ||
      !GAME_EVENT_TYPES.includes(value.type as GameEvent['type'])) {
    throw new Error('Malformed game event');
  }
  const type = value.type as GameEvent['type'];
  // Only `MatchEnded` carries an outcome; every other event must omit both.
  if (type !== 'MatchEnded' && (value.reason !== undefined || value.winner !== undefined)) {
    throw new Error('Invalid event outcome');
  }
  const participant = (player: unknown): player is string => id(player) && (!roster || roster.has(player));
  if (type === 'HitLanded') {
    if (!participant(value.attacker) || !participant(value.target) || value.attacker === value.target ||
        !HIT_MOVES.includes(value.move as Move)) throw new Error('Invalid combat event');
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
  if (type === 'MatchEnded') {
    const hasReason = value.reason !== undefined;
    const hasWinner = value.winner !== undefined;
    // The simulation writes both outcome fields together for the rules-driven
    // modes and neither for Score Brawl, so a half-filled outcome is malformed.
    if (hasReason !== hasWinner) throw new Error('Invalid match-end event');
    if (hasReason && (!END_REASONS.includes(value.reason as EndReason) ||
        !(value.winner === null || participant(value.winner)))) {
      throw new Error('Invalid match-end event');
    }
  }
  return {
    tick,
    type,
    ...(value.attacker !== undefined ? { attacker: value.attacker as string } : {}),
    ...(value.target !== undefined ? { target: value.target as string } : {}),
    ...(value.move !== undefined ? { move: value.move as Move } : {}),
    ...(value.reason !== undefined ? { reason: value.reason as EndReason } : {}),
    ...(value.winner !== undefined ? { winner: value.winner as PlayerId | null } : {}),
  };
}
