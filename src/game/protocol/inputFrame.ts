import type { PlayerInput } from '../simulation/types';

/** Versioned, transport-neutral input contract. No networking or bot runtime required. */
export const INPUT_PROTOCOL_VERSION = 1 as const;
export const MAX_INPUT_FRAME_BYTES = 4096;
export const MAX_PLAYERS_PER_FRAME = 4;
export type InputFrame = {
  version: typeof INPUT_PROTOCOL_VERSION;
  tick: number;
  inputs: PlayerInput[];
};

const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const axis = (n: unknown): n is -1 | 0 | 1 => n === -1 || n === 0 || n === 1;
const boolean = (n: unknown): n is boolean => typeof n === 'boolean';
const own = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const optionalBoolean = (o: Record<string, unknown>, key: string) => !own(o, key) || boolean(o[key]);

/** Strict parser: reject unknown fields, duplicates, invalid ticks and malformed controls. */
export function parseInputFrame(value: unknown): InputFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid input frame');
  const frame = value as Record<string, unknown>;
  if (Object.keys(frame).some(k => !['version', 'tick', 'inputs'].includes(k)) ||
      frame.version !== INPUT_PROTOCOL_VERSION || !integer(frame.tick) || !Array.isArray(frame.inputs) ||
      frame.inputs.length > MAX_PLAYERS_PER_FRAME) {
    throw new Error('Unsupported or malformed input frame');
  }
  const ids = new Set<string>();
  const inputs: PlayerInput[] = frame.inputs.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid player input');
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some(k => !['playerId', 'moveX', 'moveY', 'jump', 'punch', 'kick', 'jumpkick', 'attack'].includes(k)) ||
        typeof p.playerId !== 'string' || p.playerId.length < 1 || p.playerId.length > 64 ||
        ids.has(p.playerId) || !axis(p.moveX) || !axis(p.moveY) || !boolean(p.jump) ||
        !['punch', 'kick', 'jumpkick', 'attack'].every(k => optionalBoolean(p, k))) {
      throw new Error('Malformed or duplicate player input');
    }
    ids.add(p.playerId);
    const result: PlayerInput = { playerId: p.playerId, moveX: p.moveX, moveY: p.moveY, jump: p.jump };
    for (const key of ['punch', 'kick', 'jumpkick', 'attack'] as const) {
      if (own(p, key)) result[key] = p[key] as boolean;
    }
    return result;
  });
  return { version: INPUT_PROTOCOL_VERSION, tick: frame.tick, inputs: inputs.sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0) };
}

export function encodeInputFrame(frame: InputFrame): string {
  const json = JSON.stringify(parseInputFrame(frame));
  if (new TextEncoder().encode(json).byteLength > MAX_INPUT_FRAME_BYTES) throw new Error('Input frame exceeds size limit');
  return json;
}

export function decodeInputFrame(json: string): InputFrame {
  if (new TextEncoder().encode(json).byteLength > MAX_INPUT_FRAME_BYTES) throw new Error('Input frame exceeds size limit');
  return parseInputFrame(JSON.parse(json) as unknown);
}

/** A missing or disconnected player supplies neutral input for this tick. */
export function neutralPlayerInput(playerId: string): PlayerInput {
  return { playerId, moveX: 0, moveY: 0, jump: false };
}
