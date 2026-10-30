# M1 acceptance review — 2026-10-27

**Decision: PENDING USER ACCEPTANCE.** This is an independent evidence review, not approval of M1 or a claim of completed physical playtesting.

## Baseline and provenance

Review based on `main` after merged PRs [#10](https://github.com/Trumppo/TurenkiFight/pull/10) (visual integration, merge `b82e2ca`), [#15](https://github.com/Trumppo/TurenkiFight/pull/15) (gameplay QA, merge `756a56a`) and [#16](https://github.com/Trumppo/TurenkiFight/pull/16) (task metadata, merge `50ec100`). Also reviewed `docs/M1_GAMEPLAY_IMPLEMENTATION.md`, `docs/M1_GAMEPLAY_QA_RESULTS.md`, `docs/visual/M1_VISUAL_QA_REPORT.md`, `docs/ROADMAP.md`, and `.github/AGENT_TASKS.yaml`.

This review checked GitHub PR merge state, documented test evidence and task metadata; **no independent local build, live Pages browser session, physical controller or screenshot inspection was performed**. Prior PR CI success is evidence for those commit heads, not a substitute for a fresh integrated `main` CI run.

## Acceptance matrix

| M1 criterion | Evidence | Assessment |
| --- | --- | --- |
| 2–4 local players, explicit join, P1 host start, rematch | Implementation specification, gameplay QA and Playwright simulated-controller coverage | **AUTOMATED PASS**, real hardware pending |
| Three moves: punch, kick, jumpkick | Gameplay implementation and visual QA browser pose tests | **AUTOMATED/SOURCE PASS**, visual playtest pending |
| Deterministic 60 Hz simulation and 8-fighter extensibility | `tests/gameplay-qa.test.ts`: repeated 500-tick 8-fighter replay, immutable state | **AUTOMATED PASS** |
| Mutual KO, first lethal credit, score, respawn, protection | Gameplay QA regressions and PR #15 | **AUTOMATED PASS** |
| 180-tick countdown, exactly 7200 fight ticks, standings | Gameplay QA regression tests | **AUTOMATED PASS** |
| P1 gamepad Start fix | PR #15, simulated gamepad Playwright regression and coordination issue #14 | **AUTOMATED PASS**, physical gamepad pending |
| Four fighters visually distinct, readable HUD and attack/KO cues | Sprite/pose/scene tests and visual QA report | **SOURCE/AUTOMATED PASS**, actual four-player visual review pending |
| 640×360 presentation, 2×/3× scaling, mobile | Config, viewport math and mobile aspect-ratio browser tests | **PARTIAL**; screenshot-level readability not observed |
| 960×540 without gameplay changes | Presentation config and camera coverage tests; browser canvas resize assertion | **PARTIAL**; independently started 960×540 browser and replay comparison not verified |
| Turenki station, Pages assets | Typed asset manifest, URL resolver tests and browser 404 checks | **PARTIAL**; published Pages console/network not inspected |
| Build/unit/browser CI | Visual PR #10 reports green CI #101; gameplay PR #15 reports green CI #109; latest PR #15/#16 head checks succeeded before merge | **PR CI PASS**; integrated post-merge `main` run not independently established in this review |

## Required manual verification before final sign-off

1. Open deployed game and inspect console/network for missing station or sprite assets, especially GitHub Pages subpath.
2. Play a complete 120-second match with 2–4 joined players. Verify join, P1-only Start, attack hit cues, simultaneous KOs, scores, respawn, final standings and rematch.
3. Test with actual gamepad hardware: P1 Start, exclusive P2–P4 assignments, disconnect/reconnect and keyboard fallback.
4. Inspect real four-player screenshots at native 640×360, 2×/3× browser scaling and mobile-fit viewport; verify HP/score/timer and silhouettes do not overlap illegibly.
5. Start a fresh session configured at 960×540, verify unchanged camera framing and compare deterministic replay state/fingerprint with default 640×360.
6. Confirm a successful CI run on the fully integrated `main` revision after #15 and #16; if absent, trigger a run and record its link.

## Scope/roadmap discrepancies

- `docs/ROADMAP.md` still contains unchecked M1 items and an obsolete 384×216 target; reconcile after acceptance evidence, without claiming unverified checks passed. The locked M1 target is 640×360, and 8-fighter support is a simulation test, not an eight-player M1 UI requirement.
- `M1-VISUAL-QA` and `M1-GAMEPLAY-QA` remain at `review` in the task queue even though their implementation PRs are merged; close them only through an authorized follow-up.
- The source reports correctly distinguish simulated gamepads from physical hardware; do not silently promote them to verified.


## User manual browser playtest — 2026-10-30

The project owner reports personally testing the deployed game in a browser and confirming that the game is playable, a match starts and finishes, scores accumulate, fighters move, and fighters can hit one another. **Result: USER-REPORTED MANUAL PASS for this basic end-to-end gameplay path.** This is a firsthand user report, not an independent agent observation.

The report does **not** establish the exact player count used, a 120-second stopwatch measurement, three distinct attack types, KO/respawn protection, rematch, real gamepads, multi-resolution readability, browser console/network cleanliness or a fresh 960×540 session. Those checks remain unverified unless separately evidenced.

Automated browser coverage was subsequently expanded through merged [PR #18](https://github.com/Trumppo/TurenkiFight/pull/18), including a complete four-player match, punch/scoring, KO/respawn, repeated controlled inputs and mobile canvas checks. All five harness tests and other PR checks passed before merge. This adds automation evidence but does not replace the remaining visual/hardware checks or constitute user approval of the milestone.

## Recommendation and approval gate

**Conditional readiness for user acceptance review; not accepted.** Automated gameplay and presentation coverage support progressing to manual acceptance. Do not set M1 to done, mark milestone accepted, or check outstanding roadmap items until the user explicitly approves and any required evidence is recorded.

Proposed final decision after verification: ACCEPT / ACCEPT WITH DOCUMENTED LIMITATIONS / REJECT AND OPEN FIX TASKS, decided by the user.
