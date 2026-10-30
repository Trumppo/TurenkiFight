# OpenCode migration and agent operating guide

## Objective
Move ongoing TurenkiFight development from three manually coordinated ChatGPT sessions to three named OpenCode agents in one repository, while preserving project history, owner decisions and CI.

## Repository and baseline
- Repository: https://github.com/Trumppo/TurenkiFight
- Stack: TypeScript, Phaser 3, Vite, deterministic fixed-step simulation, Vitest and Playwright/CI.
- M1: owner accepted 2026-10-30 with documented limitations. See docs/M1_ACCEPTANCE_REPORT.md.
- M1.5: retro raster upgrade and gameplay robustness work. Verify current PRs and branch state before taking over; do not assume work is merged.
- M2+: transport-neutral networking foundation; benchmark central WebSocket authority versus WebRTC browser host before choosing.
- Main gameplay arena: Turenki railway station; later arenas remain candidates.
- Resolution: 640×360 logical presentation, configurable rendering; provisional 320×180 raster art grid.

## Installation and usage
Install OpenCode using its current official instructions, open a terminal in the repository root and launch `opencode`. The project-local agent definitions live in `.opencode/agents/`. Select the appropriate named agent in the OpenCode UI/command interface; available selection syntax may vary by OpenCode version. Check agent discovery and permissions in the installed version.

Recommended work sequence:
1. **designer** inspects current GitHub branches, PRs, docs and CI, then produces a small scoped task with acceptance criteria and file ownership.
2. **gameplay** or **graphics** takes the assigned task in a separate branch; if both run simultaneously, their file scopes must not overlap.
3. Agent runs relevant checks and opens a PR with test evidence, known limitations and screenshots for visual work.
4. **designer** reviews integration and reports recommendation; project owner decides acceptance and merging.
5. Repeat. Never imply agents run persistently or autonomously without a configured runner.

Suggested prompts:
- Designer: "Read AGENTS.md, docs/OPENCODE_HANDOFF.md, docs/GAME_DESIGN_DECISIONS.md, docs/ROADMAP.md and current PRs. Propose the next smallest task and acceptance tests. Do not implement or merge."
- Gameplay: "Read AGENTS.md and the assigned specification. Implement only the approved gameplay scope, add deterministic regression tests, run CI-equivalent checks and open a PR. Do not merge."
- Graphics: "Read AGENTS.md and docs/M1_5_VISUAL_UPGRADE.md. Implement only the approved visual slice, preserve pose/API contracts, capture visual QA evidence and open a PR. Do not merge."

## Handoff / boundaries
Designer owns specifications and cross-cutting decisions. Gameplay owns `src/game/simulation/`, modes, input and relevant tests. Graphics owns `public/assets/`, visual themes, sprites and presentation-only effects. Shared `src/game/presentation/` scene integration requires explicit task-level ownership to avoid conflicts. Designer should not simultaneously edit task coordination files with workers.

## Checks before every PR
- Review package.json scripts; run relevant tests, typecheck/lint if defined, production build and browser tests for UI changes.
- Confirm deterministic replay checksums for art-only changes.
- Inspect GitHub Actions status, note failures and fix regressions within task scope.
- Verify no secrets, generated clutter or unreviewed binary assets.
- Record tests actually run; never invent green results.
- Link relevant issue/task and document changed behavior and limitations.

## Initial migration backlog
1. Audit repository/PR state and identify unfinished M1.5 tasks.
2. Confirm three OpenCode agents are discovered and permissions are appropriate.
3. Complete M1.5 visual proof and robustness testing without gameplay scope creep.
4. Create separate feature specs for guard/throw/knockdown and items; preserve approved design without implementing everything at once.
5. Build M2 input/protocol abstractions; run both network architecture benchmarks before decision.

## Owner approval gates
Design decisions in docs/GAME_DESIGN_DECISIONS.md are approved *conceptually*, not automatic authorization to implement now. Owner approves milestone scope, significant design changes, PR merges, and final acceptance.
