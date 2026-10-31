# Designer handoff — 2026-10-31

## Evidence-based repository snapshot
- Main HEAD at inspection: `c0ae8710bbad7868ee4cde898f5b593d3ad7a18b` (PR #21 merged).
- M1 accepted with limitations; see `docs/M1_ACCEPTANCE_REPORT.md`.
- PR #21 merged: M1.5 opt-in P1 retro sprite + Turenki station, screenshots and browser tests. P2–P4 remain classic; 48x64 is experimental, not default. No full M1.5 acceptance.
- M1.5 gameplay robustness report documents 1,000 complete deterministic four-player match tests and successful earlier CI. Verify fresh main checks separately.
- `feature/m2-input-frame-contract` compared with main: 56 commits ahead, zero behind, 21 changed files at inspection. It contains transport-neutral InputFrame/StateSnapshot/EventBatch/replay work. Branch state is **not equivalent** to a verified open PR state. The latest `docs/GOALS.md` on that branch describes PR #25 as draft pending a new head and CI; verify via `gh pr view 25 --json state,isDraft,headRefOid,mergeable,statusCheckRollup` and `gh pr checks 25` before acting. No merge authorization is granted by this handoff.
- Main HEAD combined statuses and PR-triggered workflow query returned no runs for the merge commit. This is **not evidence of passing or failing**. Check Actions on main and latest PR heads using GitHub CLI.
- `docs/ROADMAP.md` previously described M1.5 as only planned. The checkpoint annotation corrects that without prematurely checking full milestone boxes.
- Network transport decision is open pending measured WebSocket/WebRTC comparison.

## Priority and sequence
P0: Reconcile PR #25 with actual remote head and CI, and inspect whether its current-main-hardening changes remain only local. Do not push local uncommitted work without inspecting diffs and user authorization. Do not merge on the strength of old CI.
P1: M1.5 VIS-02 design gate: P2–P4 visual differentiation and pose contracts using approved retro direction; no automatic adoption of 48x64 P1 variant. First deliver design/acceptance and visual proof, then implementation as a separate scoped task.
P1: Independent tester reviews the latest main and PR #25 checks, browser regression and visual artifact coverage.
P2: Update roadmap milestone checkboxes after evidence and owner approval. Avoid adding guard/throw/items to this cycle; they remain approved *design*, not implemented scope.

## Copyable agent commands

### Designer / coordination
```text
Read the LATEST remote GitHub state before doing anything: fetch origin, inspect main HEAD, open PRs #21/#25/#28, branches, GitHub Actions checks, docs/ROADMAP.md, docs/GOALS.md and docs/AGENT_HANDOFF_2026-10-31.md. Do not trust old SHA, local worktrees or documentation status without cross-checking. Confirm PR #25 actual remote head and local-only changes; report merge blockers. Delegate the separate Gameplay, Graphics and Tester tasks below. No PR merges or milestone acceptance without my explicit approval.
```

### Gameplay — PR #25 integration audit (no unsolicited feature changes)
```text
FIRST read the LATEST remote state: git fetch origin, inspect origin/main, feature/m2-input-frame-contract, PR #25 metadata, newest Actions checks and docs/AGENT_HANDOFF_2026-10-31.md. Compare actual PR head with local worktree and docs/GOALS.md. Identify whether the current-main hardening is already pushed, uncommitted, or diverged. Run protocol/unit/build and browser tests on the actual candidate revision. Document exact commands and failures; make only scoped fixes on an isolated branch/worktree after Designer approval. Keep transport-neutral; do not select WebSocket or WebRTC. Do not merge.
```

### Graphics — M1.5 next visual slice
```text
FIRST read the LATEST remote GitHub state: fetch origin, inspect origin/main, PR #21 merge, current open PRs, Actions, docs/M1_5_VISUAL_UPGRADE.md, docs/visual/M1_5_VISUAL_PROTOTYPE_REPORT.md and docs/AGENT_HANDOFF_2026-10-31.md. Verify what is actually merged. Prepare a VIS-02 proposal for P2–P4 distinct retro fighter sprites and animation readability with 640x360 camera, 320x180 provisional arena art, stable pose keys and opt-in classic rollback. Do not implement without a scoped Designer task. Do not change gameplay or make 48x64 default. Define screenshot evidence for desktop/mobile and owner visual approval gate.
```

### Tester — independent evidence review
```text
FIRST read the LATEST remote GitHub state: fetch origin, inspect main HEAD, PR #25 current head/status, GitHub Actions on main and PR heads, docs/AGENT_HANDOFF_2026-10-31.md and existing acceptance reports. Do not assume CI passed based on older SHAs. Verify latest main build, unit tests, browser smoke, retro opt-in and classic regression where possible. Check PR #25 tests independently on its actual remote head. Report PASS / PASS WITH LIMITATIONS / FAIL, commands, commit SHA, failed checks, reproducible defects and untested conditions. Do not edit gameplay, approve your own production changes or merge.
```

## Acceptance gates
1. PR #25: current remote head and CI verified, no hidden local-only changes, independent Tester report, explicit owner merge approval.
2. VIS-02: Designer scope, Graphics visual proof for P2–P4, Tester screenshots/QA, explicit owner approval before full integration.
3. Roadmap: only mark complete after merged code and evidence; M1.5 milestone acceptance requires full four-fighter/HUD/effects QA.
