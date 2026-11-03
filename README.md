# TurenkiFight

TurenkiFight is a browser-based, Turenki-themed multiplayer 2.5D arena fighting game with an 8-bit-inspired pixel-art aesthetic. Inspired by the energy of classic arcade fighters (including IK+), but with its own mechanics, art and identity.

**Status (2026-11-03):** M1 and M1.5 are accepted with documented limitations. Three modes are playable locally and online (Score Brawl, Last Man Standing, Deathmatch), local bots can fill empty slots, the roster supports up to **eight** players, the Ravintola Mesku arena is available with `?arena=mesku`, and placeholder audio exists. An authoritative WebSocket prototype serves real matches over LAN or VPN; it has no TLS, authentication or rate limiting, and eight-player network load is not measured. See [roadmap](docs/ROADMAP.md) and [ADR 0001](docs/adr/0001-network-topology.md).

## Core vision

- Chaotic, accessible party fighting for friends, both at LAN parties and remotely over the internet.
- Fixed arena camera: everyone sees the same battlefield.
- 2.5D movement: X/Y ground-plane movement and Z jump height, rendered with depth-sorted 2D sprites.
- First arena: **Turengin rautatieasema** (Turenki railway station), a stylized interpretation rather than a scale model.
- Game modes: **Score Brawl**, **Last Man Standing** and **Deathmatch** are implemented; a full tie ends as a draw by owner decision.
- Player count: **eight** is the supported maximum (owner decision 2026-11-03, one `MAX_PLAYERS` constant). Slots 1-4 have keyboard layouts; slots 5-8 are gamepad or bot slots. Eight fighters are supported but not reliably readable in the 640x360 arena during combat, which is a known limitation.
- Arenas: Turengin rautatieasema (default) and Ravintola Mesku (`?arena=mesku`).
- Browser-only client with keyboard and gamepad support.

## Planned distribution

The static client is built and published through **GitHub Pages**. The transport is decided: a central authoritative WebSocket server ([ADR 0001](docs/adr/0001-network-topology.md)). A prototype match server, an online browser client and headless bots exist; there is no TLS, authentication, rate limiting or TURN, and no real network measurement has been performed, so treat online play as LAN/VPN-only.

## Run locally

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. To check changes, run `npm test`, `npm run build`, and `npm run test:browser` (Playwright browsers may need installation via `npx playwright install chromium`). GitHub Pages publishes the static browser client; it is not a multiplayer server.

## Serve a real authoritative match (LAN or VPN only)

`npm run serve:match` hosts one real match over WebSocket for up to eight players. It reuses the authoritative session and envelope gateway; it is not the benchmark fixture runner and writes no manifest. Add `--mode=score-brawl|last-man-standing|deathmatch` to choose the mode.

```bash
npm run serve:match -- --host=127.0.0.1 --port=8787 --players=4 --snapshot-hz=20
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address. Use `0.0.0.0` to accept LAN peers; a wildcard bind prints no URL. |
| `--port` | `8787` | Bind port; `0` selects an ephemeral port. |
| `--players` | `4` | Claimable slots `P1`..`PN`, 1-4. |
| `--snapshot-hz` | `20` | Snapshot rate: 10, 20 or 30. Ticks stay at 60 Hz. |
| `--start` | `auto` | `auto` starts when every slot is claimed; `manual` waits for an explicit `start` line on stdin. |

The command prints exactly one machine-readable ready line on stdout (for example `{"kind":"match-server-ready","url":"ws://127.0.0.1:8787",...}`) and human-readable status on stderr. Type `start` to request an explicit start (the roster must still be full) and `quit` to stop. Ctrl+C/SIGINT and SIGTERM stop the 60 Hz loop and close every socket.

A fifth connection is closed before registration with close code `1008`, so extra peers cannot join or disturb a running match. A mid-match disconnect revokes that connection's slots under the existing session rules; if the host disconnects, the session closes (`host-lost`) rather than migrating authority.

**Security and latency:** `ws://` is unencrypted and has no authentication or rate limiting. Use it only on a LAN or over a VPN/SSH tunnel, never exposed to the open internet. The online client does not exist yet and prediction is out of scope for it, so expect input latency of roughly the round-trip time plus up to one snapshot interval (50 ms at 20 Hz) once it lands.

## Design and project status

- [Game design](docs/GAME_DESIGN.md)
- [Technical architecture](docs/ARCHITECTURE.md) and [architecture principles](docs/ARCHITECTURE_PRINCIPLES.md)
- [Development roadmap](docs/ROADMAP.md)
- [M1 acceptance report](docs/M1_ACCEPTANCE_REPORT.md)
- [M1.5 independent visual evidence](docs/visual/M1_5_VIS_05_TESTER_EVIDENCE.md) and [acceptance report](docs/M1_5_ACCEPTANCE_REPORT.md) — accepted with documented limitations
- [M2 independent protocol QA](docs/M2_INDEPENDENT_TESTER_REPORT.md) — PASS WITH LIMITATIONS, not a network test
- [M2 benchmark harness specification](docs/M2_BENCHMARK_HARNESS_SPEC.md) — in-memory correctness only (PR #79), not measured transport performance

The authoritative agent task queue is [`.github/AGENT_TASKS.yaml`](.github/AGENT_TASKS.yaml). Updating it does not automatically launch agents. Merge and milestone approval follow its coordination policy.

## Implemented stack and future transport candidates

The game uses TypeScript, Vite, Phaser 3, Vitest, Playwright and GitHub Actions. WebSocket, WebRTC DataChannels, signaling and optional TURN are **future experiment candidates**, not existing game networking.

## Project principles

Keep simulation deterministic and separate from rendering, networking, input and game-mode rules. Prefer a playable vertical slice over premature feature breadth. Benchmark performance and latency before committing to scaling limits.

## License

**Not yet selected.** Public GitHub visibility does not itself grant an open-source license or reuse rights. Choose code and asset licenses before accepting external contributions or distributing reusable assets.
