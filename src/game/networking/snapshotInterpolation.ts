import type { StateSnapshot } from '../protocol/stateSnapshot';
import type { Fighter, GameState } from '../simulation/types';

/**
 * Snapshot interpolation for a client that is not an authority.
 *
 * The client renders between the two most recent authoritative snapshots. It
 * never runs `step()` and never extrapolates: after the latest snapshot has
 * been reached, positions stay at that snapshot until a newer one arrives.
 * `receivedAt` values are client-clock timestamps supplied by the caller.
 */
export type TimedSnapshot = {
  readonly snapshot: StateSnapshot;
  readonly receivedAt: number;
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Interpolates fighter positions between `previous` and `current`. All other
 * authoritative fields come from `current`: health, score, phase and timers
 * are never guessed by the client.
 */
export function interpolateTimedSnapshots(
  previous: TimedSnapshot | null,
  current: TimedSnapshot,
  now: number,
  intervalMs?: number,
): GameState {
  const latest = current.snapshot.state;
  if (!previous || previous.receivedAt >= current.receivedAt) {
    return cloneState(latest);
  }
  // Prefer the server's fixed snapshot interval when the caller knows it. If a
  // stall made the arrival gap seconds long, using that gap would make the
  // client drift slowly behind after recovery; one snapshot interval catches up
  // promptly while still interpolating.
  const interval = intervalMs !== undefined && Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs
    : Math.max(1, current.receivedAt - previous.receivedAt);
  const alpha = clamp01((now - current.receivedAt) / interval);
  const before = new Map(previous.snapshot.state.fighters.map(fighter => [fighter.id, fighter]));
  return {
    ...latest,
    fighters: latest.fighters.map(fighter => {
      const old = before.get(fighter.id);
      if (!old) return { ...fighter, hitTargets: [...fighter.hitTargets], previousButtons: [...fighter.previousButtons] };
      return interpolateFighter(old, fighter, alpha);
    }),
    events: latest.events.map(event => ({ ...event })),
  };
}

function interpolateFighter(before: Fighter, after: Fighter, alpha: number): Fighter {
  return {
    ...after,
    x: lerp(before.x, after.x, alpha),
    y: lerp(before.y, after.y, alpha),
    z: lerp(before.z, after.z, alpha),
    hitTargets: [...after.hitTargets],
    previousButtons: [...after.previousButtons],
  };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    fighters: state.fighters.map(fighter => ({
      ...fighter,
      hitTargets: [...fighter.hitTargets],
      previousButtons: [...fighter.previousButtons],
    })),
    events: state.events.map(event => ({ ...event })),
  };
}
