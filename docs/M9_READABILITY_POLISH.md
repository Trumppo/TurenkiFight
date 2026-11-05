# M9 readability polish: knocked-out fighters, hit flashes and result labels

**Status:** Implemented in PR #144 (merged `0dff4ef`), independently gated by Tester.
**Origin:** the M8 QA finding that a KO'd fighter renders as a flat blob and that the hit flash tints the
whole sprite, plus the cosmetic result-label finding from the M9 celebration gate. The owner asked for a small
polish package on 2026-11-03.

## 1. Problem restated from evidence

In `StationScene.updateFighters` the local scene does two things that destroy silhouette information:

| Situation | Current code | Effect |
| --- | --- | --- |
| Fighter eliminated (`f.eliminated`) | `setTintFill(0x4a5561).setAlpha(0.72)` | Every pixel becomes the same grey, so the KO pose and the character outline disappear; in a crowd the fighter reads as a blob, not as a specific player. |
| Fighter just took damage | `setTintFill(0xffe3a0)` on alternate frames (retro preview) | Half the flash frames are a flat colour block; in an eight-fighter crowd the reader loses the sprite for ~100 ms and cannot tell who was hit. |

The HUD already says `P1 KO`, so the information exists — the problem is that the arena does not corroborate it.

## 2. What "readable" means (accept criteria)

1. **Shape, not only colour.** An eliminated fighter must still be identifiable as that fighter: outline, headgear
   and the `ko` pose stay visible. A multiply tint, alpha, or a partial overlay is acceptable; a full-surface fill
   is not.
2. **KO is distinguishable from standing.** At 640×360 and 390×844, a screenshot must let a reader point at the
   eliminated fighter and say which player it is, and see that it is down rather than standing.
3. **Hit feedback does not erase the sprite.** Whatever flash is used, at least half of the frames during the flash
   must keep the silhouette and the character's identifying features. A brief full-white frame is acceptable only if
   it cannot be confused with elimination.
4. **No colour-only encoding.** The difference between "down" and "standing" must survive a greyscale screenshot
   (pose, marker, or outline), not just a hue change.
5. **No simulation, protocol, server or bot change.** This is presentation only: `src/game/presentation/**`,
   `src/style.css` and browser tests. P1–P8 texture hashes must stay identical, and pinned simulation fingerprints
   must not move.
6. **No regression to the accepted baseline.** Existing visual tests (retro contracts, VIS-05, roster, celebration,
   reset) must keep passing; the classic style must keep its current behaviour unless the change is explicitly
   style-scoped.

## 3. Scope of the slice

- `src/game/presentation/StationScene.ts` — tint/flash handling, optional KO marker.
- `src/game/presentation/fighterSprites.ts` — only if a `ko` pose needs a marker baked in (prefer scene-level
  markers, so texture hashes stay stable).
- `src/style.css` — only if a DOM-based marker is chosen.
- `tests/browser/` — a new readability spec plus updates to existing visual specs where they assert current tints.

Out of scope: new characters, animation frames, new poses beyond what exists, audio, and any change to how the
simulation decides a KO.

## 4. Second, cosmetic slice

The celebration panel heading `PLACES 4–8` is a fixed range, so a five-player roster shows places 4–6 under a
"4–8" label (Tester finding on PR #143). Replace it with a neutral heading that matches the roster, keep the
14 px minimum and the no-ellipsis rule, and keep the existing celebration tests green.

## 5. Tests

- Browser test proving an eliminated fighter is not a single flat colour: sample the rendered sprite region and
  require more than one distinct colour, and require the KO pose key rather than a fill tint.
- Browser test proving a hit flash keeps at least half its frames silhouette-bearing.
- Greyscale screenshot check for down-versus-standing, at native and mobile viewports.
- Existing suites: `npm test`, `npm run build`, full `npm run test:browser`, `git diff --check`.

## 6. Risks

- Tint changes are cheap but can make a dark fighter hard to see on the dark arena floor; contrast must be checked
  on both styles.
- A KO marker must not collide with the eight-fighter overlap; keep it small and above the head.
- The retro style is the accepted look; do not soften the hit feedback so much that hits stop reading.
