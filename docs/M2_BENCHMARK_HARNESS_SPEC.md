# M2 transport comparison harness — executable specification

**Status:** design specification, no measurements yet. Companion to [NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md) and [M2_SESSION_ENVELOPE_V1.md](M2_SESSION_ENVELOPE_V1.md). Do not choose WS/WebRTC before running both.

## Goal and interface
A transport-independent, deterministic load driver must be able to exercise either architecture with identical canonical v1 input frames and a seeded 120 s Score Brawl simulation. Implement an adapter interface in `benchmarks/` that exposes `connect(config)`, `join(slots)`, `sendInput(encodedCanonicalFrame)`, `observeSnapshot()`, `observeEvents()`, `disconnect()`, `close()`. Adapter implementations may attach a session envelope but must not rewrite the canonical gameplay payload. Separate authoritative simulation time from end-to-end transport latency.

## Scenario IDs
- `BASE-4-60-20`: 4 players, 60 Hz input, 20 Hz snapshots, 120 s, no artificial impairment.
- `BASE-8-60-20`: 8 players, otherwise identical; performance exploration, not a product promise.
- `RATE-4-30-10`: 4 players, 30 Hz input, 10 Hz snapshots.
- `LAT-4-60-20-R60-L1`: 4 players, imposed 60 ms RTT, 1% loss; record actual achieved impairment.
- `JIT-4-60-20-R120-J30-L3`: 4 players, imposed 120 ms RTT, 30 ms jitter, 3% loss.
- `FAIL-4-HOST-EXIT`: host disconnect during active match; record lifecycle and recovery.
- `FAIL-4-RECONNECT`: player disconnect and reconnect attempt; record capability and identity handling.
- `NAT-4-TURN`: WebRTC forced TURN relay, compare against equivalent WS remote setup; record relay cost separately.
Run at least five measured repetitions after warmup for each comparable scenario. Test physical LAN and remote internet independently; never label loopback as LAN evidence.

## Required run manifest
Store JSON at `benchmarks/results/<run-id>/manifest.json`:
```json
{
  "schemaVersion": 1,
  "runId": "BASE-4-60-20-ws-001",
  "scenarioId": "BASE-4-60-20",
  "commitSha": "<actual git SHA>",
  "transport": "websocket",
  "authority": "central-server",
  "protocolVersion": 1,
  "fixtureSha256": "<actual SHA-256 of input fixture>",
  "seed": 12345,
  "players": 4,
  "localSlotsPerClient": [1, 1, 1, 1],
  "simulationHz": 60,
  "inputHz": 60,
  "snapshotHz": 20,
  "matchSeconds": 120,
  "impairment": {"rttMs": 0, "jitterMs": 0, "lossPercent": 0},
  "environment": {"network": "loopback", "os": "<measured>", "browser": "<measured>", "cpu": "<measured>", "turn": false},
  "result": "NOT_MEASURED"
}
```
Manifest values above are illustrative, **not measured results**. `runId` must be unique; persist actual host/transport versions, UTC timestamps, packet framing overhead and impairment mechanism. Do not commit private IP addresses, access tokens or room credentials.

## Data outputs and calculations
- `samples.jsonl`: timestamped tick duration, input-to-authority acknowledgment, input-to-visible effect where measured, RTT, bytes in/out, CPU/RAM and drop/late events.
- `summary.json`: sample counts, p50/p95/p99, join success, disconnections, state divergence count, max tick lag, effective throughput and errors.
- `replay.json`: seed, fixture hash, final authoritative state fingerprint and ordered event fingerprint.
- `README.md`: exact command, dependencies, machine setup, network impairment configuration and limitations.

For percentile computation define a single interpolation algorithm and report sample count. Use monotonic time within each process. One-way timing requires synchronized clocks; otherwise report RTT and local input-to-ack. Distinguish authoritative confirmation from immediate client prediction. Report missing metrics as `NOT_MEASURED`, never zero.

## Correctness and security gates
- Identical seed and canonical inputs must produce identical authoritative final state and event fingerprints for both adapters.
- Each transport must reject malformed/oversized/unauthorized messages before they reach the deterministic session.
- Enforce connection-to-player ownership, replay prevention, bounded queue and tick window; report disconnect/rejoin semantics.
- Browser client and synthetic load driver must not share mutable global session state across runs.
- No automatic architecture decision based on single run or one metric.

## Handoff
**Gameplay:** implement shared fixture generator, manifest schema validator, no-op/in-memory adapter and replay fingerprint tests first; then WS and WebRTC adapters in separate PRs. **Tester:** independently validate fixture reproducibility, manifest completeness, missing-metric handling, disconnect and adversarial inputs. **Designer:** review metric definitions and compare authority placement separately from transport overhead. **Graphics:** no benchmark file ownership; continue M1.5 QA fixes.

**Acceptance:** reproducible CLI commands, CI unit tests and browser smoke as applicable, independent Tester report, and owner merge approval. Benchmark numbers remain pending until actual experiments.
