# TurenkiFight – Prototype Roadmap v0.4

**Updated:** 2026-10-24. Milestones, not calendar commitments.

**Network architecture decision: OPEN.** Do not commit to WebRTC browser hosting or central WebSocket authority until both have been tested. See [Network benchmark plan](NETWORK_BENCHMARK_PLAN.md).

## Milestone 0 – Project foundations

- [x] Initial game vision and design documents
- [x] Initialize TypeScript + Vite + Phaser prototype scaffold
- [x] Add Vitest smoke tests and GitHub Actions deployment workflow (execution not yet verified)
- [ ] Verify clean build and CI; publish and verify first GitHub Pages build
- [ ] Decide code and art licenses

## Milestone 1 – Local playable slice

- [x] Basic fixed 384 × 216 camera, Turenki station placeholder, two keyboard-controlled fighters and simple attacks (prototype only)
- [ ] Expand to four configurable local players with keyboard/gamepad support
- [ ] Proper punch, kick, jump kick, hitboxes, hurtboxes and KO state
- [ ] Implement Score Brawl mode separately: 120 s timer, respawns, score HUD, results
- [ ] Validate X/Y movement, Z jumping and Y depth sorting
- [ ] Add deterministic fixed-step/replay and combat unit tests
- [ ] Test legibility at 384 × 216 and 640 × 360, especially with eight fighters

**Exit:** four players can finish a consistent local Score Brawl match.

## Milestone 2 – Shared multiplayer foundations (transport-neutral)

- [ ] Define versioned InputFrame, StateSnapshot, event and room protocol schemas
- [ ] Separate simulation, authority, rendering, mode rules and transport adapters
- [ ] Implement scripted bots, replay checksums, benchmark telemetry and synthetic clients
- [ ] Establish identical test workloads for both architectures
- [ ] Add baseline latency, tick duration and bandwidth measurements

**Exit:** one shared simulation/protocol can be driven by both transport prototypes.

## Milestone 3 – Architecture experiment A: central WebSocket server

- [ ] Implement central authoritative 60 Hz TypeScript game session
- [ ] Implement WSS/WS room join, input processing, state snapshots and disconnections
- [ ] Measure 4/8/12/16 clients on physical LAN and across internet
- [ ] Test loss/jitter, CPU, bandwidth and cost

**Exit:** measured WebSocket baseline with reproducible results.

## Milestone 4 – Architecture experiment B: WebRTC browser host

- [ ] Implement WebSocket room signaling and browser-host authoritative session
- [ ] Implement WebRTC DataChannel star topology and client connection lifecycle
- [ ] Test direct connectivity, NAT/CGNAT, STUN and TURN-relayed scenarios
- [ ] Measure same workload, snapshot/input rates and impairments as experiment A
- [ ] Test host exit and recovery limitations

**Exit:** measured WebRTC baseline directly comparable to A.

## Milestone 5 – Architecture decision (evidence gate)

- [ ] Collect >= 5 measured 120 s runs per key case
- [ ] Evaluate responsiveness p50/p95/p99, reliability, correctness, CPU, RAM and bandwidth
- [ ] Verify physical LAN, fully offline LAN and remote-internet use cases
- [ ] Estimate operating costs including TURN where relevant
- [ ] Publish results in `benchmarks/RESULTS.md`
- [ ] Write `docs/adr/0001-network-topology.md` with decision, evidence and reconsideration criteria

**Exit:** a documented choice based on results; no predetermined winner. See [benchmark plan](NETWORK_BENCHMARK_PLAN.md).

## Milestone 6 – Multiplayer productization

- [ ] Harden selected architecture and room/join workflow
- [ ] Add client prediction, interpolation and reconciliation as needed
- [ ] Implement security controls, disconnect handling and robust errors
- [ ] Validate mixed local/remote players and multiple local controllers per browser
- [ ] Publish browser build and document LAN hosting
- [ ] Profile eight players, explore 12–16 without imposing an arbitrary maximum

**Exit:** reliable multiplayer party game in tested environments.

## Milestone 7 – Polish and future modes

- [ ] Refine pixel art, sound, hit feedback, balancing and readability
- [ ] Add Last Man Standing and Deathmatch as independent modes
- [ ] Revisit dedicated hosting and rollback only if measurements justify them

## Definition of done

Each milestone needs a reproducible build, test evidence, known limitations and links to measured results. A checked item indicates work committed, **not necessarily independently validated**.
