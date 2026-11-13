# OpenCode migration and agent operating guide

## Objective
Move ongoing TurenkiFight development from three manually coordinated ChatGPT sessions to three named OpenCode agents in one repository, while preserving project history, owner decisions and CI.

## Repository and baseline
- **Agent PR/merge policy (owner update 2026-11-13):** all project agents are authorized to open and merge PRs without per-PR owner approval. Merge only after all required checks and review pass; never bypass branch protections or required CI. Merging does not imply product/design approval or milestone acceptance. This supersedes older instructions in archived handoffs that required owner merge approval.
- Repository: https://github.com/Trumppo/TurenkiFight
- Stack: TypeScript, Phaser 3, Vite, deterministic fixed-step simulation, Vitest and Playwright/CI.
- M1: owner accepted 2026-10-30 with documented limitations. See docs/M1_ACCEPTANCE_REPORT.md.
- M1.5: accepted with documented limitations on 2026-11-01; VIS05-02/03 and the arena work were approved later under M7.
- M2+: the transport is **decided: central authoritative WebSocket server** ([ADR 0001](adr/0001-network-topology.md)), on literature plus single-machine measurements only. No network measurement exists; every network field stays `NOT_MEASURED`.
- Current checkpoint (2026-11-05, `main` at `4153156`): three modes, eight players, bots, ALL BOTS, the local results celebration, the online result card with an opt-in rematch, retro art for P1-P8, and MIT/CC0 licensing are merged. Milestone acceptance for M5, M7, M8 and M9 and the playtest verdicts are still owner decisions.
- Main gameplay arena: Turenki railway station; later arenas remain candidates.
- Resolution: 640×360 logical presentation, configurable rendering; provisional 320×180 raster art grid.

## Installation and usage
Install OpenCode using its current official instructions, connect the configured OpenAI account with `/connect`, open a terminal in the repository root and launch `opencode`. The project-local agent definitions live in `.opencode/agents/`, and `opencode.json` sets `designer` as the default primary agent. In OpenCode V2, agents use `mode`, `model`, and ordered `permissions` rules; the project keeps `subagent_depth: 1` so workers cannot create further delegation chains.

Configured model ID as of 2026-11-13 (verify with the installed version's `/models` or `opencode models`): Designer, Gameplay, Graphics and Tester use `openai/gpt-6-luna`. Availability, entitlements and provider routing remain runtime facts; report a failed lookup rather than silently substituting another model. No agent is assumed to generate bitmap files without an image tool.

Do not change provider privacy, routing or account settings automatically. If the configured GPT-6 Luna model is unavailable, stop and report the observed limitation instead of substituting another provider or model. Check current provider terms before sending sensitive material; this repository does not set or override account privacy policy.

Recommended work sequence:
1. **designer** inspects current GitHub branches, PRs, docs and CI, then produces a small scoped task with acceptance criteria and file ownership.
2. **designer** delegates only to **gameplay**, **graphics** or **tester** through OpenCode's native subagent mechanism.
3. **gameplay** or **graphics** takes the assigned task; if both run simultaneously, their file scopes must not overlap.
4. **tester** checks the implementation, tests and CI evidence. Defects return to the owning worker; Tester re-checks the correction.
5. **designer** reviews integration and prepares a PR. Any authorized agent may merge after all required checks and reviews pass; project owner still decides product acceptance and milestones.
6. Repeat. Never imply agents run persistently or autonomously without a configured runner.

Suggested prompts:
- Designer: "Read AGENTS.md, docs/OPENCODE_HANDOFF.md, docs/GAME_DESIGN_DECISIONS.md, docs/ROADMAP.md and current PRs. Propose the next smallest task and acceptance tests. Do not implement or merge."
- Gameplay: "Read AGENTS.md and the assigned specification. Implement only the approved gameplay scope, add deterministic regression tests, run CI-equivalent checks and open a PR. Merge when required checks and reviews pass; never bypass branch protection."
- Graphics: "Read AGENTS.md and docs/M1_5_VISUAL_UPGRADE.md. Implement only the approved visual slice, preserve pose/API contracts, capture visual QA evidence and open a PR. Merge when required checks and reviews pass; never bypass branch protection."

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

## Owner decision gates
Design decisions in docs/GAME_DESIGN_DECISIONS.md are approved *conceptually*, not automatic authorization to implement beyond their scope. Owner approval remains necessary for significant new product/design decisions and milestone/final acceptance. Per-PR merge approval is no longer required under the 2026-11-13 agent merge policy above.

## User approval gates

The owner starts OpenCode and selects Designer (or accepts the configured default), connects the configured provider account, and verifies `/models`. Agents are authorized to review required evidence and merge PRs without per-PR owner approval once required CI and reviews pass. This does not authorize changing protected settings, bypassing branch protection, exposing secrets, force-pushing, or running `git reset --hard`; destructive history rewrites remain denied by configuration.
