# M12 station events: shared, telegraphed ambience

**Status:** Design spec, 2026-11-07. Part of the active long-term goal (M12). Presentation only.

## 1. What this is, and what it is not

`M12_OBJECTS.md` lists "station events: the train warning becomes a shared hazard in more modes". Adding **damage**
in more modes is a rules change and needs an owner decision plus mode-rule support, so this slice does **not** add
any damage. It delivers the shared, telegraphed station ambience:

- a train announcement and platform-light sequence,
- a station "event" line in the HUD while it runs,
- an optional procedural audio cue (mute-safe, gesture-gated),
- the same sequence in local and online scenes, derived from the tick so both sides agree.

Damage stays where the mode rules already define it (the Deathmatch shrinking-zone hazard). If the owner later wants
the train to hurt in other modes, that is a rules slice, not this one.

## 2. Behaviour

- The station event runs on a fixed tick cycle (for example every 60 s, warning 5 s, pass 3 s), purely from the
  simulation tick; no new state and no protocol change.
- The warning is visible before anything happens, and nothing harmful happens at all in this slice.
- The event is quiet by default: a light pulse and one HUD line, no screen-filling overlay, no repeated sound spam.
- Online and local derive the same cycle from the snapshot tick, so both shows are identical.

## 3. Accept criteria

1. The event cycle is a pure function of the tick; local and online agree.
2. No damage, no mode-rule change, no protocol change.
3. The audio cue fires once per event, respects mute and does not restart an audio context.
4. The HUD line appears only during the event and does not push other information out at 640x360.
5. Existing visual and audio suites stay green; a browser test covers the visible/audible event.
6. Screenshots in classic and retro at 640x360 and 1280x720 inspected.

## 4. Out of scope

- Damage from the train in any mode (rules slice, owner decision).
- New arenas or hazards.
- Changing the zone hazard schedule.
