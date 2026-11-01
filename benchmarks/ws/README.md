# M2 WebSocket architecture-A prototype (loopback only)

Task: M2-WS-PROTOTYPE (extended by M2-FULL-LENGTH-BENCHMARK).

This slice is a **minimal, testable WebSocket prototype** for local benchmarking. It is not a transport
selection, has no client prediction or rollback, is not deployed and does **not** claim production
security. WebRTC is a separate slice.

## What runs

- `server/ws/authoritativeWsSession.ts` — authoritative in-process session built on the existing
  `SessionEnvelopeGateway` and deterministic `step()`. Four-player BASE-4 roster, 60 Hz ticks.
- `server/ws/wsServer.ts` — Node `ws` transport. A trusted `conn-N` identity is allocated per socket;
  the client payload can never set it.
- `server/ws/nodeWsClient.ts` — Node synthetic client used by the benchmark and integration test.
- `src/game/networking/wsSessionClient.ts` — transport-injected client core (browser-safe).
- `src/game/networking/browserWsAdapter.ts` — browser adapter using the global `WebSocket` API only.
- `src/game/networking/wsMessages.ts` — strict, prototype-only server message codec.
- `benchmarks/ws/runWsBenchmark.ts` — bounded loopback benchmark entry (`npm run bench:ws`).
- `benchmarks/ws/manualTickDriver.ts` — deterministic on-demand tick driver used by manual mode.

`src/game/simulation`, the session envelope semantics and presentation are untouched.

## Behaviour

- Joins, inputs, leaves and pings still go through `SessionEnvelopeGateway`; ownership, duplicate,
  late/future tick and replay rules are unchanged.
- The session auto-starts once every configured slot is claimed (the v1 client envelope has no
  host-only start kind yet). The roster is frozen from `starting` onwards.
- Snapshots use the existing `StateSnapshot` codec/validator and are emitted at 10, 20 or 30 Hz
  (configured, must divide 60).
- A host disconnect or host `leave-request` terminates the session with
  `session-closed: host-lost`. Authority is **never** migrated to another connection.
- Non-host disconnect revokes that connection's slots and sequence domain; the match continues with
  neutral input for the vacated slot.
- `maxTicks` is a benchmark-only bound. It emits a final snapshot and one `run-complete` message.

Server message kinds (`welcome`, `join-result`, `roster`, `match-start`, `snapshot`, `error`, `pong`,
`match-end`, `run-complete`, `session-closed`) are a prototype schema, **not a frozen wire contract**.

## Commands

```bash
npm run bench:ws                 # 300 bounded ticks, interval pacing, 20 Hz snapshots
npm run bench:ws -- --ticks=60 --snapshot-hz=10
npm run bench:ws -- --ticks=7200 --tick-mode=manual   # full 120 s correctness run, fast
npx vitest run tests/ws-prototype.test.ts tests/ws-integration.test.ts tests/ws-full-length-benchmark.test.ts
```

The runner writes `benchmarks/out/<runId>.json` (git-ignored). It records bounded-tick correctness
fingerprints and compares them with the in-memory BASE-4 reference for the same range:

- `result: "NOT_MEASURED"`;
- `measurements.latency|bandwidth|cpu|tickPacing: "NOT_MEASURED"`;
- no wall-clock, throughput, RTT, jitter or loss numbers are invented.

The `bench:ws` script runs through `vite-node`, which ships as a dependency of the existing
`vitest` devDependency; no additional runner package is declared.

A `matchesInMemoryReference: true` means the server consumed the same canonical inputs and produced
identical state and event fingerprints for the bounded range. It is a correctness observation, not a
network measurement.

## Tick modes (pacing is recorded, never measured)

`--tick-mode` selects how authoritative ticks are produced. The default stays `interval`.

| Mode | Authority advances | Meaning |
| --- | --- | --- |
| `interval` (default) | The server's own 60 Hz timers | Approximates real-time pacing. `tickPacing` stays `NOT_MEASURED`, so this is **not** a pacing measurement either. |
| `manual` | The benchmark, on demand | Deterministic correctness mode. Inputs are submitted in a bounded window, a pong barrier proves the server consumed them, then ticks are stepped as fast as loopback I/O allows. |

Manual mode never uses a timer to advance the match: it calls `beginMatch()` and `stepOnce()` itself,
so a 7200-tick match completes in seconds. The manifest records `tickMode` and a derived `pacing` value
(`timer-driven-approximation` or `unsynchronized-correctness`), so a fast correctness run cannot be
mistaken for a real-time measurement. A fast run still has `result: "NOT_MEASURED"` and all
performance fields `NOT_MEASURED`. These fields arrived with manifest `schemaVersion: 2`; manifests
without a tick mode are rejected by the validator.

The wall-clock guard is a hang guard, not a measurement. By default it is derived from the tick count
(`30 s + ticks / TICK_RATE` for `interval`, `30 s + 5 ms / tick` for `manual`), so a legitimate 120 s
real-time run is not aborted. `--timeout-ms` overrides it explicitly.

## Full-length (7200-tick / 120 s) correctness

`npm run bench:ws -- --ticks=7200 --tick-mode=manual` reaches `finalTick: 7200`, reports
`matchesInMemoryReference: true`, and reproduces the same BASE-4 fingerprints as the WebRTC prototype
run for the same fixture and seed:

- fixture `7fddf007…`, final state `de544fcd…`, ordered events `5bb44bd6…`;
- `lateTicks: 0`, `deniedMessages: 0`;
- `tickMode: "manual"`, `pacing: "unsynchronized-correctness"`.

The ordered event stream is non-empty (the first deterministic `HitLanded` event occurs at tick 2062),
and the regression test asserts the event fingerprint is not `sha256("[]")`. It is a correctness
fingerprint, not a transport or pacing result.

## Tests

`tests/ws-prototype.test.ts` (no real sockets) covers trusted identity, spoofed slot rejection,
roster freeze, premature-input denial, snapshot rates and codec, disconnect semantics, host-loss
termination, bounded runs, client sequencing, the browser adapter (with an injected global
WebSocket stub), manifest pacing fields and a source-level check that `src/game/networking` never
imports `ws` or `node:`.

`tests/ws-integration.test.ts` uses a local ephemeral port with manual ticking. It covers join,
authorized input, a raw spoofed frame over a real socket, host disconnect and the absence of
authority migration. If the sandbox cannot bind a local socket, the test skips with an explicit
reason.

`tests/ws-full-length-benchmark.test.ts` pins the 7200-tick in-memory fingerprints with a non-empty
ordered event stream and drives the full-length manual socket path (four real sockets, pong barriers,
`stepOnce`) to the same pinned fingerprints. The socket test skips with an explicit reason when the
sandbox cannot bind a local port; the in-memory pin still runs.

## Dependencies and bundle boundary

`ws` and `@types/ws` are **devDependencies** used only by `server/ws/` and `benchmarks/ws/`. The
browser adapter imports neither. `npm run build` output was inspected to confirm `ws` is absent from
the browser bundle.

## Limitations

- No authentication, TLS, origin checks, authorization provider, per-connection rate limiting or
  production hardening. Trusted connection identity here means a server-allocated socket ID only.
- No client prediction, rollback, interpolation, reconnect token or host migration.
- No WebRTC, NAT/TURN handling or deployment.
- No latency, bandwidth, CPU, tick-pacing or real-network measurement. Loopback on one machine is not
  evidence for any transport decision. `manual` mode in particular is **not** a real-time pacing run.
- The benchmark helpers (`maxTicks`) and server message schema are prototype-only.
- Only the four-player BASE-4 input stream is executable here. An eight-player roster is rejected by
  the four-slot session ingress and the canonical four-fighter snapshot cap, so `BASE-8-60-20` is not
  wired into this prototype. `RATE-4-30-10` would additionally need neutral ticks for the 30 Hz frame
  schedule. Snapshot rate is configurable with `--snapshot-hz` (10/20/30).
