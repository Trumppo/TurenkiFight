# TurenkiFight development guide

This repository contains a TypeScript, Phaser 3 and Vite browser fighting game. OpenCode agent definitions are in `.opencode/agents/`.

Before work, read `docs/OPENCODE_HANDOFF.md`, `docs/GAME_DESIGN_DECISIONS.md`, `docs/ARCHITECTURE_PRINCIPLES.md` and `docs/ROADMAP.md`. Read the task-specific specification as well.

Roles: designer defines requirements and acceptance criteria; gameplay implements deterministic mechanics and tests; graphics owns visual assets and presentation; tester independently checks regressions, CI and browser behavior.

Keep simulation headless and deterministic, separate from Phaser rendering. Keep content and balance configurable. Distinguish approved designs from implemented features. Use scoped branches, coordinate ownership of shared files, run relevant tests, document evidence and open pull requests. **Owner policy (2026-11-13): all project agents may open and merge PRs without per-PR owner approval.** Merge only after required CI/checks pass, required independent review is complete, and no known blocker remains; never bypass branch protection or required checks. A merge does not grant product/design approval or mark a milestone accepted. Do not change protected repository settings or commit credentials. Network transport selection remains open pending benchmarks.

## OpenCode multi-agent workflow

`opencode.json` makes `designer` the default primary agent. Designer may invoke only `gameplay`, `graphics` and `tester`; `subagent_depth: 1` prevents worker-to-worker delegation. In this workspace the project configuration allows agents to edit files, run commands, push branches, open PRs and merge them under the policy above. Force-push and `git reset --hard` remain denied; do not weaken those protections or bypass GitHub branch protection.

Designer first reads the current repository and task specification, then creates a small task with ownership and acceptance criteria. Gameplay and Graphics implement independent slices, Tester verifies the resulting changes and returns reproducible findings to Designer. Defects go back to the owning worker and Tester re-checks them. Designer reviews evidence and prepares or coordinates the PR; any authorized agent may merge once required checks and review pass. Product/design decisions and milestone acceptance remain owner-controlled.

Connect the configured provider account in the OpenCode UI with `/connect`, then verify the exact models with `/models` (or `opencode models` where supported) before running a task. Model availability, account entitlements and regional routing are runtime facts; this repository does not contain credentials or override privacy settings. A failed local model lookup must be reported rather than silently replaced with a different provider.

## Work packages and PR batching

Read `.github/AGENT_TASKS.yaml` before claiming work. Prefer a coherent work package of approximately 2–5 related tasks, one feature branch, multiple commits and **one PR when the package is independently reviewable**. Keep existing task IDs and acceptance checks; never bundle unrelated work merely to meet a count. Run focused local tests during development and required CI at PR time. Fix review/CI findings on the same PR. Do not create standalone PRs for routine task-state updates when they can accompany the implementation. Preserve `Task: <primary-task-id>` in PR descriptions until multi-task tracking is supported. PR titles must start `DESIGNER:`, `LOGIC:`, `GRAPHICS:` or `TESTER:`. Agents may merge without per-PR owner approval only after all required checks and reviews pass; never bypass branch protections. Merge is not milestone/product acceptance.
