# Gate E readiness and measurement record

**Status:** Technical preparation and automated verification complete. Real LAN/internet measurements remain `NOT_MEASURED`; this report does not claim Gate E owner-run network validation or production capacity.

## Objective and boundaries

Gate E requires a repeatable measurement procedure, available 4/8-player evidence, and explicit unknowns. The project owner must run the split-machine network procedure when the machines/network are available. No measurement is inferred from a local or loopback test. The WebSocket transport remains the owner-approved topology; this report does not reopen that decision or compare transports.

## Existing evidence

1. **Eight-player, single-machine measurement:** [`benchmarks/results/m14-8p-20261107T011738309Z.md`](../benchmarks/results/m14-8p-20261107T011738309Z.md), produced by `npm run measure:m14-8p` on 2026-11-07. It covers eight clients, 7200 ticks, snapshots at 10/20/30 Hz and a separate 120-second interval run. It reports snapshot bytes, CPU/RSS and tick/codec timing for that machine only.
2. The measurement report explicitly records network latency, jitter, packet loss, join success, TURN cost, bandwidth and measured network count as `NOT_MEASURED` / zero measured networks. Loopback-only results are not network data.
3. **Repeatable split-role correctness harness:** [`benchmarks/ws/README.md`](../benchmarks/ws/README.md) documents coordinator/client roles, command lines, manifest semantics, failure cases and the fact that all performance fields remain `NOT_MEASURED`. The current distributed fixture is BASE-4; it does not claim an 8-player split-network run.
4. Existing test suites verify the 8-player one-machine harness and split-role correctness/failure behavior. Test results are reproducible using the commands below.

## Owner-run split-machine procedure (BASE-4 correctness, no performance claims)

Use a controlled network and trusted participants only. The prototype is plain `ws://`, has no TLS/authentication/origin checks, and is not suitable for an untrusted network. Allow the chosen TCP port through the coordinator firewall.

Coordinator machine, in repository root:

```sh
npm ci
npm run bench:ws -- --mode=server --host=0.0.0.0 --port=9000 --ticks=7200 --tick-mode=manual
```

Use the printed ready JSON's reachable host and port. Run exactly four clients (one process per slot) on machines that can reach it:

```sh
npm run bench:ws -- --mode=client --url=ws://COORDINATOR:9000 --player=P1 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://COORDINATOR:9000 --player=P2 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://COORDINATOR:9000 --player=P3 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://COORDINATOR:9000 --player=P4 --ticks=7200 --tick-mode=manual
```

All roles must use matching tick counts and tick mode. The coordinator writes `benchmarks/out/<runId>.json`; keep generated run output as an attached artifact or copy it to an explicitly reviewed report. Record machine/OS, topology (LAN/VPN/etc.), date, client distribution, command flags, failures and manifest SHA. Do not edit any result fields. The manual-tick mode is correctness-only and does not measure RTT, jitter, loss, bandwidth or real-time pacing. For throughput/pacing work, define a separate real-time workload before interpreting measurements.

## Gate E measurements ledger

| Metric | 4 players, real network | 8 players, real network | Current 8-player single-machine evidence |
|---|---|---|---|
| RTT / latency | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| Jitter | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| Packet loss | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| Network bandwidth | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` (local server-message byte rates are not network measurement) |
| Join success on real network | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| Snapshot bytes / encode/decode / tick duration | `NOT_MEASURED` on real network | `NOT_MEASURED` on real network | Measured on one recorded machine in the M14 report; see that report for exact tables and caveats |
| TURN cost | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |

**Known limitation:** the documented split-role WS runner currently drives BASE-4 only; the BASE-8 M14 measurement uses eight loopback clients on one machine. Therefore, an 8-player split-network measurement is not yet executable with the current distributed runner. No Gate E conclusion about real 8-player network conditions or capacity is authorized. Address that limitation before claiming real 8-player network validation.

## Automated verification

```sh
npx vitest run tests/ws-prototype.test.ts tests/ws-integration.test.ts tests/ws-full-length-benchmark.test.ts tests/ws-split-roles.test.ts tests/m14-eight-player-measurement.test.ts --reporter=dot
npm test
npm run build
```

These checks validate correctness and harness behavior, not a real network measurement. Keep network fields `NOT_MEASURED` until the owner-run report exists.
