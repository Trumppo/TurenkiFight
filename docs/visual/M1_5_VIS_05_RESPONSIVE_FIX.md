# VIS-05 responsive visual remediation — 2026-11-02

## Scope and behavior

Addressed only the measured VIS05-02 / VIS05-03 findings from `M1_5_VIS_05_REVIEW_2026-11-02.md`.

- Default remains **Fit**. The page's SCALE control can select **2× integer**, which sets `?scale=2` and renders the unchanged 640×360 canvas backing at exactly 1280×720 CSS pixels. The selection is shareable in the URL; `?scale=fit` is not needed, since Fit removes the parameter. At 1280×720 it fills the viewport; at 1920×1080 it is centered. If either axis is too short/narrow, it falls back to responsive Fit rather than clipping or forcing 2×.
- Scores, timer, player IDs/labels and lobby/match status now use a DOM HUD with a retro slate/ochre treatment. It overlays only the reserved scoreboard strip at desktop sizes; on narrow screens it moves above the canvas. Text is at least 14 CSS px; the timer scales from 14px in short-height mode / 16px on mobile to 25.6px at 1280px wide and 28px at 1920px wide. Game-state values are display-only and do not feed into simulation.
- Reduced page chrome at 1280×720 to remove the prior ~20px vertical scroll. Scores render inline in one compact row, fixing the isolated `0` wrap.
- No changes to simulation, protocol, camera/render configuration, input mappings, fighter pose keys or animation timing.

## Browser measurements

Chromium, DPR 1. “Unused area” is viewport area minus canvas CSS area. Fit-mode canvas backing remains 640×360. Values measured from `getBoundingClientRect()`, CSS computed styles and document scroll dimensions after the scene became active.

| Viewport | Before (Fit): canvas scale / unused area / HUD text | After Fit: canvas CSS bounds; HUD px | After 2× mode | Scroll |
|---|---|---|---|---|
| 640×360 | 0.7347×; 106,034 px² (46.0%); old scene fonts ≈11.0px player / 12.2px timer (derived from render scale) | (88.89,54,470.22,264.48); HUD min 14px / timer 14px | Falls back to Fit | none |
| 1280×720 | 1.5×; 403,200 px² (43.8%); old HUD 25px player / 27.5px timer; page was 740px high (20px scroll) | (164,69,960,540); HUD min 21.76px / timer 25.6px | (0,0,1280,720), exact **2× integer**; HUD 21.76px / timer 25.6px; unused 0 | none; document 720px |
| 1920×1080 | 1.5×; 1,555,200 px² (75.0%); old HUD 25px player / 27.5px timer | (484,122,960,540); HUD min 24px / timer 28px | (320,180,1280,720), exact **2× integer**; HUD 24px / timer 28px; unused 1,152,000 px² (55.6%) | none |
| 390×844 | 0.5594×; 257,068 px² (78.1%); old HUD 9.3px player / 10.3px timer | (16,305.5,358,201.38); HUD min 14px / timer 16px, external HUD ends y=196.5 before canvas y=305.5 | Falls back to Fit | none |

Overlay bounds remain within the existing HUD-only strip: y=48..87.09 against the y=96.86 boundary at 640×360; y=63..123.02 against y=156.5 at 1280×720 Fit; y=116..181.59 against y=209.5 at 1920×1080 Fit; 76.02px tall against the 116.67px reserved strip in 1280×720 2×; and 81.59px tall against the 116.67px reserved strip in 1920×1080 2×. At 390×844, the HUD is in normal document flow and does not overlap the canvas. At 640×360 with a stale `?scale=2`, it falls back to Fit, stays inside the viewport and hides the nonessential controls disclosure/scale selector to avoid scrolling.

Before the remediation, the review measured 1.5× fractional Fit at 1280×720 and 1920×1080; mobile in-canvas HUD lines were 9.3–10.3 CSS px; and the 1280×720 document was 740px high (20px scroll). In default Fit, the canvas scale and area remain unchanged; responsive DOM text now scales from 14px at the smallest tested layouts up to 24px at 1920×1080, with a 28px timer, while page scroll is removed. The 2× mode is opt-in; 1920×1080 still has unused space in both modes, reduced from 75.0% to 55.6% in the larger mode.

## Screenshot inspection

Captured and visually inspected full-page Chromium screenshots for all requested viewports, plus both 2× sizes. Local artifacts (git-ignored):

- `artifacts/visual/vis-05-arena-native.png`
- `artifacts/visual/vis-05-arena-double.png`
- `artifacts/visual/vis-05-arena-triple.png`
- `artifacts/visual/vis-05-arena-mobile.png`
- `artifacts/visual/vis-05-integer-2x-1280.png`
- `artifacts/visual/vis-05-integer-2x-1920.png`
- `artifacts/visual/vis-05-four-fighters-desktop.png`
- `artifacts/visual/vis-05-four-fighters-mobile.png`

Inspection: retro palette and station remain intact; the two-times option fills and centers as intended; all four fighter sprites remain visibly distinct and their matching HUD slots remain distinct at desktop and mobile; the mobile HUD sits above the arena without obscuring fighters; score remains on one line. These are browser/DPR-1 checks only, not a physical-phone acceptance.

## Verification

- `npm test` — 37 files, 254 tests passed.
- `npm run build` — passed. Vite emitted the existing large-chunk advisory (~1.50 MB minified JS); build succeeded.
- `VITE_VISUAL_STYLE=retro npx playwright test tests/browser/retroScaleVisual.spec.ts` — 11 tests passed: four existing viewport regressions, 1280/1920 2× scaling and centering, minimum HUD typography at 1920/mobile, short-viewport 2× fallback, and four-fighter sprite/HUD distinction at desktop/mobile. The 1280 2× test selects the option through the actual page control.

Physical-device DPR, font appearance, glare, viewing distance and touch behavior remain unverified. No PR or commit was created as instructed.
