# M2 WebSocket architecture-A prototype (loopback only)

Task: M2-WS-PROTOTYPE.

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
npm run bench:ws                 # 300 bounded ticks, 20 Hz snapshots, local ephemeral port
npm run bench:ws -- --ticks=60 --snapshot-hz=10
npx vitest run tests/ws-prototype.test.ts tests/ws-integration.test.ts
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

## Tests

`tests/ws-prototype.test.ts` (no real sockets) covers trusted identity, spoofed slot rejection,
roster freeze, premature-input denial, snapshot rates and codec, disconnect semantics, host-loss
termination, bounded runs, client sequencing, the browser adapter (with an injected global
WebSocket stub) and a source-level check that `src/game/networking` never imports `ws` or `node:`.

`tests/ws-integration.test.ts` uses a local ephemeral port with manual ticking. It covers join,
authorized input, a raw spoofed frame over a real socket, host disconnect and the absence of
authority migration. If the sandbox cannot bind a local socket, the test skips with an explicit
reason.

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
  evidence for any transport decision.
- The benchmark helpers (`maxTicks`) and server message schema are prototype-only.
