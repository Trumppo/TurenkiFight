# ADR 0005: Teams and wave state for the co-op wave mode

- **Status:** Proposed for implementation under the active long-term goal (M13).
- **Date:** 2026-11-06
- **Related:** [M13_WAVE_MODE.md](../M13_WAVE_MODE.md), [ADR 0002](0002-mode-fields.md), `src/game/simulation/types.ts`, `src/game/protocol/stateSnapshot.ts`.

## Context

The current modes are free-for-all: every fighter can damage every other fighter. A co-op wave mode needs two
things the simulation does not have: a **team** on each fighter so allies cannot damage each other and enemies target
the players, and **wave state** so the mode can count waves and end on `waves-cleared`.

## Decision

### 1. Optional team on fighters

`Fighter` gains optional `team?: 'players' | 'enemies'`.

- Absent means free-for-all: the existing modes keep byte-identical snapshots and unchanged rules.
- Combat targeting and damage filters by team only when `team` is present: a fighter never damages a teammate, and
  attacks never auto-target one.
- The mode assigns teams when the match is created: human-controlled slots and their bot allies are `players`, the
  wave opposition is `enemies`.

### 2. Optional wave state on the match

`GameState` gains optional `wave?: { index: number; countdownTicks: number; remaining: number }`.

- `index` counts cleared waves, `countdownTicks` is the pause between waves, `remaining` counts live enemies.
- Present only in `wave` mode; absent and canonically omitted everywhere else, so existing fixtures stay identical.
- Strict decoding rejects wave fields in other modes and out-of-range values.

### 3. Mode id and end reason

- `ModeId` gains `'wave'`; the strict snapshot decoder accepts it only with the wave fields.
- `EndReason` gains `'waves-cleared'`; `MatchEnded` may carry it, and the results screen ranks by score as in Score
  Brawl.

### 4. Wave lifecycle

- A wave starts when `countdownTicks` reaches zero; enemies respawn into the arena with increasing pressure (first
  slice: more enemies, same stats).
- A wave is cleared when `remaining` reaches zero; the next countdown starts.
- After the last wave the match ends with `waves-cleared`; the timer still ends the match with `time` if it expires
  first.
- Players respawn normally; the mode never eliminates a player.

## Consequences

- Existing modes are untouched: no team, no wave fields, byte-identical snapshots.
- The combat loop gains one filter (`team`), which must be tested for both friendly fire and targeting.
- Wave tuning decides whether the mode is fun; expect playtest iterations.
- The roster stays eight slots: a four-human co-op match uses four enemy slots, which caps opposition variety in the
  first slice. A separate enemy entity type is explicitly out of scope.

## Alternatives rejected

- **Friendly fire on, "co-op" by convention.** Would not feel like a co-op brawler and would make bots attack allies.
- **Enemy entities outside the roster.** Cleaner long term, but it needs a second entity system next to objects and
  exceeds the first slice.
- **Implicit teams by slot order.** Fragile and invisible on the wire; an explicit field is testable.
