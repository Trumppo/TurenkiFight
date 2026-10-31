import type { GameEvent } from '../simulation/types';
import { parseGameEvent } from './gameEvent';

export const EVENT_PROTOCOL_VERSION = 1 as const;
export const MAX_EVENT_BATCH_BYTES = 8192;
/**
 * Roster size used by the event bound below. It matches `MAX_SNAPSHOT_FIGHTERS`
 * in `stateSnapshot.ts` and `MAX_PLAYERS_PER_FRAME` in `inputFrame.ts`; a test
 * keeps the three constants equal.
 */
export const MAX_EVENT_FIGHTERS = 4;
/**
 * Per-tick upper bound for the current simulation with a four-fighter roster:
 * - `HitLanded`: at most one hit per attacker/target pair -> N * (N - 1) = 12
 * - `Knockout`: each target can be knocked out once per tick -> N = 4
 * - `Respawned`: each fighter can respawn once per tick -> N = 4
 * - lifecycle (`MatchStarted`/`MatchEnded`): at most one, and never both -> 1
 * Total 21. This is an upper bound, not a guarantee that every combination can
 * occur in the same tick.
 */
export const MAX_EVENTS_PER_BATCH =
  MAX_EVENT_FIGHTERS * (MAX_EVENT_FIGHTERS - 1) + 2 * MAX_EVENT_FIGHTERS + 1;
export type EventBatch = { version: typeof EVENT_PROTOCOL_VERSION; tick: number; events: GameEvent[] };

const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const tick = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/**
 * Strict batch parser. The wire format has no roster field, so participant
 * membership is only checked when the host passes its session roster.
 */
export function parseEventBatch(value: unknown, roster?: ReadonlySet<string>): EventBatch {
  if (!obj(value) || Object.keys(value).length !== 3 ||
      Object.keys(value).some(k => !['version', 'tick', 'events'].includes(k)) ||
      value.version !== EVENT_PROTOCOL_VERSION || !tick(value.tick) || !Array.isArray(value.events)) {
    throw new Error('Invalid event batch');
  }
  if (value.events.length > MAX_EVENTS_PER_BATCH) throw new Error('Event batch exceeds event count limit');
  return { version: EVENT_PROTOCOL_VERSION, tick: value.tick,
    events: value.events.map((event: unknown) => parseGameEvent(event, value.tick as number, roster)) };
}

export function encodeEventBatch(batch: EventBatch): string {
  const json = JSON.stringify(parseEventBatch(batch));
  if (new TextEncoder().encode(json).byteLength > MAX_EVENT_BATCH_BYTES) throw new Error('Event batch exceeds size limit');
  return json;
}

export function decodeEventBatch(json: string): EventBatch {
  if (new TextEncoder().encode(json).byteLength > MAX_EVENT_BATCH_BYTES) throw new Error('Event batch exceeds size limit');
  return parseEventBatch(JSON.parse(json) as unknown);
}
