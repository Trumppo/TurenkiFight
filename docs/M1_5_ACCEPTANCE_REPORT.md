# M1.5 acceptance review — retro raster visual upgrade

**Decision: ACCEPTED WITH DOCUMENTED LIMITATIONS by the project owner on 2026-11-01.** This records an owner approval; it does not accept future M1.5 work packages beyond the items listed here.

## Scope reviewed

M1.5 was a visual-only milestone: early-1990s raster treatment for the Turenki station, four distinguishable fighters, retro HUD and hit feedback, with unchanged deterministic simulation, controls, scoring and match rules. Classic rendering remains available as a rollback path.

## Implemented baseline on `main`

| Work package | Merge evidence |
| --- | --- |
| VIS-01 P1 + station proof | PR #21, merge `c0ae871` |
| VIS-02A P2 retro fighter | PR #30, commit `d199fc5` |
| VIS-02B P3/P4 retro fighters | PR #36, commit `d059579` |
| VIS-03 station refinement | PR #44, commit `b8a53e7` |
| VIS-04 retro scoreboard | PR #39, commit `9883675` |
| VIS-04 hit feedback | PR #47, commit `0e08a57` |
| VIS-05 native viewport clipping fix | PR #76, commit `bc60232` |
| VIS-05 mobile viewport assertion | PR #83, commit `259d253` |
| Retro production build on GitHub Pages | PR #85, commit `78ce57d` |

## Verification evidence available

- Automated visual QA suite: `tests/browser/retroScaleVisual.spec.ts`, `retro.spec.ts`, `retroP2.spec.ts`, `retroExtrasVisual.spec.ts`, `retroHud.spec.ts` and related specs cover scene readiness, backdrop texture, P1–P4 pose texture keys, 640×360 logical canvas, viewport containment and screenshots at 640×360, 1280×720, 1920×1080 and 390×844.
- Independent Tester evidence and screenshot review: `docs/visual/M1_5_VIS_05_TESTER_EVIDENCE.md` (including VIS05-01 reproduction, fix and retest).
- CI on the reviewed PR heads: Agent task validation, Agent PR tracking, CI and browser smoke, Game Test Harness and M1.5 retro prototype visual QA. Historical runs are linked from the Tester evidence document; they are evidence for those heads, not for later revisions.
- Production deployment (observed 2026-11-01): `https://trumppo.github.io/TurenkiFight/` loads without console errors and requests `assets/station/turenki-station-retro.svg`, confirming that the published build uses the retro build configuration. `deploy.yml` sets `VITE_VISUAL_STYLE: retro` only on the Pages build step.
- Local check on `main` at `3ed2ca1` (2026-11-01): `npm test` 145/145 passed; `npm run build` passed with the existing large-chunk warning.

## Accepted with these documented limitations

1. **VIS05-02 (open, non-blocking):** at 1920×1080 the game remains comparatively small with unused surrounding space; a larger integer display scale may be desirable later.
2. **VIS05-03 (open, accessibility review):** at 390×844 the arena fits, but in-canvas HUD text is small; physical-device legibility is unverified.
3. **No pixel-level agent visual approval:** automated checks and Tester screenshot inspection exist, but the final aesthetic acceptance rests on the owner's decision, not on CI.
4. **Physical gamepad hardware remains unverified** for M1 and M1.5; browser tests use simulated gamepads.
5. **Playwright suite load sensitivity:** in a local full-suite run with two workers the 120-second four-player harness timed out once and passed when run alone. CI was green; treat this as a flake risk to monitor.
6. **Deployed Pages pixel review was not performed in this session** (no visible browser window for screenshots); only asset loading and console cleanliness were observed.

## What this approval does and does not mean

- It means M1.5's visual direction and merged implementation are accepted for the current prototype, with the limitations above.
- It does **not** accept the M1.5 excess scope such as new arenas, mass asset conversions, additional modes, or making the experimental 48×64 P1 canvas the default. The 48×64 variant remains opt-in.
- It does **not** imply any networking capability, transport choice or M2 acceptance.

## Follow-up

Remaining visual quality items are tracked as follow-ups rather than release blockers. New arena work stays gated behind its own concept approval and must not modify simulation or input behavior.
