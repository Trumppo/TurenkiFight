# M10 Deathmatch identity: the shrinking platform

**Status:** Design spec, 2026-11-06. Owner chose the direction (C2) on 2026-11-06; not implemented.
**Problem:** the owner reported that Deathmatch plays almost like Score Brawl. Measured honestly, they are right:
both respawn, and the only differences are a frag limit (20) and scoring by frags instead of hits.

**Owner direction:** give Deathmatch its own identity with a **shrinking platform**, "if it can be done wisely on
our arena". Pickups (throwable objects) are a separate future object system that will apply to every mode, so they
are not a Deathmatch identity.

## 1. The rule

- **Safe platform.** The arena has a safe x-range. It starts as the full arena and shrinks in fixed steps toward the
  centre. Fighters outside it take damage over time.
- **Stage schedule.** Stage 0 is the full arena. Stages 1-5 begin **900 ticks after FIGHT** and every 900 ticks after
  that. Because the countdown is 180 ticks and the stage function is a pure function of the global tick, those are
  global ticks **1080, 1980, 2880, 3780 and 4680**. Widths as a fraction of the full range: 100 %, 88 %, 76 %, 64 %,
  52 %, 42 %. After tick 4680 the zone stays at 42 % for the rest of the match.
- **Damage.** Outside the zone a fighter loses 1 HP every 6 ticks (10 HP/s), applied deterministically after normal
  combat damage. No damage inside. A fighter who reaches 0 outside the zone is knocked out by the zone.
- **Respawn.** A respawn must land inside the current safe range, otherwise a fresh fighter would die instantly.
  Spawn x is clamped into the safe range, keeping the existing y pattern.
- **Scoring.** A zone knockout counts as a death but awards no frag to anyone: the zone is not a player. This keeps
  frag attribution honest.
- **Match end.** Unchanged: 20 frags or the 2:00 timer, with the existing frags / deaths / damage tie-break. The zone
  changes how frags are earned, not how the match ends.
- **Determinism.** The stage is a pure function of the tick, so no new random source and no new simulation state.

## 2. Why no protocol change is needed

The stage is `f(tick)` and every snapshot already carries `tick`. Both the local scene and the online client can
derive the zone from the same shared function, exactly like the timer. Presentation detects a stage change by
comparing the previous and current tick, so no new event type, no new snapshot field and no protocol bump.

Consequence: **Score Brawl and Last Man Standing bytes and pinned fingerprints must not change**. The Deathmatch
fingerprint will change, because the rules changed; that expectation must be updated deliberately and reported, not
silently replaced.

## 3. What the player sees

- A visible edge for the safe range: platform barriers or warning stripes that move inward at each stage.
- A short warning before each shrink (lights, HUD text, optional cue) so being caught outside is the player's risk,
  not a surprise.
- A HUD line with the next shrink time and the current stage, and a readable danger state for a fighter outside the
  zone.
- Online client shows the same zone from the tick, so local and online look the same.

## 4. Accept criteria

1. The zone function is pure, monotonic, documented and unit-tested at every boundary tick.
2. Outside damage is exactly 1 HP per 6 ticks, never inside, and never during countdown or results.
3. A zone knockout increments deaths, awards no frag, and the respawn lands inside the current safe range.
4. Deathmatch still ends on 20 frags or the timer, and the tie-break and ranking still match `rankMatch`.
5. Score Brawl and Last Man Standing pinned fingerprints and bytes are unchanged; the Deathmatch fingerprint is
   updated with an explicit note.
6. The zone is visible and understandable at 640x360 and 1280x720, and the online client derives the same bounds.
7. Tests: unit tests for the stage function, damage cadence, zone KO and respawn clamping; a browser test that the
   zone is rendered and the HUD shows the stage; the full suites in both builds.

## 5. Out of scope

- Pickups and throwable objects: a separate object system for all modes.
- Vertical (y) shrinking and closing hazards.
- Bounty or crown mechanics; the owner may add a layer later.
- Changing the match length, the frag limit or the tie-break.

## 6. Risks

- A shrinking zone with eight fighters on a 640x360 arena can become a blender. The stage widths are starting values
  and must be re-tuned after an owner playtest; keep them in one constant table.
- Zone damage and combat damage can KO on the same tick; the ordering must be fixed and tested so the death is
  attributed consistently.
- The Deathmatch fingerprint change is expected but must be reviewed, not rubber-stamped.
