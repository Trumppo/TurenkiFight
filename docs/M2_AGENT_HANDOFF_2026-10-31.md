# Agent handoff and release gates — 2026-10-31

This document is the planning-session coordination brief. Source of truth for statuses remains `.github/AGENT_TASKS.yaml`. Avoid editing another agent's implementation scope.

## Immediate work queue

**Tester (P0): M2-INDEPENDENT-TESTER-GATE.** Review merged protocol/session implementation on an exact main SHA; exercise malformed/oversized inputs, unauthorized ownership, replay, host disconnect, reconnect, tick boundaries, 7,200-tick deterministic run. Publish a committed report with evidence, SHA, limitations and PASS / PASS WITH LIMITATIONS / FAIL. Do not infer acceptance from green CI alone.

**Tester (P1): M1-5-VIS-05.** Automated viewport captures are available via PR #52. Perform independent manual checks of 640x360, 2x, 3x and mobile, fighters P1–P4, Turenki station, retro HUD, hit flash and classic mode regression. Document Pages asset checks and unresolved findings. Owner visual approval is still required before M1.5 acceptance.

**Graphics (P1): visual QA remediation reserve.** Wait for concrete VIS-05 findings, then take narrowly scoped presentation/asset fixes; do not modify protocol/session or mark M1.5 accepted. If QA is clean, propose a new visual improvement as a separate task rather than reopening accepted work.

**Gameplay (P1): M2-BENCHMARK-HARNESS-IMPLEMENTATION.** Implement seeded fixture, deterministic replay fingerprints, manifest validation and in-memory adapter only, per `docs/M2_BENCHMARK_HARNESS_SPEC.md`. Do not add WS/WebRTC sockets. Independently tested integration required.

**Planning (P0): M2-SESSION-ENVELOPE-DESIGN owner decision.** PR #49 merged the proposal, not its production approval. Before enabling M2-ENVELOPE-IMPLEMENTATION, obtain an explicit owner decision on exact envelope field schema, per-connection quotas, multi-local-player semantics and reconnect policy. Record decision and create a bounded Gameplay implementation slice. Until then, keep task blocked.

## Sequencing and merge discipline
1. Each agent works on a branch based on current main; keep scopes separate.
2. PR description must include exact `Task: TASK-ID` line matching task queue.
3. CI gate: Agent PR tracking, Agent task validation, CI and browser smoke, Game Test Harness all success for exact PR head. If main advances, reconcile task YAML and rerun checks before merge.
4. Independent Tester findings must be addressed before production release acceptance. A merged planning document does not constitute owner approval.
5. Do not claim online multiplayer, a network topology winner, or M1.5 acceptance without recorded evidence.
