import type { GameState } from '../simulation/types';
import { parseStateSnapshot, type StateSnapshot } from './stateSnapshot';
import { InputFrameBuffer } from './inputFrameBuffer';

/**
 * Restore a detached simulation state and a fresh input buffer at the same tick.
 * Buffered future inputs are deliberately not retained across restoration.
 */
export function restoreBufferedSimulation(
  snapshot: StateSnapshot,
  maxPending = 120,
): { state: GameState; buffer: InputFrameBuffer } {
  const parsed = parseStateSnapshot(snapshot);
  const state = structuredClone(parsed.state);
  const buffer = new InputFrameBuffer(state.fighters.map(fighter => fighter.id), state.tick, maxPending);
  return { state, buffer };
}
