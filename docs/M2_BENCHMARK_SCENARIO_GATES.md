# M2 benchmark scenario and approval gates

Status: planning only. Extends [benchmark harness specification](M2_BENCHMARK_HARNESS_SPEC.md); no measured results or WS/WebRTC selection.

## Reproducible scenarios

Each fixture must pin scenario ID, version, seed 12345 (or documented override), canonical v1 frame stream SHA-256, exact commit SHA, player-to-connection mapping, input schedule, 60 Hz simulation and 7200 ticks. Re-run twice and compare final state and ordered event fingerprints. An unsupported player count must fail explicitly, not silently change capacity.

- **BASE-8-60-20:** eight simulated players, 7200 ticks; deterministic joins, stable IDs and explicit capacity configuration. Exploratory only; does not expand the approved four-player M1 product scope.
- **LAT-4-60-20-R60-L1:** seeded 60 ms RTT and 1% loss schedule; verify input ordering, expiry and replay handling. Synthetic impairment is not a measured network result.
- **JIT-4-60-20-R120-J30-L3:** seeded 120 ms RTT, 30 ms jitter and 3% loss schedule; verify late/duplicate input handling and state parity. Record the actual impairment separately when a real adapter exists.
- **FAIL-4-HOST-EXIT:** host disconnect at tick 3600; require explicit authority revocation, no implicit host migration and rejection of stale inputs.
- **FAIL-4-RECONNECT:** disconnect at tick 2400, reconnect at tick 2460 under a new trusted connection identity; reject replay and old ownership.

## Evidence and decision gates

1. **Gameplay correctness:** reproducible CLI, exact fixture hashes and commit, stable fingerprints, negative tests for malformed manifest, unsupported capacity and invalid identity; keep missing measurements as `NOT_MEASURED`.
2. **Independent Tester:** clean-checkout rerun, SHA, commands, evidence and PASS / PASS WITH LIMITATIONS / FAIL. Do not equate in-memory correctness with actual transport performance.
3. **Real transport measurement:** only after adapters exist, compare identical fixture and authority semantics across central WS and browser-host WebRTC. Five repetitions after warmup per scenario and environment; separate physical LAN and remote internet from loopback. Capture actual RTT/jitter/loss, p50/p95/p99, throughput, CPU, tick lag, bytes, disconnect/reconnect outcome, NAT/TURN and environment.
4. **Designer and owner decision:** separate authority-placement costs from transport overhead; document security, operational, NAT and recovery trade-offs. Require explicit owner approval before choosing transport or starting production envelope work.

Gameplay owns fixture extensions, Tester independently verifies, Designer documents the comparison. Graphics has no benchmark ownership. Benchmark implementation merge and independent QA remain prerequisites. No architecture approval is implied.
