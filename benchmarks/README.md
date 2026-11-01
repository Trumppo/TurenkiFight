# M2 in-memory benchmark correctness harness

Task: M2-BENCHMARK-SCENARIO-IMPLEMENTATION (extends M2-BENCHMARK-HARNESS-IMPLEMENTATION).

Run `npm test -- tests/m2-benchmark-harness.test.ts tests/m2-benchmark-scenarios.test.ts src/game/session` and `npm run build`. The fixture generator uses xorshift32 seed 12345, canonical v1 JSON input frames and exactly 7200 simulation ticks. No sockets, browser latency, artificial impairment or transport selection are involved. **No measured result exists for any scenario.**

## Scenarios

Every scenario is declared in `benchmarks/scenarios.ts` with a fixed ID, version, roster, input/snapshot rates, 60 Hz simulation, 7200 ticks and 120 s match. `generateFixture(id, seed?)` fails explicitly for an unknown scenario, an unknown player count or a transport-only scenario. An unsupported roster is never rounded to 4 or 8.

| Scenario | Kind | Players | Input Hz | Snapshot Hz | Declared impairment (metadata only) |
| --- | --- | ---: | ---: | ---: | --- |
| `BASE-4-60-20` | simulation | 4 | 60 | 20 | 0 ms RTT, 0 ms jitter, 0 % loss |
| `BASE-8-60-20` | simulation | 8 | 60 | 20 | 0 ms RTT, 0 ms jitter, 0 % loss |
| `RATE-4-30-10` | simulation | 4 | 30 | 10 | 0 ms RTT, 0 ms jitter, 0 % loss |
| `LAT-4-60-20-R60-L1` | simulation | 4 | 60 | 20 | 60 ms RTT, 1 % loss |
| `JIT-4-60-20-R120-J30-L3` | simulation | 4 | 60 | 20 | 120 ms RTT, 30 ms jitter, 3 % loss |
| `FAIL-4-HOST-EXIT` | lifecycle | 4 | 60 | 20 | 0 ms RTT, 0 ms jitter, 0 % loss |
| `FAIL-4-RECONNECT` | lifecycle | 4 | 60 | 20 | 0 ms RTT, 0 ms jitter, 0 % loss |
| `NAT-4-TURN` | transport-required | 4 | 60 | 20 | 0 ms RTT, 0 ms jitter, 0 % loss |

`NAT-4-TURN` is declared for completeness but cannot run in memory; requesting it fails explicitly because a forced TURN relay needs a real WebRTC adapter.

### Impairment is metadata only

`LAT-*` and `JIT-*` record the seeded RTT/jitter/loss schedule they would request from a real adapter. The in-memory harness never delays, reorders, drops or measures packets. Their fixture and fingerprint equal `BASE-4-60-20` on the same seed, which is the intended proof that no impairment was simulated. A future transport adapter must apply its own impairment and record actual achieved values separately.

### Roster and frame framing

The canonical v1 `InputFrame` codec caps a frame at four players. Four-player simulations use one frame per tick. Eight-player simulations use two frames per tick (P1-P4, then P5-P8) and advance only after all eight players supplied input for that tick; the frame cap is unchanged. Lifecycle scenarios use one frame per connection so the session envelope wraps the canonical payload unchanged.

The canonical v1 `StateSnapshot` codec also caps a snapshot at four fighters. Four-player final state fingerprints are SHA-256 of the canonical snapshot bytes (`finalStateEncoding: "state-snapshot-v1"`). Eight-player exploration hashes a deterministic JSON serialization of the raw `GameState` (`finalStateEncoding: "harness-state-json-v1"`) instead of silently raising the protocol cap; it is a harness-local digest, not a protocol message.

`RATE-4-30-10` schedules input every second tick; ticks without a scheduled message are advanced with neutral input.

## Replay and manifests

`replayScenario(fixture)` drives the in-memory adapter tick by tick and returns SHA-256 fingerprints for the fixture, final state and ordered event stream. `replayLifecycleScenario(fixture)` drives `SessionEnvelopeGateway` and adds the lifecycle outcome and its own SHA-256. `createUnmeasuredManifest(fixture, replay, commitSha, runId)` requires a **real** 40-hex commit SHA and an explicit run ID, and emits a strictly validated manifest with `result: "NOT_MEASURED"` and `impairmentMode: "configuration-metadata"`.

Manifest fields now come from the scenario declaration: `players`, `localSlotsPerClient`, `inputHz`, `snapshotHz`, `simulationHz`, `matchSeconds` and the declared `impairment`. Missing hardware/browser/CPU metrics and all performance numbers stay `NOT_MEASURED`; the validator rejects zero substituted for a missing metric, a tampered roster, a mismatched rate, mismatched impairment metadata or a wrong replay encoding. The tests use a synthetic commit SHA strictly as validator test data, not as a published benchmark result.

Every scenario is replayed twice and compared in `tests/m2-benchmark-scenarios.test.ts`. The baseline fixture hash and fingerprints are pinned to the values recorded by independent QA (`7fddf007…`, `de544fcd…`, `5bb44bd6…`) so accidental fixture drift fails the test.

## Lifecycle outcomes (in-memory, not network behavior)

`FAIL-4-HOST-EXIT`: the host connection (`conn-1`, slot `P1`) is disconnected at tick 3600. The gateway revokes `P1`, deletes the host sequence domain and rejects the next host input as `not-joined`. No remaining connection can absorb `P1` (`conn-2` join is denied `already-joined`), so no host successor is assigned. `P1` consumes neutral input for the remaining 3600 ticks. The benchmark records `hostAuthority: "not-transferred"` and `authoritySuccessor: null`. This slice exposes no host-gated operation, so the negative guarantee is the observable outcome; the roster-level host rule remains covered by `src/game/session/sessionRoster.test.ts`.

`FAIL-4-RECONNECT`: `P2` is disconnected at tick 2400 and rejoins at tick 2460 with the new identity `conn-2-b`. Input from the new identity before its join and from the old identity after disconnect are both denied `not-joined`; the new identity must perform a fresh join with a fresh sequence domain. `P2` consumes neutral input for 60 ticks. No ownership is recovered implicitly.

The adapter tests are correctness checks, not WS/WebRTC comparisons or evidence of network throughput, latency, NAT behavior or host recovery. Real transport measurement, independent Tester verification and owner acceptance are separate gates.

## WebSocket architecture-A prototype (loopback)

`npm run bench:ws` exercises a BASE-4 loopback run through a prototype authoritative `ws` server and
Node synthetic clients. It writes a `NOT_MEASURED` manifest under `benchmarks/out/` and compares
state/event fingerprints with the in-memory reference. See [`ws/README.md`](ws/README.md). This is not
a transport selection and records no latency, bandwidth or tick-pacing measurements.

Two pacing modes are recorded in the manifest:

- `--tick-mode=interval` (default) lets the server's 60 Hz timers advance the match. It approximates
  real-time pacing, but `tickPacing` stays `NOT_MEASURED`, so it is not a measurement either.
- `--tick-mode=manual` advances ticks on demand after a pong barrier proves every input window was
  consumed. It is a deterministic correctness mode; `npm run bench:ws -- --ticks=7200
  --tick-mode=manual` reaches `finalTick: 7200` in seconds and matches the in-memory reference
  (`de544fcd…` state, `5bb44bd6…` ordered events, a non-empty event stream). A fast run must never be
  read as real-time pacing.

Neither mode is a transport measurement. The wall-clock guard is derived from the tick count (or set
with `--timeout-ms`) because a legitimate 7200-tick real-time run needs 120 s.

## WebRTC architecture-B prototype (loopback correctness only)

`npm run bench:webrtc` drives four client cores through an emulated ordered DataChannel pair into a
browser-host `WebrtcHostSession`, which reuses the existing authoritative session and gateway. It
writes a `NOT_MEASURED` manifest under `benchmarks/out/` and compares bounded state/event
fingerprints with the in-memory reference. See [`webrtc/README.md`](webrtc/README.md). It opens no
ICE/DTLS/TURN path and records no latency, bandwidth, CPU or tick-pacing measurement.
