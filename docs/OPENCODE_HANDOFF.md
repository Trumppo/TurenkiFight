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
Install OpenCode using its current official instructions, connect OpenCode Go with `/connect`, open a terminal in the repository root and launch `opencode`. The project-local agent definitions live in `.opencode/agents/`, and `opencode.json` sets `designer` as the default primary agent. In OpenCode V2, agents use `mode`, `model`, and ordered `permissions` rules; the project keeps `subagent_depth: 1` so workers cannot create further delegation chains.

Configured model IDs (verify with the installed version's `/models` or `opencode models`): Designer `opencode-go/gpt-6-luna`; Gameplay `opencode-go/deepseek-v4.1-flash`; Graphics `opencode-go/gpt-6-luna`; Tester `opencode-go/glm-5.3-flash`. `openai/luna` is not a verified identifier; the official Go catalog uses `opencode-go/gpt-6-luna`. GPT 6 Luna is used for Graphics because the catalog records text, image and PDF input. No agent is assumed to generate bitmap files without an image tool.

If the local Go catalog does not expose DeepSeek or requires a Global/China-routing privacy setting, do not change that setting automatically: ask the owner or select the documented fallback `opencode-go/glm-5.3-flash`. Gameplay may alternatively use `opencode-go/kimi-k2.7-code` when the owner explicitly approves the change. GPT 6 Luna has 30-day retention/abuse-monitoring terms in the Go catalog; confirm the account policy before sending project images.

Recommended work sequence:
1. **designer** inspects current GitHub branches, PRs, docs and CI, then produces a small scoped task with acceptance criteria and file ownership.
2. **designer** delegates only to **gameplay**, **graphics** or **tester** through OpenCode's native subagent mechanism.
3. **gameplay** or **graphics** takes the assigned task; if both run simultaneously, their file scopes must not overlap.
4. **tester** checks the implementation, tests and CI evidence. Defects return to the owning worker; Tester re-checks the correction.
5. **designer** reviews integration and prepares a PR; project owner decides acceptance and merging.
5. Repeat. Never imply agents run persistently or autonomously without a configured runner.

Suggested prompts:
- Designer: "Read AGENTS.md, docs/OPENCODE_HANDOFF.md, docs/GAME_DESIGN_DECISIONS.md, docs/ROADMAP.md and current PRs. Propose the next smallest task and acceptance tests. Do not implement or merge."
- Gameplay: "Read AGENTS.md and the assigned specification. Implement only the approved gameplay scope, add deterministic regression tests, run CI-equivalent checks and open a PR. Do not merge."
- Graphics: "Read AGENTS.md and docs/M1_5_VISUAL_UPGRADE.md. Implement only the approved visual slice, preserve pose/API contracts, capture visual QA evidence and open a PR. Do not merge."

## Handoff / boundaries
Designer owns specifications and cross-cutting decisions. Gameplay owns `src/game/simulation/`, modes, input, transport-neutral `src/game/protocol/` foundations and relevant tests. Graphics owns `public/assets/`, visual themes, sprites and presentation-only effects. Shared `src/game/presentation/` scene integration requires explicit task-level ownership to avoid conflicts. Designer should not simultaneously edit task coordination files with workers.

## Checks before every PR
- Review package.json scripts; run relevant tests, typecheck/lint if defined, production build and browser tests for UI changes.
- Confirm deterministic replay checksums for art-only changes.
- Inspect GitHub Actions status, note failures and fix regressions within task scope.
- Verify no secrets, generated clutter or unreviewed binary assets.
- Record tests actually run; never invent green results.
- Link relevant issue/task and document changed behavior and limitations.

## Initial migration backlog
1. Audit repository/PR state and identify unfinished M1.5 tasks.
2. Confirm four OpenCode agents are discovered, `designer` is the default primary, and permissions are appropriate.
3. Confirm a small test-only task can be delegated from Designer to Tester and returns a reproducible report.
4. Confirm each configured model appears in the local model list; do not infer availability from this repository file alone.
3. Complete M1.5 visual proof and robustness testing without gameplay scope creep.
4. Create separate feature specs for guard/throw/knockdown and items; preserve approved design without implementing everything at once.
5. Build M2 input/protocol abstractions; run both network architecture benchmarks before decision.

## Owner approval gates
Design decisions in docs/GAME_DESIGN_DECISIONS.md are approved *conceptually*, not automatic authorization to implement now. Owner approves milestone scope, significant design changes, PR merges, and final acceptance.

## User approval gates

The owner starts OpenCode and selects Designer (or accepts the configured default), connects the approved provider account, and verifies `/models`. The owner reviews the Tester report and PR checks before merging. Git push, merge, secret access and destructive operations remain approval-gated by the configuration and by the owner workflow.
