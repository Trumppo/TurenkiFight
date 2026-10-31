# TurenkiFight

TurenkiFight is a browser-based, Turenki-themed multiplayer 2.5D arena fighting game with an 8-bit-inspired pixel-art aesthetic. Inspired by the energy of classic arcade fighters (including IK+), but with its own mechanics, art and identity.

**Status (2026-10-31):** Playable M1 local four-player Score Brawl, accepted with limitations. Opt-in M1.5 retro visuals and transport-neutral M2 protocol/session foundations are implemented; M1.5 awaits independent visual/release checks and owner approval. Online multiplayer is not yet available. See [roadmap](docs/ROADMAP.md).

## Core vision

- Chaotic, accessible party fighting for friends, both at LAN parties and remotely over the internet.
- Fixed arena camera: everyone sees the same battlefield.
- 2.5D movement: X/Y ground-plane movement and Z jump height, rendered with depth-sorted 2D sprites.
- First arena: **Turengin rautatieasema** (Turenki railway station), a stylized interpretation rather than a scale model.
- First game mode: **Score Brawl** (pistepohjainen joukkotappelu).
- Future game modes: Last Man Standing, Deathmatch, and others.
- Configurable player count: **no hardcoded three-player or other permanent cap**. Start with four local players, then test 8+ across network; actual supported count depends on usability and measured performance.
- Browser-only client with keyboard and gamepad support.

## Planned distribution

The static client is built and published through **GitHub Pages**. Online transport and room hosting are not implemented; WebSocket and WebRTC approaches remain candidates for measured experiments. Fully offline LAN will require locally serving the client and whichever backend/signaling components the selected design needs.

## Run locally

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. To check changes, run `npm test`, `npm run build`, and `npm run test:browser` (Playwright browsers may need installation via `npx playwright install chromium`). GitHub Pages publishes the static browser client; it is not a multiplayer server.

## Design and project status

- [Game design](docs/GAME_DESIGN.md)
- [Technical architecture](docs/ARCHITECTURE.md) and [architecture principles](docs/ARCHITECTURE_PRINCIPLES.md)
- [Development roadmap](docs/ROADMAP.md)
- [M1 acceptance report](docs/M1_ACCEPTANCE_REPORT.md)
- [M1.5 independent visual evidence](docs/visual/M1_5_VIS_05_TESTER_EVIDENCE.md) — pending release acceptance
- [M2 independent protocol QA](docs/M2_INDEPENDENT_TESTER_REPORT.md) — PASS WITH LIMITATIONS, not a network test
- [M2 benchmark harness specification](docs/M2_BENCHMARK_HARNESS_SPEC.md) — in-memory correctness work, not measured transport performance

The authoritative agent task queue is [`.github/AGENT_TASKS.yaml`](.github/AGENT_TASKS.yaml). Updating it does not automatically launch agents. Merge and milestone approval follow its coordination policy.

## Implemented stack and future transport candidates

The game uses TypeScript, Vite, Phaser 3, Vitest, Playwright and GitHub Actions. WebSocket, WebRTC DataChannels, signaling and optional TURN are **future experiment candidates**, not existing game networking.

## Project principles

Keep simulation deterministic and separate from rendering, networking, input and game-mode rules. Prefer a playable vertical slice over premature feature breadth. Benchmark performance and latency before committing to scaling limits.

## License

**Not yet selected.** Public GitHub visibility does not itself grant an open-source license or reuse rights. Choose code and asset licenses before accepting external contributions or distributing reusable assets.
