import type { GameState } from '../simulation/types';
import { step } from '../simulation/step';
import { InputFrameBuffer } from './inputFrameBuffer';

/** One deterministic tick driven by buffered transport-neutral inputs. */
export function stepBuffered(state: GameState, buffer: InputFrameBuffer): GameState {
  if (state.tick !== buffer.tick) throw new Error('Simulation and input buffer tick mismatch');
  const frame = buffer.peek();
  const next = step(state, frame.inputs);
  if (next.tick !== state.tick + 1) throw new Error('Simulation failed to advance exactly one tick');
  buffer.consume();
  return next;
}
