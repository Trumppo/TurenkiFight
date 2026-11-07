# Graphics roadmap (designer proposal, 2026-11-07)

**Status:** Proposal. Nothing here is owner-approved for implementation beyond the first slice the owner asked for
("graphics improvement, evaluable on mobile"). Each phase ends with an owner visual review. Merging is not acceptance.

**Related:** [ROADMAP.md](ROADMAP.md), [M1_5_VISUAL_UPGRADE.md](M1_5_VISUAL_UPGRADE.md), [ARCHITECTURE_PRINCIPLES.md](ARCHITECTURE_PRINCIPLES.md),
[ADR 0006](adr/0006-arena-hazards.md).

## 1. Starting point (observed in the repository, not claimed)

- Logical canvas is **640x360**, scaled to the window. Two visual styles exist: `classic` (default) and `retro`
  (`VITE_VISUAL_STYLE=retro`, accepted in M1.5 and M9).
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
3. **Mobile is a viewing target.** Every phase has screenshots at a phone portrait size (390x844) and landscape
   (844x390) plus the desktop sizes 640x360 and 1280x720, so the owner can judge them on a phone.
4. **Reduced motion is respected** for every new effect (shake, flash, particles).
5. **Mode and arena visuals are separated.** A Deathmatch zone is a mode visual; a shelf band is an arena visual.
   Both read simulation state; neither invents damage.

## 3. Phases

Each phase is one independently reviewable PR where possible.

### G1 - Mobile and multi-size evaluation baseline (first slice, no visual change)

- **Goal:** make visual review repeatable. A committed matrix of screenshots and a short review note, produced by one
  command, covering classic and retro at 640x360, 1280x720, 390x844 portrait and 844x390 landscape.
- **Scope:** a test/harness script and `docs/visual/` evidence. No change to rendering.
- **Acceptance:**
  1. One command writes the matrix for the station, K-kauppa and Mesku arenas with four fighters.
  2. Each capture records its size, style, arena and fighter count in a manifest.
  3. The checks are semantic (canvas size, HUD inside viewport, minimum text size 14 px) and do not pin PNG bytes.
  4. Existing browser suites stay green in both styles.
- **Owner gate:** the owner opens the matrix on a phone and says which sizes are unreadable.

### G2 - Fighter readability for eight players

- **Goal:** each fighter has a clear silhouette and a player marker (ring or nameplate colour) that survives crowding.
- **Scope:** `src/game/presentation/` only.
- **Acceptance:** at 640x360 with eight fighters, each slot has a distinct marker colour with a non-colour cue
  (number or shape); contrast of the marker against the floor meets a stated threshold; retro keeps its palette.
- **Owner gate:** playtest or phone review of an eight-fighter capture.

### G3 - Hit and knockout feedback

- **Goal:** hits read at a glance without slowing the fight. Uses the existing `HitLanded` and `Knockout` events.
- **Scope:** presentation effects (spark on hit, KO flash, short tint on the victim).
- **Acceptance:** an effect appears on each hit event, is capped in count, respects reduced motion and mute, and adds
  no simulation or wire change.
- **Owner gate:** owner judges whether it adds impact or clutter.

### G4 - Arena depth and background contrast

- **Goal:** the background supports combat rather than competing with it: lower contrast behind the fighting band,
  clear floor edge, layered depth cues.
- **Scope:** arena visuals (`arenaVisuals.ts`, SVG assets). Station and Mesku must keep their accepted look unless the
  owner approves a change.
- **Acceptance:** fighter-to-background contrast measured on captures meets the threshold chosen in G2; station and
  Mesku changes are listed and approved explicitly.
- **Owner gate:** owner approves each changed arena.

### G5 - Mobile-friendly HUD layout

- **Goal:** the HUD and results remain readable in portrait and landscape phone sizes.
- **Scope:** `src/style.css`, HUD layout in presentation.
- **Acceptance:** at 390x844 and 844x390 no HUD text is clipped, minimum text size is 14 px, and the arena is not
  pushed out of view.
- **Owner gate:** phone review.

### G6 - Hazard and zone visual pass

- **Goal:** the K-kauppa shelf band (arena) and the Deathmatch zone (mode) get distinct, readable warnings.
- **Scope:** presentation only. The zone visual reads mode state; the shelf visual reads arena rules. Neither changes
  damage.
- **Acceptance:** a viewer can tell which hazard is arena-bound and which is mode-bound from the visual language alone;
  both are visible before they hurt.
- **Owner gate:** owner review of the two warnings in both styles.

## 4. What this roadmap does not include

- Touch controls or any mobile play mode (needs its own owner decision).
- New characters (M15-CHARACTERS remains blocked until a concrete need).
- Real audio samples (owner-blocked).
- Pixel-hash baselines as acceptance criteria.

## 5. Open questions for the owner

1. Is phone **viewing** enough for review, or is a phone **play** target wanted later? (Affects G5 scope and whether
   touch input is planned.)
2. Should the retro style become the default after G2 and G4, or stay opt-in?
   **Owner answer 2026-11-07: B.** Retro becomes the default only after the owner has approved G2 and G4.
   Until then classic stays the default and retro stays opt-in (`VITE_VISUAL_STYLE=retro`). No default change is implemented.
3. Is the K-kauppa band visual acceptable before the owner playtest, or should G6 wait?
