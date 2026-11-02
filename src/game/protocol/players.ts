/**
 * Single source of truth for the supported maximum roster size.
 *
 * Owner decision 2026-11-02 (`docs/M8_PLAYER_LIMIT_DECISION.md`): eight players.
 * Every protocol, session and server bound derives from this value; no layer
 * may keep a private copy. Raising it later is a reviewed decision plus a fresh
 * measurement, not a local constant edit.
 */
export const MAX_PLAYERS = 8;

/** Smallest legal roster. A match always has at least one fighter. */
export const MIN_PLAYERS = 1;

/** Roster sizes form a closed interval; callers fail closed outside it. */
export function isSupportedPlayerCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= MIN_PLAYERS && value <= MAX_PLAYERS;
}
