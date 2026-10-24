# TurenkiFight

TurenkiFight is a browser-based, Turenki-themed multiplayer 2.5D arena fighting game with an 8-bit-inspired pixel-art aesthetic. Inspired by the energy of classic arcade fighters (including IK+), but with its own mechanics, art and identity.

**Status:** pre-production / prototype design v0.3 (2026-10-24). No playable build yet.

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

The static client will be built and published via **GitHub Pages**. A small separately hosted Linux backend will provide room/lobby coordination and WebRTC signaling, with an optional authoritative dedicated-game-server mode later. Browser-only offline LAN requires local hosting of the client and signaling.

## Design documents

- [Game design](docs/GAME_DESIGN.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Development roadmap](docs/ROADMAP.md)

## Candidate stack (not yet implemented)

TypeScript, Vite, Phaser 3, Vitest, Playwright, WebRTC DataChannels, a small WebSocket signaling service, and optionally coturn. These are provisional technology choices subject to prototyping.

## Project principles

Keep simulation deterministic and separate from rendering, networking, input and game-mode rules. Prefer a playable vertical slice over premature feature breadth. Benchmark performance and latency before committing to scaling limits.

## License

**Not yet selected.** Public GitHub visibility does not itself grant an open-source license or reuse rights. Choose code and asset licenses before accepting external contributions or distributing reusable assets.
