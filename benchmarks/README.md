# M2 in-memory benchmark correctness harness

Task: M2-BENCHMARK-HARNESS-IMPLEMENTATION

Run `npm test -- tests/m2-benchmark-harness.test.ts` and `npm run build`. The fixture generator uses xorshift32 seed 12345, four players, canonical v1 JSON input frames and exactly 7200 simulation ticks. The in-memory adapter implements connect, join, sendInput, observeSnapshot, observeEvents, disconnect and close. No sockets, browser latency, artificial impairment or transport selection are involved.

`generateBaselineFixture()` returns the canonical input frames and SHA-256 of the newline-joined encoded frame stream. `replayBaseline()` runs the authoritative simulation and returns SHA-256 of the final canonical state snapshot and ordered event stream. `createUnmeasuredManifest()` requires a **real** 40-hex commit SHA and an explicit run ID; it emits a strictly validated machine-readable manifest with `result: NOT_MEASURED`. The tests use a synthetic commit SHA strictly as validator test data, not as a published benchmark result.

The adapter tests are correctness checks, not WS/WebRTC comparisons or evidence of network throughput, latency or NAT behavior. Scenarios for eight players, impairment, host recovery and TURN remain future work and must not be presented as measured. Independent Tester verification and owner acceptance are separate gates.
