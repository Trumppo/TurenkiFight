# TurenkiFight – WebSocket vs WebRTC Network Architecture Benchmark

**Version:** 0.1  
**Created:** 2026-10-24  
**Status:** Test plan; no transport selected.

> **Protocol reconciliation note (2026-10-31):** The `InputFrame` shape illustrated below is an early benchmark sketch, **not** the current M2 v1 wire contract. The implementation on `feature/m2-input-frame-contract` uses a versioned tick and canonical `inputs[]` array; see `docs/M2_INPUT_PROTOCOL.md` on that branch. Before building network adapters, use `docs/M2_INTEGRATION_GATE.md` to reconcile the simulation-boundary codec with a separate future session/transport envelope. Keep benchmark workloads identical across WebSocket and WebRTC. No transport has been selected.

## Decision to make

Choose a network topology for a browser-based 2.5D party fighting game with configurable player count and LAN/remote-internet play. Compare:

- **A – WebSocket:** central authoritative TypeScript simulation on a small Linux server. Clients communicate using WSS (or WS for controlled offline LAN).
- **B – WebRTC DataChannel:** browser-host-authoritative star topology; clients communicate with host over DataChannels. A WebSocket signaling service coordinates rooms, SDP and ICE. STUN/TURN used where required.

Do not mistake the two variants as an isolated transport-only A/B test: they also differ in **authority placement, CPU, upload bandwidth, NAT behavior, failure modes and hosting cost**. Record those separately. If feasible, add an optional follow-up comparison with WebRTC to a dedicated server to isolate transport from topology.

## Hypotheses to falsify

1. A is operationally simpler and more reliable across NATs than B.
2. B reduces central server traffic when direct peer connections succeed, but loads the host's CPU/uplink.
3. Under loss/jitter, WebRTC unordered/unreliable DataChannel configurations may offer better action responsiveness than ordered reliable WebSocket/TCP, at the cost of protocol complexity.
4. For a small party-game workload, A may perform well enough that B's extra complexity is not justified.
5. Both approaches can support offline LAN with suitable local serving/signaling, but must be verified in real browsers.

## Fair experimental implementation

Implement the same framework-independent 60 Hz simulation, combat rules, input validation, room semantics, serialized protocol and snapshot policy in both variants. Start with 8 fighters in a fixed arena, seeded scripted input sequences and repeatable load tests. Run identical build revisions, client devices and network impairments. Avoid running a browser game renderer on every synthetic client when measuring server/transport scaling; separately run real-browser end-to-end tests.

**Protocol:**
- Input: `InputFrame {version, playerId, seq, tick, buttons, axisX, axisY}` at 30–60 Hz (measure both).
- State: `StateSnapshot {version, tick, fighters, scores, matchClock}` at 10/20/30 Hz (measure all three).
- Events: `HitEvent`, `KOEvent`, `RoomState`, `MatchEnd`, `Ping/Pong`.
- Explicit framing, size limits, player ownership validation, monotonically increasing sequence numbers, disconnect timeout and reconnect behavior.
- Record exact payload bytes and overhead; use JSON initially, evaluate binary only after measuring.

**Fairness rules:** same match seed, scripted inputs, fighter count, server/host tick, snapshots, client prediction/interpolation policy and client hardware class. Measure authoritative simulation separately from rendering. Warm up before collecting results; capture versions, network type, browser, OS, CPU, topology, geography, TURN use and run IDs.

## Test environments

1. **Loopback/local dev:** smoke tests and correctness, not internet latency evidence.
2. **Physical LAN:** multiple machines on the same wired switch; repeat on Wi-Fi. Include a fully offline LAN where the static site and signaling endpoint are locally served.
3. **Internet, nearby:** server in a Finnish/nearby EU datacenter, clients on different residential connections.
4. **Internet, difficult NAT:** mobile connection, CGNAT and restrictive networks; force TURN relay for one B run.
5. **Network emulation:** controlled added RTT 20/60/120 ms, jitter 0/10/30 ms, packet loss 0/1/3/5%, bandwidth caps; document whether impairment applies to one or both directions. Browser and Linux network shaping tools may differ.

Use synchronized clocks when measuring one-way delays; otherwise report RTT and input-to-authoritative-acknowledgement or input-to-visible-result with the measurement method stated. Do not report one-way latency from unsynchronized clocks.

## Workload matrix

| Variable | Cases |
| --- | --- |
| Players | 2, 4, 8, 12, 16 |
| Local players per browser | 1; mixed 2–4 on one client |
| Simulation | 60 ticks/s |
| Input rate | 30, 60 per second |
| Snapshot rate | 10, 20, 30 per second |
| Match length | 120 s |
| Repetitions | >= 5 measured runs per scenario after warm-up |
| Rendering | headless synthetic load; separate real-browser runs |
| Failures | host leaves, client drops, packet loss, signaling outage, TURN fallback |

The 12/16-player cases are exploration, **not a promise of supported capacity**. Prioritize 4/8 player cases first, then expand based on evidence.

## Metrics and instrumentation

Capture time series and per-run summaries:

- **Responsiveness:** input-to-visible-effect p50/p95/p99 where instrumentable; RTT p50/p95/p99; frame pacing and correction magnitude; hit-confirmation lag.
- **Correctness:** authoritative hit/KO/score consistency, duplicate or lost actions, tick drift, state divergence and reconnect recovery.
- **Reliability:** join success rate, time to playable connection, reconnect success, disconnects, host-loss consequences, TURN fallback percentage.
- **Performance:** server/host CPU (average and peak), RAM, event-loop lag, simulation tick duration, browser FPS and long frames.
- **Network:** bytes/s up/down for each client, host and server, peak burst, retransmissions/packet loss where observable, TURN relay bytes and bandwidth cost.
- **Operations:** deployment steps, certificates, NAT/TURN maintenance, debugging complexity, reproducibility and monthly cost estimate.

Suggested telemetry: monotonic timestamps, correlation IDs, structured logs, WebRTC getStats(), WebSocket counters, OS network counters and CPU sampling. Keep raw run outputs under `benchmarks/results/` when ready, avoiding private IPs or personal data in public commits.

## Provisional decision gates (not performance claims)

A candidate is considered **eligible** for a recommended first release if, under a defined reference setup (8 players, 60 Hz simulation, 20 Hz snapshots, 120-second matches):

- >= 99% of attempted joins succeed across the **tested** representative network environments; report sample size and confidence limitations.
- No score/KO disagreement between authority and clients after reconciliation.
- Simulation sustains 60 ticks/s without sustained overload; report p95/p99 tick duration and dropped/late ticks.
- At baseline 60 ms imposed RTT and 1% packet loss, p95 input-to-visible-feedback is targeted at <= 150 ms **for remote-player authoritative confirmation**; local prediction feedback should be reported separately. This is a design target to validate, not a guaranteed threshold.
- No recurring crashes or unrecovered session stalls in >= 5 runs of 120 seconds per key case.
- Operational cost fits the intended small-server budget, documented with bandwidth/TURN assumptions.

If both are eligible, prefer the simpler and more reliable operational design unless the other demonstrates a meaningful responsiveness or cost advantage. If neither passes, change snapshot rates, authority placement or protocol, and rerun. Do not select a winner based on one metric alone.

## Execution steps

1. Freeze common sim and protocol contracts; add repeatable scripted bot inputs and replay checksum tests.
2. Build a synthetic transport-independent benchmark harness and baseline local correctness tests.
3. Implement A: central WebSocket authoritative session, browser client and room handling.
4. Implement B: browser-host authoritative session, signaling, WebRTC DataChannel; instrument direct and TURN-relayed cases.
5. Run loopback and physical LAN tests (including offline LAN).
6. Run multi-network and controlled impairment tests; capture telemetry.
7. Run failure-injection tests: host exits, disconnects, reconnects, signaling outage and TURN failure.
8. Compare operations, security, bandwidth and monthly costs; write results in `benchmarks/RESULTS.md`.
9. Record a decision in `docs/adr/0001-network-topology.md` with evidence, trade-offs, rejected alternatives and re-evaluation triggers.

## Deliverables

- `src/game/protocol/`: versioned transport-independent message definitions.
- `src/game/networking/`: interface plus WebSocket and WebRTC adapters.
- `server/`: authoritative WS session and signaling experiments (isolated modules).
- `benchmarks/`: reproducible harness, scenario definitions, raw metrics and analysis.
- `docs/adr/0001-network-topology.md`: **PENDING** until measured results exist.

## Decision status

**OPEN – no network transport or authority topology has been locked in.** A and B remain candidates until results are recorded.
