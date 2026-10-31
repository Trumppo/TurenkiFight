# M1.5 VIS-05 — Independent tester evidence checkpoint

Date: 2026-10-31. Verdict: **IN PROGRESS — NOT OWNER ACCEPTED**.

## Verified automated evidence

- PR #68, head `ebc02e446c4e7eb5d3c7859863a06769e05fe4d0`, squash-merged to main as `3784448b10407340b6ae19a047818c895bc4ae63`.
- Five PR-head GitHub Actions workflows completed successfully: Agent task validation, Agent PR tracking, CI and browser smoke tests, Game Test Harness, and M1.5 retro prototype visual QA.
- Retro visual QA run ID **41214564812** uploaded artifact **m1-5-retro-screenshots**, artifact ID **13047384075**, 1,003,144 bytes, non-expired when checked.
- `tests/browser/retroScaleVisual.spec.ts` checks station scene readiness, backdrop texture, P1–P4 idle/punch/kick/hit/ko/respawn texture keys, logical canvas dimensions 640×360, viewport fit, and screenshots at 640×360, 1280×720, 1920×1080, and 390×844.
- These are *structural and execution* checks, not visual-perception or contrast assertions.

## Still unverified

1. Independently open and inspect the actual screenshot artifact at all four viewport sizes. Compare fighter silhouettes, Turenki sign, scoreboard/HP/timer, hit cues, and mobile legibility. Artifact existence alone does not establish visual quality.
2. Verify production GitHub Pages assets and browser console/network behavior. Direct public Pages access was not available from the tester's web fetch, so do not infer a successful published deployment from PR CI.
3. Obtain explicit owner acceptance of M1.5. Do not mark the milestone accepted or task done before this approval.

## Decision

Automated QA: **PASS** on the exact PR #68 head. Release/visual acceptance: **PENDING**. No claim of manual screenshot review, live Pages verification, or owner sign-off.

## Independent screenshot review — 2026-10-31

The tester downloaded GitHub Actions artifact 13047384075 and opened the actual PNGs, including `retro-match-native.png`, `retro-match-2x.png`, `retro-match-3x.png`, `retro-match-mobile.png`, `vis-02b-four-fighter-pose-sheet.png`, and `retro-P1-pose-sheet.png`.

**Finding VIS05-01 — native browser clipping (release blocker):** The 640×360 *page screenshot* shows the large title/subtitle and HUD, but the lower arena and fighter feet extend beyond the captured viewport. A 640×360 logical canvas existing in the DOM does not guarantee the entire page composition fits a 640×360 browser window. Reproduce with a 640×360 browser viewport; check vertical scroll and the canvas bottom edge, then either adapt the surrounding page layout or clarify an explicit fullscreen mode.

**Finding VIS05-02 — 3× desktop scaling (review needed):** At a 1920×1080 viewport the game remains comparatively small with substantial unused surrounding space. Assess whether a larger integer display scale should be offered without changing logical 640×360 simulation/camera.

**Finding VIS05-03 — mobile readability (review needed):** On a 390×844 viewport the arena fits horizontally, but fighter labels, HUD and instructions are very small. Verify at physical-device viewing distance and consider responsive external text/controls.

**Positive observations:** Four-fighter pose sheet shows differentiated colour/outfit silhouettes; P1 pose sheet includes idle, walk, depth, punch, kick, jump, jumpkick, hit, KO and respawn. The station sign and architecture are recognisable. These static frames do not establish animation timing or hit-feedback quality.

**Updated gate:** Automated CI **PASS**; screenshot inspection **FAIL / NEEDS FIX** due to VIS05-01. Pages production verification and owner acceptance remain pending. Do not mark VIS-05 done.
