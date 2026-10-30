# TurenkiFight development guide

This repository contains a TypeScript, Phaser 3 and Vite browser fighting game. OpenCode agent definitions are in `.opencode/agents/`.

Before work, read `docs/OPENCODE_HANDOFF.md`, `docs/GAME_DESIGN_DECISIONS.md`, `docs/ARCHITECTURE_PRINCIPLES.md` and `docs/ROADMAP.md`. Read the task-specific specification as well.

Roles: designer defines requirements and acceptance criteria; gameplay implements deterministic mechanics and tests; graphics owns visual assets and presentation; tester independently checks regressions, CI and browser behavior.

Keep simulation headless and deterministic, separate from Phaser rendering. Keep content and balance configurable. Distinguish approved designs from implemented features. Use scoped branches, coordinate ownership of shared files, run relevant tests, document evidence and open pull requests. Do not merge without owner approval. Do not commit credentials. Network transport selection remains open pending benchmarks.

## OpenCode multi-agent workflow

`opencode.json` makes `designer` the default primary agent. Designer may invoke only `gameplay`, `graphics` and `tester`; `subagent_depth: 1` prevents worker-to-worker delegation. Workers must not push, merge or perform destructive Git operations. Their edit permissions are scoped by role in `.opencode/agents/*.md`.

Designer first reads the current repository and task specification, then creates a small task with ownership and acceptance criteria. Gameplay and Graphics implement independent slices, Tester verifies the resulting changes and returns reproducible findings to Designer. Defects go back to the owning worker and Tester re-checks them. Designer reviews the evidence and prepares a PR; the owner approves and merges it.

Connect OpenCode Go in the OpenCode UI with `/connect`, then verify the exact models with `/models` (or `opencode models` where supported) before running a task. Model availability, account entitlements and regional routing are runtime facts; this repository does not contain credentials or override privacy settings. A failed local model lookup must be reported rather than silently replaced with a different provider.
