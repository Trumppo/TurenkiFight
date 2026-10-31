# M1.5-VIS-01 — Retro raster prototype report

## Scope
Original early-1990s inspired 320×180 art grid for the Turenki station; initial 16×24 P1 sprite cells, now superseded by a detailed 32×48 P1 sprite pass with 1-pixel facial accents and 2-pixel contour blocks, retaining the existing 32×48 texture contract. A P1-only 48×64 build variant is implemented as an owner-approved experimental opt-in, but is not selected as the default. Preview is **opt-in** using `VITE_VISUAL_STYLE=retro`. Without the flag, the M1 graphics stay untouched. P2–P4 continue to use the M1 sprite generator.

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
- CI at commit `d732513`: all four workflows succeeded, including retro-mode unit tests, build and Playwright: [retro visual QA run](https://github.com/Trumppo/TurenkiFight/actions/runs/41106802196). At PR #21 head bbee0c1, all four relevant workflows passed; that evidence predates the local match-screenshot additions.
- Added Playwright `tests/browser/retro.spec.ts` for 640×360, 1280×720, 1920×1080 and 390×844 screenshot capture in both retro and classic modes. Workflow `.github/workflows/retro-visual-qa.yml` uploads `m1-5-retro-screenshots` as an Actions artifact. **All eight screenshot files were produced** in [Actions artifact `m1-5-retro-screenshots`](https://github.com/Trumppo/TurenkiFight/actions/runs/41106802196/artifacts/13001247875). The initial screenshot review found the TURENKI station sign was obscured by HUD/lobby overlay; the sign was moved lower on the facade. Local screenshots use separate retro-, retro-expanded- and classic- filename prefixes so sequential baseline and expanded runs do not overwrite each other. Lobby and started-match views cover 640x360, 2x, 3x and mobile sizes. CI artifact upload for this local follow-up is pending. The screenshot view also shows the existing lobby status text obscures the upper station and should be addressed in VIS-04, without changing the gameplay join flow.
- The retro station SVG is rasterized to a 640×360 texture (integer 2× source art) and displayed over the unchanged 384×216 world; at default 640×360 output this avoids non-integer 320→384 resampling. The Playwright suite joins P2, starts the match, moves P1 right with the normal D-key input until x exceeds 160 so the station sign is visible, then captures the active match. The test does not change the game spawn or scene. Pose-sheet and kick-strip outputs show sprite poses. The owner approved this one-fighter/station visual proof and authorized PR #21 merge on 2026-10-31. This does not accept the full M1.5 milestone or make 48×64 the default. The game renderer remains 640×360 with its existing 384×216 world-camera mapping; this task changes only the art grid, not game coordinates.
- Initial 16×24 facial details were insufficient for the target fidelity. The current P1 uses native 32×48 detail, and 320×180 remains provisional for the stage. Higher facial pixel density or layered sprite accessories may prove preferable after side-by-side screenshots.
- P1 only has the new art; a second detail pass adds roof tile rhythm, timber joints, station lamp and platform notice to the stage. P2–P4, HUD and other visual elements deliberately remain unchanged.

## Local follow-up verification

- Retro Playwright: 13 passed, 1 skipped (expanded-only check).
- Classic Playwright: 9 passed, 5 skipped (retro-only checks).
- Expanded retro Playwright: 12 passed, 2 skipped (base-size-specific checks).
- npm test: 39 passed. npm run build: passed with a large-chunk warning.
- These are local results on the uncommitted follow-up worktree, not CI results for an updated PR head. Local screenshots are in artifacts/visual. Independent Tester rechecked sequential baseline retro, classic and expanded runs: prefixes remained separate and the helper reached two-player fighting before moving P1 with D. No CI on the updated head or physical-controller testing was performed.

## Owner decision and scope
Owner approved the visual direction represented by this prototype and authorized PR #21 merge on 2026-10-31. This approval is limited to the one-fighter/station proof; it does not accept M1.5 or authorize mass asset conversion. VIS-02 through VIS-05 remain separate work packages.
## Detail-pass follow-up
Owner feedback: first proof was clearly below the desired 1990–1993 fighting-game visual fidelity. Commit series starting `f479205` adds higher-resolution P1 facial/outfit detail, more expressive poses and richer station facade textures without changing any gameplay contracts. This detail pass improved facial/outfit detail and station facade textures without changing gameplay contracts. Current local test results are recorded above; owner visual approval is recorded for the prototype only, while CI on the updated PR head remains pending.
