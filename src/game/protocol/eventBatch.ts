import type { GameEvent, Move } from '../simulation/types';

export const EVENT_PROTOCOL_VERSION = 1 as const;
export const MAX_EVENT_BATCH_BYTES = 8192;
export type EventBatch = { version: typeof EVENT_PROTOCOL_VERSION; tick: number; events: GameEvent[] };

const types: GameEvent['type'][] = ['HitLanded', 'Knockout', 'Respawned', 'MatchStarted', 'MatchEnded'];
const moves: Move[] = ['punch', 'kick', 'jumpkick'];
const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;
const tick = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

function parseEvent(value: unknown, batchTick: number): GameEvent {
  if (!obj(value) || Object.keys(value).some(k => !['tick','type','attacker','target','move'].includes(k)) ||
      value.tick !== batchTick || !types.includes(value.type as GameEvent['type'])) {
    throw new Error('Malformed game event');
  }
  const type = value.type as GameEvent['type'];
  if (type === 'HitLanded' || type === 'Knockout') {
    if (!id(value.attacker) || !id(value.target) || value.attacker === value.target ||
        !moves.includes(value.move as Move)) throw new Error('Invalid combat event');
  } else if (type === 'Respawned') {
    if (!id(value.target) || value.attacker !== undefined || value.move !== undefined) throw new Error('Invalid respawn event');
  } else if (value.attacker !== undefined || value.target !== undefined || value.move !== undefined) {
    throw new Error('Invalid lifecycle event');
  }
  return { tick: batchTick, type, ...(value.attacker !== undefined ? { attacker: value.attacker as string } : {}),
    ...(value.target !== undefined ? { target: value.target as string } : {}),
    ...(value.move !== undefined ? { move: value.move as Move } : {}) };
}

export function parseEventBatch(value: unknown): EventBatch {
  if (!obj(value) || Object.keys(value).length !== 3 ||
      Object.keys(value).some(k => !['version','tick','events'].includes(k)) ||
      value.version !== EVENT_PROTOCOL_VERSION || !tick(value.tick) || !Array.isArray(value.events)) {
    throw new Error('Invalid event batch');
  }
  return { version: EVENT_PROTOCOL_VERSION, tick: value.tick,
    events: value.events.map((e: unknown) => parseEvent(e, value.tick as number)) };
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
