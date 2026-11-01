# M2 WebSocket architecture-A prototype (loopback or split roles)

Task: M2-WS-PROTOTYPE (extended by M2-FULL-LENGTH-BENCHMARK and
M2-NETWORK-ADDRESSABLE-WS-BENCHMARK).

This slice is a **minimal, testable WebSocket prototype** for local and
multi-machine correctness runs. It is not a transport selection, has no client
prediction or rollback, is not deployed and does **not** claim production
security. WebRTC is a separate slice. Splitting the runner into roles makes a
LAN/internet run *executable*; it produces **no performance numbers** and is not
evidence for any transport decision.

## What runs

- `server/ws/authoritativeWsSession.ts` — authoritative in-process session built on the existing
  `SessionEnvelopeGateway` and deterministic `step()`. Four-player BASE-4 roster, 60 Hz ticks.
- `server/ws/wsServer.ts` — Node `ws` transport. A trusted `conn-N` identity is allocated per socket;
  the client payload can never set it. An optional benchmark-only envelope observer and connection
  cap let a coordinator prove the roster and input barrier; neither can change validation.
- `server/ws/nodeWsClient.ts` — Node synthetic client used by the benchmark and integration tests.
- `src/game/networking/wsSessionClient.ts` — transport-injected client core (browser-safe).
- `src/game/networking/browserWsAdapter.ts` — browser adapter using the global `WebSocket` API only.
- `src/game/networking/wsMessages.ts` — strict, prototype-only server message codec.
- `benchmarks/ws/runWsBenchmark.ts` — role-selecting entry point (`npm run bench:ws`).
- `benchmarks/ws/benchmarkSetup.ts` — shared fixture slice, bounds and parsers used by every role.
- `benchmarks/ws/splitRoles.ts` — `runServerRole` (coordinator) and `runClientRole` (one remote client).
- `benchmarks/ws/manualTickDriver.ts` — deterministic on-demand tick driver used by the loopback
  manual mode.

`src/game/simulation`, the session envelope semantics and presentation are untouched.

## Roles

`--mode` selects one explicit role. The default is the original single-process
loopback run, and its behaviour and output are unchanged.

| Mode | What it does | Writes a manifest |
| --- | --- | --- |
| `loopback` (default) | Starts the server and four synthetic clients in one process on an ephemeral `127.0.0.1` port. | yes |
| `server` | Binds an explicit `--host`/`--port`, waits for exactly the four-player roster, runs the authoritative session for the bounded ticks, and owns the manifest. | yes |
| `client` | Connects to `--url`, joins one `--player` slot, drives the same fixture slice and exits. | no |

A `server` role prints one machine-readable JSON line on stdout *before* the run:

```json
{"kind":"ws-benchmark-server-ready","role":"server-coordinator","url":"ws://0.0.0.0:9000","host":"0.0.0.0","port":9000,"players":["P1","P2","P3","P4"],"boundedTicks":7200,"snapshotHz":20,"tickMode":"manual","maxLeadTicks":8}
```

A wildcard bind has `"url": null`; use `host` and `port` with the machine's
reachable address. A final `ws-benchmark-server-result` line summarises the run.
A client prints one `ws-benchmark-client-result` line. Neither the manifest nor
these lines contain credentials.

## Commands

```bash
npm run bench:ws                 # 300 bounded ticks, interval pacing, 20 Hz snapshots (loopback)
npm run bench:ws -- --ticks=60 --snapshot-hz=10
npm run bench:ws -- --ticks=7200 --tick-mode=manual   # full 120 s correctness run, fast

# Split roles: one process per machine. Pick any reachable port.
npm run bench:ws -- --mode=server --host=0.0.0.0 --port=9000 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://SERVER:9000 --player=P1 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://SERVER:9000 --player=P2 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://SERVER:9000 --player=P3 --ticks=7200 --tick-mode=manual
npm run bench:ws -- --mode=client --url=ws://SERVER:9000 --player=P4 --ticks=7200 --tick-mode=manual

npx vitest run tests/ws-prototype.test.ts tests/ws-integration.test.ts \
  tests/ws-full-length-benchmark.test.ts tests/ws-split-roles.test.ts
```

### Running on separate machines

1. Start the server role on the coordinator machine with an explicit
   `--host`/`--port`. Use `--host=0.0.0.0` to accept remote clients; the
   operating system firewall must allow the port.
2. Read the single JSON ready line and give clients the `ws://host:port` URL.
3. Start exactly four client roles, one per `P1`..`P4` slot, on any machines
   that can reach the server. Every role must use the same `--ticks` and
   `--tick-mode`; a mismatch fails explicitly on `run-complete`.
4. The server role prints the result and writes `benchmarks/out/<runId>.json`
   (git-ignored) when all four clients supplied the full fixture slice.

The server accepts exactly four connections (`maxConnections`). A fifth socket
is closed with WebSocket code 1008 before it can register, and a roster that is
incomplete or spread over the wrong number of connections fails with an explicit
bounded error instead of hanging.

## Manifest

The runner writes `benchmarks/out/<runId>.json` (git-ignored) with
`schemaVersion: 3`. It records bounded-tick correctness fingerprints and the
explicit `topology` block, and compares the fingerprints with the in-memory
BASE-4 reference for the same range:

```json
"topology": {
  "role": "server-coordinator",
  "mode": "network",
  "bindHostProvided": true,
  "bindPortProvided": true,
  "clientCount": 4,
  "clientsInProcess": false,
  "tls": false
}
```

- `role: "loopback"` and `mode: "loopback"` describe the single-process default;
  `role: "server-coordinator"` and `mode: "network"` describe a split run.
  `network` means the roles ran as separate processes over sockets; it does not
  claim that the run crossed a LAN or the internet.
- Only bind presence is recorded. A split manifest sets
  `environment.bindAddress: "NOT_RECORDED"` and never contains the bind host,
  a URL or a private address.
- `result: "NOT_MEASURED"`;
- `measurements.latency|bandwidth|cpu|tickPacing: "NOT_MEASURED"`;
- no wall-clock, throughput, RTT, jitter or loss numbers are invented.

The validator is strict: it rejects numeric measurement substitutes, an
inconsistent role/mode/`clientsInProcess`/bind combination, a manifest without a
topology block, and a split manifest that discloses a bind address.

The `bench:ws` script runs through `vite-node`, which ships as a dependency of
the existing `vitest` devDependency; no additional runner package is declared.

A `matchesInMemoryReference: true` means the server consumed the same canonical
inputs and produced identical state and event fingerprints for the bounded
range. It is a correctness observation, not a network measurement.

## Tick modes (pacing is recorded, never measured)

`--tick-mode` selects how authoritative ticks are produced. The default stays `interval`.

| Mode | Authority advances | Meaning |
| --- | --- | --- |
| `interval` (default) | The server's own 60 Hz timers | Approximates real-time pacing. `tickPacing` stays `NOT_MEASURED`, so this is **not** a pacing measurement either. |
| `manual` | The coordinator, on demand | Deterministic correctness mode. In the loopback role inputs are submitted in a bounded window and a pong barrier proves the server consumed them before stepping. In the split server role the coordinator steps a tick only after every client connection has submitted that tick. |

Manual mode never uses a timer to advance the match: it calls `beginMatch()` and
`stepOnce()` itself, so a 7200-tick match completes in seconds. The manifest
records `tickMode` and a derived `pacing` value
(`timer-driven-approximation` or `unsynchronized-correctness`), so a fast
correctness run cannot be mistaken for a real-time measurement. A fast run still
has `result: "NOT_MEASURED"` and all performance fields `NOT_MEASURED`.

The wall-clock guard is a hang guard, not a measurement. By default it is
derived from the tick count (`30 s + ticks / TICK_RATE` for `interval`, `30 s +
5 ms / tick` for `manual`), so a legitimate 120 s real-time run is not aborted.
`--timeout-ms` overrides it explicitly. `manual` split runs also use a bounded
per-tick barrier timeout so a lost client fails instead of hanging.

## Full-length (7200-tick / 120 s) correctness

`npm run bench:ws -- --ticks=7200 --tick-mode=manual` reaches `finalTick: 7200`,
reports `matchesInMemoryReference: true`, and reproduces the same BASE-4
fingerprints as the WebRTC prototype run for the same fixture and seed:

- fixture `7fddf007…`, final state `de544fcd…`, ordered events `5bb44bd6…`;
- `lateTicks: 0`, `deniedMessages: 0`;
- `tickMode: "manual"`, `pacing: "unsynchronized-correctness"`.

The split server/client roles reproduce the same fingerprints across separate
processes on loopback (`tests/ws-split-roles.test.ts`), including a two-process
CLI run. The ordered event stream is non-empty (the first deterministic
`HitLanded` event occurs at tick 2062), and the regression tests assert the
event fingerprint is not `sha256("[]")`. It is a correctness fingerprint, not a
transport or pacing result.

## Tests

`tests/ws-prototype.test.ts` (no real sockets) covers trusted identity, spoofed
slot rejection, roster freeze, premature-input denial, snapshot rates and codec,
disconnect semantics, host-loss termination, bounded runs, client sequencing,
the browser adapter (with an injected global `WebSocket` stub), manifest pacing
and schema-3 topology fields, and a source-level check that
`src/game/networking` never imports `ws` or `node:`.

`tests/ws-integration.test.ts` uses a local ephemeral port with manual ticking.
It covers join, authorized input, a raw spoofed frame over a real socket, host
disconnect and the absence of authority migration. If the sandbox cannot bind a
local socket, the test skips with an explicit reason.

`tests/ws-full-length-benchmark.test.ts` pins the 7200-tick in-memory
fingerprints with a non-empty ordered event stream and drives the full-length
manual socket path (four real sockets, pong barriers, `stepOnce`) to the same
pinned fingerprints. The socket test skips with an explicit reason when the
sandbox cannot bind a local port; the in-memory pin still runs.

`tests/ws-split-roles.test.ts` runs the server and four client roles over a real
socket on an ephemeral port and pins the same 7200-tick fingerprints, runs the
CLI roles as separate processes over loopback, and covers the negative cases: a
missing client, a roster spread over too few connections (explicit bounded
failure) and an unexpected fifth connection (closed with 1008 without
corrupting the run).

## Dependencies and bundle boundary

`ws` and `@types/ws` are **devDependencies** used only by `server/ws/` and
`benchmarks/ws/`. The browser adapter imports neither. `npm run build` output was
inspected to confirm `ws` is absent from the browser bundle.

## Limitations

- No authentication, TLS, origin checks, authorization provider, rate limiting,
  reconnect or production hardening. Trusted connection identity here means a
  server-allocated socket ID only. A split run is plain `ws`, so it is suitable
  for a controlled LAN test, never for an untrusted network.
- No client prediction, rollback, interpolation, reconnect token, host migration
  or TURN. There is no ICE/NAT traversal because this slice is not WebRTC.
- No latency, bandwidth, CPU, tick-pacing or real-network measurement. A split
  loopback run is not LAN or internet evidence, and `manual` mode in particular
  is **not** a real-time pacing run. No numbers are reported by any role.
- The benchmark helpers (`maxTicks`, `maxConnections`, envelope observation) and
  the server message schema are prototype-only.
- Only the four-player BASE-4 input stream is executable here. An eight-player
  roster is rejected by the four-slot session ingress and the canonical
  four-fighter snapshot cap, so `BASE-8-60-20` is not wired into this prototype.
  `RATE-4-30-10` would additionally need neutral ticks for the 30 Hz frame
  schedule. Snapshot rate is configurable with `--snapshot-hz` (10/20/30).
