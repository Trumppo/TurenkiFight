# TurenkiFight – Prototype Roadmap v0.4

**Updated:** 2026-11-02. Milestones, not calendar commitments. **Milestone 5 gate changed by the owner on 2026-11-02:** the transport decision is based on a literature review plus single-machine measurements; LAN/internet/TURN runs are no longer required and were never performed. See [next engineering gates](M2_NEXT_GATES_2026-10-31.md).

**Network architecture decision: DECIDED (2026-11-02) — central authoritative WebSocket server.** The owner approved [ADR 0001](adr/0001-network-topology.md) on the basis of a documented source review plus single-machine measurements; no network measurement was performed. Architecture B remains in the repository as an evaluated alternative and WebTransport is the leading reconsideration candidate. See the [benchmark plan](NETWORK_BENCHMARK_PLAN.md).

> **Current main checkpoint (2026-11-02, `main` at `09834c7`):** M1 and M1.5 accepted with documented limitations. M2 is implemented at the transport-neutral level: v1 protocol and authorized ingress (#41, #43), owner-approved session envelope with its implementation (#92, #94), executable benchmark scenarios (#97), and independent Tester gates on every slice. Both architecture prototypes exist and are correctness-tested: central WebSocket authority (#98, `server/ws/**`) and browser-host WebRTC with a signaling relay (#100, `server/signaling/**`, `src/game/networking/**`). **No transport is selected and no performance number exists** — every manifest field is `NOT_MEASURED`. Both architectures now complete 7200-tick runs with identical final-state and ordered-event fingerprints (`de544fcd…` / `5bb44bd6…`, 47 events) under the same fixture and seed; that is correctness evidence, not a measurement. PR #25 was closed unmerged and its content was integrated through #41/#43.

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

**Status: ACCEPTED WITH DOCUMENTED LIMITATIONS (2026-11-01).** Art direction approved 2026-10-30. Early-1990s raster aesthetic inspired by Janne50v card technique, not its Dune theme. 640 × 360 logical camera preserved; 320 × 180 art grid remains provisional. See [M1.5 acceptance report](M1_5_ACCEPTANCE_REPORT.md).

- [x] Approve one fighter and Turenki station visual proof (PR #21)
- [x] Finish four fighters, station, HUD and impact effects without changing gameplay (PRs #30, #36, #39, #44, #47)
- [x] Pass automated visual QA at native, integer-scaled and mobile sizes, including viewport regression fixes (PRs #52, #68, #76, #83)
- [x] Publish retro mode in the production Pages build (PR #85) and confirm the published page requests the retro station asset

**Accepted limitations / follow-ups:** VIS05-02 (1920×1080 uses substantial unused space; larger integer display scale may be desirable) and VIS05-03 (in-canvas HUD text is small at 390×844; physical-device legibility unverified) are **deferred to Milestone 7 polish** by the owner on 2026-11-01. Physical gamepad hardware remains unverified, and the Playwright full suite shows load-sensitive flakiness in the 120 s harness. The 48×64 P1 canvas remains an opt-in experiment, not the default.

**Exit:** user-approved visual upgrade with unchanged deterministic gameplay and green tests; owner accepted the milestone with the limitations above. See [M1.5 visual upgrade plan](M1_5_VISUAL_UPGRADE.md).

## Milestone 2 – Shared multiplayer foundations (transport-neutral)

**Status: IMPLEMENTED AT THE TRANSPORT-NEUTRAL LEVEL.** Canonical v1 protocol and authorized ingress are merged in PR #41 with hardening in #43, independently reviewed as PASS WITH LIMITATIONS ([report](M2_INDEPENDENT_TESTER_REPORT.md)). The **session envelope contract is owner-approved (2026-11-01)** and implemented in `src/game/session/**` (PR #94, independent Tester PASS WITH LIMITATIONS). The deterministic in-memory benchmark harness merged as PR #79 and the documented scenarios are executable as PR #97; both provide correctness fixtures only, not transport measurements.

- [x] Finalize versioned InputFrame, StateSnapshot and event schemas; room lifecycle covered by the session envelope and its trusted gateway
- [x] Separate simulation, authority, rendering, mode rules and transport adapters (transport adapters exist for WS and WebRTC)
- [x] Implement scripted fixtures, replay checksums, benchmark telemetry and synthetic clients (PR #79, #93, #97)
- [x] Establish identical test workloads for both architectures (same seed `12345`, fixture `7fddf007…`, 300-tick loopback)
- [ ] Add baseline latency, tick duration and bandwidth measurements (blocked: requires owner-provided network environment)

**Exit:** one shared simulation/protocol can be driven by both transport prototypes.

## Milestone 3 – Architecture experiment A: central WebSocket server

**Status: CORRECTNESS PROTOTYPE MERGED (PR #98, `db3112b`), INDEPENDENT TESTER PASS WITH LIMITATIONS.** Loopback only; no authentication, TLS, rate limiting or host migration. Full 7200-tick runs are executable via `npm run bench:ws -- --ticks=7200 --tick-mode=manual` (PR #102), and the benchmark now has separate server and client roles for multi-machine runs (PR #104). `interval` remains the real-time approximation.

- [x] Implement central authoritative 60 Hz TypeScript game session (`server/ws/authoritativeWsSession.ts`)
- [x] Implement WS room join, input processing, state snapshots and disconnections (prototype; no production security)
- [ ] Measure 4/8/12/16 clients on physical LAN and across internet
- [ ] Test loss/jitter, CPU, bandwidth and cost

**Exit:** measured WebSocket baseline with reproducible results.

## Milestone 4 – Architecture experiment B: WebRTC browser host

**Status: CORRECTNESS PROTOTYPE MERGED (PR #100, `ac19645`), INDEPENDENT TESTER PASS.** Loopback ICE only; the benchmark emulates the DataChannel, so no NAT/TURN path is exercised. A served browser harness for two-machine runs remains in the backlog (`M2-NETWORK-ADDRESSABLE-WEBRTC-HARNESS`) because the owner removed the LAN measurement requirement on 2026-11-02.

- [x] Implement WebSocket room signaling and browser-host authoritative session (`server/signaling/**`, `webrtcHostSession.ts`)
- [x] Implement WebRTC DataChannel star topology and client connection lifecycle (one host, up to four clients)
- [ ] Test direct connectivity, NAT/CGNAT, STUN and TURN-relayed scenarios
- [ ] Measure same workload, snapshot/input rates and impairments as experiment A
- [x] Test host exit behaviour: host loss terminates the session without authority migration

**Exit:** measured WebRTC baseline directly comparable to A.

## Milestone 5 – Architecture decision (literature + single-machine evidence)

**Status: DECIDED — ARCHITECTURE A (owner approved 2026-11-02).** The owner changed the gate on 2026-11-02: no LAN, internet or TURN runs were required. The decision rests on documented sources plus single-machine measurements, weighted toward low latency and smooth motion. Milestone acceptance as a whole remains a separate owner action.

- [x] Measure what does not need a network: bytes per input and snapshot per player, snapshot size at 10/20/30 Hz, tick duration p50/p95/p99 over 7200 ticks, snapshot encode cost, process CPU and memory (PR #107)
- [x] Review sources for transport behaviour (TCP head-of-line blocking, SCTP/UDP DataChannels), NAT/CGNAT and TURN cost, browser support and backgrounding (PR #106)
- [x] Write `docs/adr/0001-network-topology.md` with sources, measurements, weighting, open risks and reconsideration criteria — **decided: architecture A, central WebSocket authority**
- [x] State explicitly in the ADR that no network environment was measured
- [x] Owner approved the selection on 2026-11-02
- [ ] Publish the summary alongside the committed local results

**Exit:** a documented, traceable choice approved by the owner; no predetermined winner. Network behaviour that was not measured is recorded as a risk, not as evidence. See [benchmark plan](NETWORK_BENCHMARK_PLAN.md) and [ADR 0001](adr/0001-network-topology.md).

## Milestone 6 – Multiplayer productization

- [ ] Harden selected architecture and room/join workflow
- [ ] Add client prediction, interpolation and reconciliation as needed
- [ ] Implement security controls, disconnect handling and robust errors
- [ ] Validate mixed local/remote players and multiple local controllers per browser
- [ ] Publish browser build and document LAN hosting
- [ ] Profile eight players, explore 12–16 without imposing an arbitrary maximum

**Exit:** reliable multiplayer party game in tested environments.

## Milestone 7 – Polish and future modes

**Status: ACTIVE (owner selection 2026-11-02).** Scope for this goal is the deferred M1.5 readability work plus the arena decision; simulation, determinism and gameplay rules stay unchanged.

- [x] VIS05-02 / VIS05-03: measured (`docs/visual/M1_5_VIS_05_REVIEW_2026-11-02.md`), fixed with an integer 2× option and a responsive external HUD (PR #112), Tester re-checked, **owner accepted visually on 2026-11-02**
- [x] Arena: **Ravintola Mesku accepted visually by the owner on 2026-11-02** (PR #118); typed presentation-only manifests with the station as default and Mesku via `?arena=mesku`, station screenshots byte-identical
- [ ] Online test harness so a remote agent and this machine can play the same real match: server mode, headless bot, served browser client, network metrics ([plan](M7_ONLINE_TEST_HARNESS.md))
- [x] Sound technology and placeholder cues: looping chiptune, all 11 cues, mute and volume persistence, gesture unlock (PR #117). Real samples and mixing remain deferred at the owner's request (`M7-AUDIO-MIX`)
- [ ] Add Last Man Standing and Deathmatch as independent modes — **active goal 2026-11-02**, see [game modes spec](M7_GAME_MODES.md)
- [ ] Revisit dedicated hosting and rollback only if measurements justify them

## Milestone 8 - Bots and eight-player matches

**Status: ACTIVE (owner request 2026-11-02).** A single player should be able to fill empty slots with bots and run a full eight-player round against the computer, first as a readability and load test.

- [ ] Local bot opponents with a deterministic, seeded policy and lobby selection
- [ ] Raise the roster cap to eight across codecs, session and server without changing four-player bytes
- [ ] Eight-slot lobby and HUD, and an honest report on whether eight fighters are readable in the arena
- [ ] Independent QA of determinism, termination and readability
- [ ] Owner playtest: is eight-player versus bots playable?

**Exit:** the owner can start an eight-player match alone against bots and decide whether it is worth keeping. See [bots and eight players](M8_BOTS_AND_EIGHT_PLAYERS.md).

## Definition of done

Each milestone needs a reproducible build, test evidence, known limitations and links to measured results. A checked item indicates work committed, **not necessarily independently validated**.
