import type { GameState } from '../simulation/types';
import { step } from '../simulation/step';
import { InputFrameBuffer } from './inputFrameBuffer';
import { assertEncodableState } from './stateSnapshot';

/**
 * Reject a simulation and input buffer that do not describe the same participants
 * before any staged frame is consumed. `step()` looks inputs up by fighter ID, so
 * the roster order does not matter; only the participant set is compared.
 */
function assertSameRoster(state: GameState, buffer: InputFrameBuffer): void {
  const stateRoster = new Set(state.fighters.map(fighter => fighter.id));
  if (stateRoster.size !== state.fighters.length || stateRoster.size !== buffer.players.length ||
      buffer.players.some(id => !stateRoster.has(id))) {
    throw new Error('Simulation and input buffer roster mismatch');
  }
}

/** One deterministic tick driven by buffered transport-neutral inputs. */
export function stepBuffered(state: GameState, buffer: InputFrameBuffer): GameState {
  if (state.tick !== buffer.tick) throw new Error('Simulation and input buffer tick mismatch');
  assertSameRoster(state, buffer);
  const frame = buffer.peek();
  const next = step(state, frame.inputs);
  if (next.tick !== state.tick + 1) throw new Error('Simulation failed to advance exactly one tick');
  // Fail closed before consuming: a stepped state that the codec rejects (for
  // example past the terminal tick or counter boundary) must not be returned,
  // and the frame must remain staged for a later retry.
  assertEncodableState(next);
  buffer.consume();
  return next;
}
