import type { PlayerInput } from '../simulation/types';
import { parseInputFrame, type InputFrame } from './inputFrame';

/**
 * Transport-neutral input staging for a future lockstep host.
 * A frame is accepted once; missing players receive neutral controls.
 * The caller advances the tick only after simulation step succeeds.
 */
export class InputFrameBuffer {
  private readonly frames = new Map<number, InputFrame>();
  private nextTick: number;
  private readonly players: string[];
  private readonly maxPending: number;

  constructor(players: string[], startTick = 0, maxPending = 120) {
    if (players.length < 1 || players.length > 4 || new Set(players).size !== players.length ||
        players.some(id => !id || id.length > 64) ||
        !Number.isSafeInteger(startTick) || startTick < 0 ||
        !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1200) {
      throw new Error('Invalid input buffer configuration');
    }
    this.players = [...players];
    this.nextTick = startTick;
    this.maxPending = maxPending;
  }

  get tick(): number { return this.nextTick; }
  get pending(): number { return this.frames.size; }

  push(raw: InputFrame): void {
    const frame = parseInputFrame(raw);
    if (frame.tick < this.nextTick || frame.tick >= this.nextTick + this.maxPending) {
      throw new Error('Input tick outside buffer window');
    }
    if (this.frames.has(frame.tick)) throw new Error('Duplicate input frame tick');
    if (frame.inputs.some(input => !this.players.includes(input.playerId))) {
      throw new Error('Input from unknown player');
    }
    this.frames.set(frame.tick, frame);
  }

  /** Returns a complete frame without advancing; call consume() after a successful step. */
  peek(): InputFrame {
    const staged = this.frames.get(this.nextTick);
    const byId = new Map(staged?.inputs.map(input => [input.playerId, input]));
    const inputs: PlayerInput[] = this.players.map(playerId =>
      byId.get(playerId) ?? { playerId, moveX: 0, moveY: 0, jump: false });
    return { version: 1, tick: this.nextTick, inputs };
  }

  consume(): InputFrame {
    const frame = this.peek();
    this.frames.delete(this.nextTick);
    this.nextTick++;
    return frame;
  }
}
