# M1.5 independent visual QA — Tester execution order

**Task:** M1-5-VIS-05. **Owner:** tester-session. **Start now** on current `main` (record exact commit SHA). Existing automated screenshot coverage from merged PR #52 is a starting point, not an independent acceptance result.

1. Run repository quality, browser smoke and retro screenshot tests against current main. Record exact commands, runtime, SHA and pass/fail outcomes. Verify GitHub Pages deployed assets rather than assuming a green build implies a healthy deployment.
2. Inspect four fighters P1–P4 (distinct silhouettes, all poses and animation frames), Turenki station layers and foreground combat readability, retro HUD (HP, score, clock, KO and respawn), hit feedback, and classic mode regression.
3. Capture and review 640×360 native, 1280×720 (2×), 1920×1080 (3×), and a narrow mobile viewport. Record screenshots, any visual clipping, pixel scaling, occlusion, unreadable text and contrast problems. Manual review must be explicitly distinguished from automated screenshots.
4. Publish `docs/visual/M1_5_INDEPENDENT_QA_REPORT.md` with environment, evidence paths, per-area result, severity-ranked findings, exact SHA and one overall **PASS**, **PASS WITH LIMITATIONS**, or **FAIL**. State which checks require human owner review.
5. If defects exist, create separate Graphics follow-up(s) with reproducible steps, screenshots, severity and acceptance criteria; rerun affected tests after the fix. Do not edit graphics assets as Tester.
6. Ask the owner to explicitly accept or reject M1.5 visual result. **Do not mark M1.5 accepted or VIS-05 done without that decision.** Planning closes M1-5-INTEGRATION-REVIEW after acceptance.

Keep M2-INDEPENDENT-TESTER-GATE (P0) visible and do not silently replace its scope. Tester can execute M1.5 QA in parallel if capacity permits. The task YAML `ready` status indicates authorized work, not proof an agent process was started.
