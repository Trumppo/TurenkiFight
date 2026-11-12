# M12: throwable objects and the chaos layer

**Status:** Design spec, 2026-11-06. Owner chose this direction after asking why bots never throw. Not implemented.
**Related:** [ADR 0004](adr/0004-objects-in-snapshot.md) (proposed), [GAME_DESIGN.md](GAME_DESIGN.md) object system, [LONG_TERM_PLAN.md](LONG_TERM_PLAN.md) M12.

## 1. Why

Throwing does not exist in the game: the simulation has punch, kick, jumpkick and jump only. The owner wants
throwing, chose the **object system** over a body-to-body grab, and the project goal is 80 % chaos. Objects are the
most direct chaos source that still reads fairly: a bottle you can see, pick up and throw.

## 2. First slice: one object, one throw

Keep the first slice small and testable:

- **Object type: bottle.** A single type with fixed physics and damage. More types (chair, sign) come after the
  slice works.
- **States:** `ground`, `held`, `airborne`, `broken`.
- **Spawn:** deterministic schedule; bottles appear at fixed spawn points on a fixed tick cadence, at most a few at a
  time. No randomness beyond the existing seeded noise.
- **Pickup:** a fighter within reach and facing the object picks it up with the grab action.
- **Throw:** the grab action while holding throws the object in the facing direction with a small arc; it damages the
  first opposing fighter it hits and breaks.
- **Ground impact:** an object that lands without hitting anyone breaks after a short bounce.
- **Held object:** visible in the holder's silhouette; the holder cannot attack with punches while holding (or the
  throw replaces the attack, to keep it simple).
- **Bots:** use the same rules; they pick up a nearby object and throw it at the nearest opponent.

## 3. Input

A new action is needed. Proposal:

- Player 1: `T` (grab/pickup, and throw while holding).
- Players 2-4 keyboards: their existing grab-equivalent key, or the same action on their layout.
- Gamepads: one face button that is currently unused, documented in the keyboard guide.

This is a protocol change (a new input field), so it needs ADR 0004 before implementation.

## 4. Wire and determinism

- Snapshots gain an optional object list: `objects: [{ id, kind, x, y, z, state, holder? }]`, canonically omitted when
  empty, exactly in the spirit of ADR 0002.
- Input frames gain one button bit; the strict codec rejects unknown combinations as before.
- Object ids are stable and deterministic; the tick loop processes pickup, throw, flight and impact in a fixed order.
- Bandwidth impact must be measured on a fixture with the maximum number of objects before claiming it is small.

## 5. What the player sees

- Bottles on the floor, clearly distinguishable from fighters at 640x360.
- A held bottle in the hand.
- A thrown bottle with a readable arc and an impact effect.
- Optional audio cue on pickup, throw and break (placeholder).

## 6. Accept criteria

1. A bottle can be picked up, thrown, hit a fighter for defined damage and break; all deterministic and replayable.
2. Snapshot and input codecs carry the new data with canonical omission; existing pinned bytes for states without
   objects are unchanged.
3. Bandwidth impact measured on a fixture with the maximum objects; no invented numbers.
4. Bots pick up and throw within a match; measurable count before/after in a fixture.
5. Rendered bottle, held bottle and thrown arc are readable at 640x360 and 1280x720 in retro.
6. Full suites in both builds pass; Score Brawl and Last Man Standing rules are untouched apart from the shared
   object layer.

## 7. Out of scope for the first slice

- More object types, catching, ricochets, stacking, breaking props, inventory.
- Environmental hazards from M10 (the train/zone) beyond what already exists.
- Networked object prediction; the authoritative server sends objects in snapshots like everything else.

## 8. Risks

- Objects change match balance in every mode; the first slice must be easy to disable for comparison.
- Bandwidth and snapshot size grow with object count; measure before enabling many objects at once.
- Bots throwing objects can make matches chaotic in a bad way; keep the bot throw rate bounded and measured.
