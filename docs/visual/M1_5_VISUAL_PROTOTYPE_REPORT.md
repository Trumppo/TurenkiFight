# M1.5-VIS-01 — Retro raster prototype report

## Scope
Original early-1990s inspired 320×180 art grid for the Turenki station; 16×24 raster P1 sprite cells scaled nearest-neighbor to the existing 32×48 texture contract. Preview is **opt-in** using `VITE_VISUAL_STYLE=retro`. Without the flag, the M1 graphics stay untouched. P2–P4 continue to use the M1 sprite generator.

## How to review
Run `npm install`, then `VITE_VISUAL_STYLE=retro npm run dev` (POSIX) or `$env:VITE_VISUAL_STYLE='retro'; npm run dev` (PowerShell). Play the existing lobby and match as usual. Compare by restarting without `VITE_VISUAL_STYLE`. This is an actual asset integration in `StationScene`, not a stand-alone mockup.

Comparison assets:
- [Original station](../../public/assets/station/turenki-station-background.svg)
- [Retro station prototype](../../public/assets/station/turenki-station-retro.svg)
- [Original procedural sprite](../../src/game/presentation/fighterSprites.ts)
- [Retro P1 procedural sprite](../../src/game/presentation/retroPrototype.ts)

## Art direction
Dark navy outlines, warm ochre station timber/plaster, muted Nordic blue windows and sky, low-contrast concrete platform and coral-red P1 coat. P1 has recognizable hair, eyebrows/eyes, highlighted nose, moustache, striped coat, blue trousers, dark shoes, and stable bottom-centre foot alignment. All 10 existing pose identifiers have four frames; idle, walk, punch, kick and hit have individual raster cues. Rendering is performed into a 16×24 scratch canvas and scaled with `imageSmoothingEnabled=false` into the 32×48 Phaser texture.

The stage art is an SVG containing rectangular raster-style shapes at the provisional 320×180 art resolution, loaded by the existing station asset key and Vite base-path resolution. It is original and does not import Dune or other commercial game art.

## Architecture
Scene changes only route station asset loading and P1 texture replacement. No changes to deterministic simulation, controls, scoring or match rules. All existing texture keys are preserved. Toggle is build-time `VITE_VISUAL_STYLE=retro`, allowing instantaneous rollback through rebuild/restart.

## Test evidence and limitations
- Static contract coverage: `src/game/presentation/retroPrototype.test.ts` checks texture keys, frame counts and asset path.
- CI: **pending at PR creation**. Do not claim that `npm test`, `npm run build` or `npm run test:browser` passed until the new branch CI run confirms this.
- Browser screenshot comparison and 2×/3×/mobile visual QA: **not captured** by this session. URLs above link to actual before/after art assets, not screenshots of a running game.
- A real game-started 640×360 integration, multi-pose raster contrast and 320×180 pixel density are for owner visual approval. The game renderer remains 640×360 with its existing 384×216 world-camera mapping; this task changes only the art grid, not game coordinates.
- Facial details at 16×24 source cells are intentionally compressed; 320×180 is provisional. Higher facial pixel density or layered sprite accessories may prove preferable after side-by-side screenshots.
- P1 only has the new art. P2–P4, HUD and other visual elements deliberately remain unchanged.

## Recommendation
Approve or request art-direction revisions for P1 and the station first. If accepted, proceed to VIS-02 (remaining fighter identities and animation polish), VIS-03 (station depth and environmental details), VIS-04 (retro HUD), and VIS-05 (screenshots, native/2×/3×/mobile review and regression gate). Do not merge this PR until visual approval.
