# TurenkiFight development guide

This repository contains a TypeScript, Phaser 3 and Vite browser fighting game. OpenCode agent definitions are in `.opencode/agents/`.

Before work, read `docs/OPENCODE_HANDOFF.md`, `docs/GAME_DESIGN_DECISIONS.md`, `docs/ARCHITECTURE_PRINCIPLES.md` and `docs/ROADMAP.md`. Read the task-specific specification as well.

Roles: designer defines requirements and acceptance criteria; gameplay implements deterministic mechanics and tests; graphics owns visual assets and presentation; tester independently checks regressions, CI and browser behavior.

Keep simulation headless and deterministic, separate from Phaser rendering. Keep content and balance configurable. Distinguish approved designs from implemented features. Use scoped branches, coordinate ownership of shared files, run relevant tests, document evidence and open pull requests. Do not merge without owner approval. Do not commit credentials. Network transport selection remains open pending benchmarks.
