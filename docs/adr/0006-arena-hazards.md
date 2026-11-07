# ADR 0006: Arena gameplay rules and the first damaging hazard

- **Status:** Proposed for implementation under the active long-term goal (M15).
- **Date:** 2026-11-07
- **Related:** [M15_ARENA2.md](../M15_ARENA2.md), [ADR 0002](0002-mode-fields.md), [ADR 0004](0004-objects-in-snapshot.md), `src/game/simulation/types.ts`, `src/game/protocol/stateSnapshot.ts`.

## Context

`GAME_DESIGN.md` says stage gameplay data - world bounds, spawns, collision and interactive objects - must be
declarative, typed and loaded by a stable arena id, never hardcoded branches in fighting rules. Today the arena is
presentation only: K-kauppa has a shelf rattle that does nothing, and the station has no arena-level hazard at all.

The owner's plan says every arena gets its own hazard. That requires the simulation to know which arena it runs in and
to apply a fixed, telegraphed hazard without turning the combat engine into arena-specific spaghetti.

## Decision

### 1. Arena id in the state

`GameState` gains optional `arena?: 'mesku' | 'kkauppa'`.

- Absent means the station, exactly like absent `mode` means Score Brawl; station states stay byte-identical.
- `createState` accepts `arena` and stores it; the strict snapshot codec accepts only known arena ids and omits the
  field for the default.
- The id is authoritative: both server and client render and simulate from the same value.

### 2. Typed arena rules, no branches in the tick loop

New `src/game/simulation/arenas.ts` exports one table:

```ts
type ArenaRules = {
  id: 'station' | 'mesku' | 'kkauppa';
  hazard: {
    periodTicks: number;      // cycle length
    warningTicks: number;     // telegraph before the event
    activeTicks: number;      // how long the hazard is dangerous
    band: { minY: number; maxY: number };  // world-space danger band
    damagePerTick: number;    // applied on a fixed cadence
    damageEveryTicks: number;
  } | null;
};
```

- K-kauppa: 2700-tick cycle (45 s), 180-tick warning (3 s), 120-tick collapse (2 s), a low shelf band, 1 damage per
  6 ticks.
- Station and Mesku keep `hazard: null` for now; their existing Deathmatch zone is a mode rule, not an arena rule.
- The tick loop reads `arenaRules(state.arena)` once per tick and applies the hazard through the same damage pipeline
  as combat, with the same hit-stop and protection rules.

### 3. Determinism and fairness

- The hazard phase is `f(tick, arena)`; no randomness, no wall clock, no extra state.
- Damage applies only in `fighting`, never during countdown or results.
- The warning is long enough to leave the band, and the band is visible in the presentation layer before it hurts.
- A hazard knockout credits no attacker and counts as a death, exactly like the zone.

### 4. Consequences and limits

- Station and Mesku fixtures stay byte-identical; only a K-kauppa match changes.
- The arena id adds one optional snapshot field; measured size impact must be reported.
- The first slice implements one hazard in one arena. More hazards are data, not new branches.
- The presentation slice must show the danger band and warning; without it the hazard is unfair and must not ship.

## Alternatives rejected

- **Presentation-only hazard.** Would keep the telegraph but never hurt, which is what the current K-kauppa slice
  does and why it is called ambience rather than a hazard.
- **Hazard damage in the mode rules.** Would tie a location's behaviour to the mode and make every arena/mode
  combination a new branch.
- **Random hazard location.** Non-deterministic and unfair; rejected outright.
