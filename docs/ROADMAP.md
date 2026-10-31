# TurenkiFight – Prototype Roadmap v0.4

**Updated:** 2026-10-31 (documentation sync). Milestones, not calendar commitments. See [next engineering gates](M2_NEXT_GATES_2026-10-31.md).

**Network architecture decision: OPEN.** Do not commit to WebRTC browser hosting or central WebSocket authority until both have been tested. See [Network benchmark plan](NETWORK_BENCHMARK_PLAN.md).

 > **Current main checkpoint (2026-10-31):** M1 accepted with limitations. M1.5 four retro fighters, station and HUD polish have landed; independent visual QA identified viewport clipping and readability follow-ups, and owner acceptance is still pending. M2 canonical protocol, authorized ingress, hardening and independent protocol QA are merged (QA: PASS WITH LIMITATIONS). A deterministic in-memory benchmark harness is under PR review; no network transport, room server or architecture choice has shipped.

## Milestone 0 – Project foundations

**Status: technically complete (2026-10-24).** User verified both GitHub Actions and the deployed browser prototype. License selection remains a separate administrative follow-up.

- [x] Initial game vision and design documents
- [x] Initialize TypeScript + Vite + Phaser prototype scaffold
- [x] Add Vitest smoke tests and GitHub Actions deployment workflow (execution not yet verified)
- [x] Verify clean build and CI; publish and verify first GitHub Pages build (user confirmed Actions and deployed game work on 2026-10-24)
- [ ] Decide code and art licenses (administrative follow-up; not blocking technical M0 acceptance)

## Milestone 1 – Local playable slice

**Status: ACCEPTED WITH DOCUMENTED LIMITATIONS (2026-10-30).** Project owner confirmed a playable browser match with movement, hits, scoring, start and finish. Five Playwright game-harness scenarios and the CI checks passed before PR #18 was merged. See [M1 acceptance report](M1_ACCEPTANCE_REPORT.md).

- [x] Fixed 640 × 360 logical presentation and Turenki station arena (revised from the early 384 × 216 prototype)
- [x] Four local player slots with explicit keyboard/gamepad join; physical controllers remain unverified
- [x] Punch, kick, jump kick, hit detection and KO/respawn/protection simulation
- [x] Score Brawl with 120 s timer, score/HP HUD and results
- [x] X/Y movement, Z jumping and depth ordering implemented; visual quality at all scales remains follow-up QA
- [x] Deterministic fixed-step simulation, replay regression and browser combat tests
- [x] Automated four-player complete match, mobile viewport, punch, KO/respawn and repeatability harness

**Accepted limitations / follow-up QA:** physical gamepad hardware; four-player readability at multiple scales; fresh 960 × 540 configured browser and replay comparison; production GitHub Pages console/network inspection. Eight-fighter simulation scalability is tested but eight simultaneous UI fighters are not an M1 requirement.

**Exit:** four-player local Score Brawl playable and automated full-match verified; user accepted milestone with these limitations.

## Milestone 1.5 – Retro raster visual upgrade

**Status: VISUAL IMPLEMENTATION MERGED; QA AND OWNER ACCEPTANCE PENDING.** Art direction approved 2026-10-30. Early-1990s raster aesthetic inspired by Janne50v card technique, not its Dune theme. The logical camera remains 640 × 360. See [independent visual QA evidence](visual/M1_5_VIS_05_TESTER_EVIDENCE.md).

- [x] Approve one fighter and Turenki station visual proof (PR #21; not full M1.5 acceptance)
- [x] Implement four retro fighters, station, HUD and impact effects without changing gameplay (merged; visual acceptance separate)
- [ ] Pass automated and manual visual QA at native, integer-scaled and mobile sizes (native viewport clipping VIS05-01 identified; retest/release checks and mobile readability review required)

**Exit:** user-approved visual upgrade with unchanged deterministic gameplay and green tests. See [M1.5 visual upgrade plan](M1_5_VISUAL_UPGRADE.md).

## Milestone 2 – Shared multiplayer foundations (transport-neutral)

**Status: PARTIALLY IMPLEMENTED.** Canonical v1 protocol, authorized ingress, hardening and [independent Tester gate](M2_INDEPENDENT_TESTER_REPORT.md) are merged; Tester verdict is PASS WITH LIMITATIONS. An in-memory deterministic benchmark harness is in PR review, not a measured network comparison. This is not a live network session. Session envelope contract approval remains outstanding.

- [ ] Finalize versioned InputFrame, StateSnapshot, event and room protocol schemas (input/snapshot/event v1 implemented; room lifecycle not finalized)
- [ ] Separate simulation, authority, rendering, mode rules and transport adapters (simulation/authority separation implemented; network adapters pending)
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
