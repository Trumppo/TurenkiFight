# M1.5-VIS-01 — Retro raster prototype report

## Scope
Original early-1990s inspired 320×180 art grid for the Turenki station; initial 16×24 P1 sprite cells, now superseded by a detailed 32×48 P1 sprite pass with 1-pixel facial accents and 2-pixel contour blocks, retaining the existing 32×48 texture contract. Preview is **opt-in** using `VITE_VISUAL_STYLE=retro`. Without the flag, the M1 graphics stay untouched. P2–P4 continue to use the M1 sprite generator.

## How to review
Run `npm install`, then `VITE_VISUAL_STYLE=retro npm run dev` (POSIX) or `$env:VITE_VISUAL_STYLE='retro'; npm run dev` (PowerShell). Play the existing lobby and match as usual. Compare by restarting without `VITE_VISUAL_STYLE`. This is an actual asset integration in `StationScene`, not a stand-alone mockup.

Comparison assets:
- [Original station](../../public/assets/station/turenki-station-background.svg)
- [Retro station prototype](../../public/assets/station/turenki-station-retro.svg)
- [Original procedural sprite](../../src/game/presentation/fighterSprites.ts)
- [Retro P1 procedural sprite](../../src/game/presentation/retroPrototype.ts)

## Art direction
Dark navy outlines, warm ochre station timber/plaster, muted Nordic blue windows and sky, low-contrast concrete platform and coral-red P1 coat. P1 has recognizable hair, eyebrows/eyes, highlighted nose, moustache, striped coat, blue trousers, dark shoes, and stable bottom-centre foot alignment. All 10 existing pose identifiers have four frames; idle, walk, punch, kick and hit have individual raster cues. The initial 16×24 scratch-canvas pass proved too coarse for the target visual quality. P1 now renders natively at 32×48 with shaded jacket, leg folds, hair, eyes, nose and moustache, stronger punch/kick extension and hit/KO silhouettes. This intentionally relaxes the fighter art density while keeping the 320×180 station art grid provisional.

The stage art is an SVG containing rectangular raster-style shapes at the provisional 320×180 art resolution, loaded by the existing station asset key and Vite base-path resolution. It is original and does not import Dune or other commercial game art.

## Architecture
Scene changes only route station asset loading and P1 texture replacement. No changes to deterministic simulation, controls, scoring or match rules. All existing texture keys are preserved. Toggle is build-time `VITE_VISUAL_STYLE=retro`, allowing instantaneous rollback through rebuild/restart.

## Test evidence and limitations
- Static contract coverage: `src/game/presentation/retroPrototype.test.ts` checks texture keys, frame counts and asset path.
- CI at commit `d732513`: all four workflows succeeded, including retro-mode unit tests, build and Playwright: [retro visual QA run](https://github.com/Trumppo/TurenkiFight/actions/runs/41106802196). A later station-sign positioning adjustment requires CI revalidation.
- Added Playwright `tests/browser/retro.spec.ts` for 640×360, 1280×720, 1920×1080 and 390×844 screenshot capture in both retro and classic modes. Workflow `.github/workflows/retro-visual-qa.yml` uploads `m1-5-retro-screenshots` as an Actions artifact. **All eight screenshot files were produced** in [Actions artifact `m1-5-retro-screenshots`](https://github.com/Trumppo/TurenkiFight/actions/runs/41106802196/artifacts/13001247875). The initial screenshot review found the TURENKI station sign was obscured by HUD/lobby overlay; the sign was moved lower on the facade. Updated screenshots are pending. The screenshot view also shows the existing lobby status text obscures the upper station and should be addressed in VIS-04, without changing the gameplay join flow.
- The retro station SVG is rasterized to a 640×360 texture (integer 2× source art) and displayed over the unchanged 384×216 world; at default 640×360 output this avoids non-integer 320→384 resampling. A real game-started 640×360 integration, multi-pose raster contrast and 320×180 pixel density are for owner visual approval. The game renderer remains 640×360 with its existing 384×216 world-camera mapping; this task changes only the art grid, not game coordinates.
- Initial 16×24 facial details were insufficient for the target fidelity. The current P1 uses native 32×48 detail, and 320×180 remains provisional for the stage. Higher facial pixel density or layered sprite accessories may prove preferable after side-by-side screenshots.
- P1 only has the new art; a second detail pass adds roof tile rhythm, timber joints, station lamp and platform notice to the stage. P2–P4, HUD and other visual elements deliberately remain unchanged.

## Recommendation
Approve or request art-direction revisions for P1 and the station first. If accepted, proceed to VIS-02 (remaining fighter identities and animation polish), VIS-03 (station depth and environmental details), VIS-04 (retro HUD), and VIS-05 (screenshots, native/2×/3×/mobile review and regression gate). Do not merge this PR until visual approval.
\n## Detail-pass follow-up\nOwner feedback: first proof was clearly below the desired 1990–1993 fighting-game visual fidelity. Commit series starting `f479205` adds higher-resolution P1 facial/outfit detail, more expressive poses and richer station facade textures without changing any gameplay contracts. The earlier CI evidence applies to the preceding revision; **new detail-pass CI and fresh screenshot inspection must pass before requesting owner approval**.\n