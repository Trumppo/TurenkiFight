# Graphics roadmap (designer proposal, 2026-11-07)

**Status:** Implemented 2026-11-09 (G1-G6 merged). **Retro is the only supported visual style since 2026-11-11**; the former classic build path has been removed. Owner approved the track and asked for it to be executed; each
phase still needs an owner visual review in the game. Merging is not acceptance. The game is desktop only: touch
controls and mobile browsers are out of scope (owner decision 2026-11-07).

**Related:** [ROADMAP.md](ROADMAP.md), [M1_5_VISUAL_UPGRADE.md](M1_5_VISUAL_UPGRADE.md), [ARCHITECTURE_PRINCIPLES.md](ARCHITECTURE_PRINCIPLES.md),
[ADR 0006](adr/0006-arena-hazards.md).

## 1. Starting point (observed in the repository, not claimed)

- Logical canvas is **640x360**, scaled to the window. The supported visual style is retro.
- Fighters, arenas and HUD are procedural or SVG. Arena art is in `public/assets/`.
- Presentation adapters (`StationScene`, `OnlineScene`) read simulation state and events and never decide outcomes.
- Browser tests exist for layout, HUD and screenshots. Cross-platform **pixel hashes are not portable**: PR #172 failed
  CI three times on line endings and Linux font rendering. Visual checks must be semantic (sizes, contrast, element
  bounds, texture keys) plus human review of screenshots.
- The game is played with keyboard or gamepad. **There are no touch controls.** Mobile is therefore an evaluation
  target for the owner (looking at the screen), not a play target, unless the owner says otherwise.

## 2. Principles

1. **Readability before decoration.** Eight fighters on a 640x360 canvas must be distinguishable by silhouette,
   colour and a player marker, in both styles.
2. **Presentation never decides outcomes.** No graphics slice changes simulation rules, protocol or snapshot fields.
3. **Desktop only.** The game is not meant to be played on mobile. Screenshots cover the desktop sizes 640x360 and
   1280x720. Touch controls and mobile browser support are out of scope (owner decision 2026-11-07).
4. **Reduced motion is respected** for every new effect (shake, flash, particles).
5. **Mode and arena visuals are separated.** A Deathmatch zone is a mode visual; a shelf band is an arena visual.
   Both read simulation state; neither invents damage.

## 3. Phases

Each phase is one independently reviewable PR where possible.

### G1 - Desktop evaluation baseline (implemented, PR #183 and #188)

- **Goal:** make visual review repeatable. A committed matrix of screenshots and a short review note, produced by one
  command, covering retro at 640x360 and 1280x720.
- **Scope:** a test/harness script and `docs/visual/` evidence. No change to rendering.
- **Acceptance:**
  1. One command writes the matrix for the station, K-kauppa and Mesku arenas with four fighters at the two desktop sizes.
  2. Each capture records its size, style, arena and fighter count in a manifest.
  3. The checks are semantic (canvas size, HUD inside viewport, minimum text size 14 px) and do not pin PNG bytes.
  4. Existing browser suites stay green in both styles.
- **Owner gate:** the owner opens the matrix on a phone and says which sizes are unreadable.

### G2 - Fighter readability for eight players (implemented, PR #186)

- **Goal:** each fighter has a clear silhouette and a player marker (ring or nameplate colour) that survives crowding.
- **Scope:** `src/game/presentation/` only.
- **Acceptance:** at 640x360 (and 1280x720) with eight fighters, each slot has a distinct marker colour with a non-colour cue
  (number or shape); contrast of the marker against the floor meets a stated threshold; retro keeps its palette.
- **Owner gate:** playtest or phone review of an eight-fighter capture.

### G3 - Hit and knockout feedback (implemented, PR #190)

- **Goal:** hits read at a glance without slowing the fight. Uses the existing `HitLanded` and `Knockout` events.
- **Scope:** presentation effects (spark on hit, KO flash, short tint on the victim).
- **Acceptance:** an effect appears on each hit event, is capped in count, respects reduced motion and mute, and adds
  no simulation or wire change.
- **Owner gate:** owner judges whether it adds impact or clutter.

### G4 - Arena depth and background contrast (implemented, PR #189)

- **Goal:** the background supports combat rather than competing with it: lower contrast behind the fighting band,
  clear floor edge, layered depth cues.
- **Scope:** arena visuals (`arenaVisuals.ts`, SVG assets). Station and Mesku must keep their accepted look unless the
  owner approves a change.
- **Acceptance:** fighter-to-background contrast measured on captures meets the threshold chosen in G2; station and
  Mesku changes are listed and approved explicitly.
- **Owner gate:** owner approves each changed arena.

### G5 - Desktop HUD and results layout (implemented, PR #191)

- **Goal:** the HUD and results stay readable at small desktop windows (for example 640x360 logical canvas scaled to a
  laptop window).
- **Scope:** `src/style.css`, HUD layout in presentation.
- **Acceptance:** at 640x360 and 1280x720 no HUD text is clipped, minimum text size is 14 px, and the arena is not
  pushed out of view.
- **Owner gate:** desktop review.

### G6 - Hazard and zone visual pass (implemented, PR #192)

- **Goal:** the K-kauppa shelf band (arena) and the Deathmatch zone (mode) get distinct, readable warnings.
- **Scope:** presentation only. The zone visual reads mode state; the shelf visual reads arena rules. Neither changes
  damage.
- **Acceptance:** a viewer can tell which hazard is arena-bound and which is mode-bound from the visual language alone;
  both are visible before they hurt.
- **Owner gate:** owner review of the two warnings in both styles.

## 4. What this roadmap does not include

- Touch controls, mobile play and mobile browser support. **Owner decision 2026-11-07: not part of the game.**
- New characters (M15-CHARACTERS remains blocked until a concrete need).
- Real audio samples (owner-blocked).
- Pixel-hash baselines as acceptance criteria.

## 5. Implemented state (2026-11-09)

| Phase | What shipped | Evidence |
| --- | --- | --- |
| G1 | `npm run visual:matrix` writes 12 desktop captures plus a manifest | PR #183, #188 |
| G2 | Compact P1-P8 numberplates above each fighter, contrast >= 3 measured against five floor colours | PR #186 |
| G3 | Hit sparks capped at 12, KO ring and flash capped at 8, reduced motion keeps a static cue | PR #190 |
| G4 | K-kauppa background quieted: muted lower shelf, quieter checkout, softer floor grid, clearer floor edge | PR #189; station and Mesku unchanged |
| G5 | HUD text >= 14 px, status wraps, key hint on its own row at small desktop widths | PR #191 |
| G6 | Amber arena band with shelf icon vs cyan contracting mode zone, each with an explicit ARENA/MODE label | PR #192 |

Remaining owner checks: look at the game at 640x360 and 1280x720 in both styles and say whether G2, G3, G4 and
G6 read as intended in motion. G3's spark is deliberately subtle and is the most likely candidate for tuning.

## 6. Open questions for the owner

1. ~~Phone viewing or phone play~~ **Answered 2026-11-07: neither. The game is desktop only.**
2. ~~Should the retro style become the default after G2 and G4, or stay opt-in?~~ **Resolved 2026-11-11: retro-only.**
   The classic build path and its visual test matrix were removed; retro is the only supported style.
3. Is the K-kauppa band visual acceptable before the owner playtest, or should G6 wait?

## 7. Future arena photo-based updates (2026-11-11)

A repeatable workflow now exists for updating arena backgrounds from real photos:
- Collect multiple real photos (angles + seasons).
- Generate 320×180 retro reference image(s) as aids (not final assets).
- Graphics manually recreates clean SVG matching game style + correct real colors + quiet platform.
- See `docs/ART_PHOTO_REFERENCE_WORKFLOW.md` for the full process and reference storage rules.

First application: Turenki station (light pinkish-white facade instead of previous ochre). Same process will be used for K-kauppa and Mesku when ready.
