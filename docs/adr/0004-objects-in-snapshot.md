# ADR 0004: Throwable objects in the simulation and on the wire

- **Status:** Proposed for implementation under the active long-term goal (M12).
- **Date:** 2026-11-06
- **Related:** [ADR 0002](0002-mode-fields.md), [M12_OBJECTS.md](../M12_OBJECTS.md), `src/game/protocol/stateSnapshot.ts`, `src/game/protocol/inputFrame.ts`.

## Context

M12 needs throwable objects: pick up, hold, throw, hit, break. The simulation is a deterministic fixed-step loop and
the wire is a strict v1 codec with canonical omission. Objects add two new things: a list of non-fighter entities in
the state, and one new player action.

## Decision

### 1. Objects live in the simulation state

`GameState` gains an optional `objects` array:

```ts
type SimObject = {
  id: string;            // stable, deterministic, e.g. "O1"
  kind: 'bottle';        // first slice has one kind
  x: number; y: number; z: number;
  state: 'ground' | 'held' | 'airborne' | 'broken';
  holder?: PlayerId;     // only while held or thrown by someone
  tick?: number;         // spawn or break tick, for deterministic cleanup
};
```

- Object ids are allocated deterministically from a counter in the state, never from randomness.
- Spawn cadence and positions come from a fixed table plus the seeded noise already used by bots; no wall clock, no
  `Math.random`.
- Objects are processed in a fixed order each tick: pickup, throw, flight, impact, break, cleanup. The order is
  documented and tested.

### 2. The wire carries objects optionally

- `StateSnapshot` gains optional `objects`, canonically omitted when empty. States without objects keep byte-identical
  snapshots, so the pinned Score Brawl fixtures do not move.
- The decoder is strict: unknown kinds, invalid states, a holder that is not in the roster, or coordinates outside
  the arena are rejected.
- The size impact must be measured on a fixture with the maximum object count and reported as measured bytes; no
  estimates presented as measurements.

### 3. One new player action

- `PlayerInput` gains `grab?: boolean` (pickup when empty-handed and near an object; throw when holding).
- Input frame encoding gains one button bit. The strict decoder rejects unknown trailing data as before; the button
  is optional so existing recordings and fixtures remain valid.
- Keyboard: P1 uses `T`; other keyboard layouts map the same action to their existing free key. Gamepads use one
  documented face button. The keyboard guide is updated.

### 4. Bots use the same rules

- `botPolicy` may pick up a nearby object and throw it at the nearest opponent, using the same seeded noise and pure
  function of state.
- Bot throw rate is bounded and measurable.

## Consequences

- Every snapshot with objects grows by roughly 30-60 bytes per object depending on field count; measure, do not
  guess.
- The simulation gains a new entity list that must be included in replay fingerprints, ranking is unaffected, and
  object state changes emit events only where the game needs feedback.
- Existing pinned fixtures without objects stay unchanged, which is the regression gate for this ADR.

## Alternatives rejected

- **Client-side objects.** Would desynchronise hits and break determinism.
- **Objects as pseudo-fighters.** Reuses codecs but pollutes the roster, ranking, modes and the eight-player limit.
- **A button-less automatic throw.** Removes the skill expression and makes bots and humans indistinguishable.
