# M1-VISUAL-QA — integration report (2026-10-26)

Task: M1-VISUAL-QA
Branch: `feature/m1-visual-qa`

## Scope and evidence classification
Code inspection is not a visual browser observation. Automated tests verify their assertions, not untested screen composition or hardware. This report deliberately separates **verified by source**, **verified by automation**, and **not manually observed**.

| Criterion | Evidence / result | Status |
| --- | --- | --- |
| Four fighters | Scene creates separate images, shadows, player labels and four segmented HUD entries for joined players. Sprite registry contains P1–P8 with four different headgear/stripe variants. Actual four-player screen was not inspected. | Source verified; manual pending |
| Punch/kick/jumpkick | `pose()` maps `attackMove` to existing sprite pose keys. Animation frames exist. Actual event-to-pose transitions not visually observed. | Source verified; manual pending |
| Hit, KO, respawn | Health delta triggers hit flash; KO timer and protection select their own poses. Shadows hide during KO. Visual timing not manually observed. | Source verified; manual pending |
| Station/platform | Original SVG has TURENKI sign, facade, distant layers and quiet combat plane. Reference-photo fidelity not assessed. | Source verified; manual pending |
| P1–P4 HUD, HP, scores, clock | Scene reads authoritative `health`, `score`, `remainingTicks` and renders per-player text. No screenshot/readability measurement. | Source verified; manual pending |
| Default 640×360 | `VIEWPORT.renderWidth=640`, `renderHeight=360`; `src/main.ts` uses these values. | Source verified |
| 960×540 same framing | Automated unit assertion compares logical camera coverage for 640×360 and 960×540. This is **not** an actual 960×540 browser rendering or deterministic replay test. | Math tested; render/replay pending |
| 2×/3× and mobile | Phaser FIT scaling and CSS pixelated rendering present. No device screenshots or visual observations. | Source verified; manual pending |
| GitHub Pages asset URLs | New manifest resolver tests `/`, `./` and `/TurenkiFight/` prefixes. Actual published browser/network console not observed. | Unit tested; production manual pending |
| Physical gamepads | Join and button mappings are present in scene; no hardware attached to this agent. | Not tested |

## Changes
- Added typed presentation-only `visualAssets.ts` for stable station texture key, source path and SVG raster dimensions. `StationScene.preload()` now resolves the asset through the manifest without touching simulation or HUD behavior.
- Added `visualQa.test.ts` with base-path and 640/960 camera framing assertions.
- The scene still rasterizes the 384×216 station art to the 384×216 logical camera, then scales it to 640×360; this is intentional and keeps game-world framing unchanged.

## Gameplay-owner follow-up (not changed here)
- The P1 gamepad Start path checks `gamepadSlots.get(p.index) === 'P1'`, but `gamepadSlots` is populated only with P2–P4. Consequently P1 cannot start a match via the gamepad Start button in the current source; Enter on keyboard remains available. This requires a gameplay/input owner fix and test.
- No automated test here proves that changing the configured render resolution leaves the deterministic replay checksum unchanged; it tests the presentation camera math only.

## Commands and CI
Expected project checks: `npm test`, `npm run build`, `npm run test:browser`. Results for this branch are recorded from GitHub Actions after PR creation; do not infer a manual browser pass from CI.

## Remaining acceptance work
Open the actual game in a desktop browser, join four players (gamepads as available), capture native/2×/3×/mobile screenshots, verify overlapping silhouettes and attack/KO/respawn, inspect the console and network for 404s, and test an actual 960×540 render with unchanged simulation replay. Do not mark these as passed without observations.
