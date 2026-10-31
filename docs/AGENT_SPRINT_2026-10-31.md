# Four-agent near-term sprint — 2026-10-31

**Status:** proposed assignments; branch presence is not proof of completion. Baseline main `e5799bc` at audit. Owner must approve merges and milestone acceptance. `.github/AGENT_TASKS.yaml` is the shared machine-readable queue.

## Evidence audit
- M0 technically complete, license open. M1 accepted with limitations; see `docs/M1_ACCEPTANCE_REPORT.md`.
- M1.5 VIS-01 PR #21 merged, P2 VIS-02A PR #30 merged (`d199fc5`). Neither proves full M1.5 acceptance. Branches `feature/m1-5-vis-02b-p3-p4-retro` and `feature/m1-5-vis-04-retro-hud` exist; their PR/CI and visual acceptance were not verified in this audit.
- M2 PRs #33–35 merged through #33 into main (`e5799bc`); code exists under `src/game/session/`. PR #37 adds safe-tick guard and deterministic 7,200-tick tests, but is not yet confirmed merged.
- M2 codec `feature/m2-input-frame-contract` is **not main**: 56 ahead, 5 behind at audit. Inspect PR #25 current head, draft/mergeability and tests before integration. The session layer is not wired to codec or transport; it is not a functioning network game.
- Main CI push results were not independently fetched through the PR-run-only connector. Green PR CI does not automatically establish merged-main CI.
- `README.md` incorrectly said no playable build; `docs/GOALS.md` described already merged PR #21 as draft; `docs/ROADMAP.md` M1.5 section said only planned and M2 checkboxes missed merged session modules.
- `docs/M1_5_GAMEPLAY_ROBUSTNESS_REPORT.md` says InputFrame does not exist: historically accurate for its M1.5 baseline but now misleading without a timestamp. `docs/AGENT_HANDOFF_2026-10-31.md` and `docs/M2_INTEGRATION_GATE.md` are historical snapshots, not live status.
- `docs/AGENT_WORKFLOW.md` says Hybrid workflow (M1), and its responsibilities list is stale. The task queue had only completed M1 entries. `docs/visual/M1_5_VIS_02_DESIGN.md` remains a useful design spec but its P2-not-implemented baseline is outdated.

## Immediate parallel work (no shared file ownership)
| Role | Start now | Next after gate | Exclusive ownership |
| --- | --- | --- | --- |
| Designer / planning-session | DESIGN-ROADMAP-01: reconcile README, roadmap, goals and queue; review evidence and owner approvals | DESIGN-M2-BENCH: fair protocol payloads, benchmark methodology and WS/WebRTC decision criteria | docs/ROADMAP.md, docs/GOALS.md, docs/NETWORK_BENCHMARK_PLAN.md, .github/AGENT_TASKS.yaml |
| Graphics / graphics-session | M15-VIS-02B: inspect existing P3/P4 branch, complete unique retro fighters, pose/screenshot tests | M15-VIS-04: HUD, lobby overlay, impacts; then VIS-03 station polish and VIS-05 release QA | src/game/presentation/, public/assets/, visual screenshot specs; serialize shared scene edits |
| Gameplay / gameplay-session | M2-PROTOCOL-INTEGRATION: audit PR #25 head, divergence, strict codec and tests; M2-TICK-HARDENING PR #37 | M2-SESSION-INTEGRATION: connect authorized ingress, canonical codec and deterministic tick driver | src/game/protocol/, src/game/session/, simulation test harness |
| Tester / tester-session | QA-M2-SECURITY: adversarial tests of merged session layer, PR #25 and #37; QA-M15-RELEASE on P2 | Independent review of P3/P4, HUD, four-player screenshots and final M2 integration | independent QA reports, test-only branches; do not edit production files without assigned defect |

## Two-sprint sequence
**Sprint A (now):** Designer reconciles docs and benchmark requirements; Graphics finishes P3/P4 branch with proof; Gameplay reconciles PR #25 and validates #37; Tester runs independent security and visual regressions. PRs must report exact SHA, commands, CI and open limitations.

**Sprint B (after Sprint A review):** Graphics delivers HUD and station polish; Gameplay integrates authorized ingress with codec and runs deterministic disconnect/replay; Tester validates full 120-second match, mobile/classic/retro and negative protocol cases; Designer records evidence and prepares WS/WebRTC A/B acceptance gate.

## Hard acceptance gates
1. No automatic merge from a green but stale PR head. Require fresh checks and owner approval.
2. No M1.5 acceptance without four-fighter screenshots, HUD, classic fallback and human visual review.
3. No M2 protocol acceptance until PR #25 is reconciled against current main and independently tested.
4. No claim of secure network authentication: roster IDs come from trusted transport context, not a client-provided field. No transport is implemented.
5. No topology choice until measured equivalent WS and WebRTC workloads.
6. No task marked `done` based only on a branch, draft PR or historical report. Use `review` or `blocked` with evidence.

## Known risks and backlog
- Verify production Pages console/network and physical gamepads; P1 gamepad Start issue #14 may be historical and requires fresh reproduction.
- CI dependency flakiness issue #23 needs current reproduction before claiming fixed.
- Pick source and asset licenses before external contributions.
- Ensure M2 packet size, rate limiting, host disconnect, sequence wrap, room isolation and reconnect authorization have explicit negative tests.
- M1.5 VIS-03 and VIS-05 still require owner-approved task breakdown; VIS-04 should not collide with VIS-02B scene edits.
