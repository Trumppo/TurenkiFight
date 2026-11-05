# M7 online test harness: real multiplayer between this machine and a remote agent

**Status:** Implemented in three parts: match server (PR #111), headless bot clients (PR #113) and the browser online client (PR #114); the online result screen and opt-in rematch landed in PR #149. Two-machine network measurements remain open and every network number stays `NOT_MEASURED`.
**Owner request:** an agent (for example Codex) plays the game in a headless browser on a virtual machine
elsewhere while the owner plays in a browser on this machine, and the same mechanism is used to test
multiplayer with several players.
**Decision context:** [ADR 0001](adr/0001-network-topology.md) selected architecture A (central
authoritative WebSocket server) on a risk basis with **no network measurement**. This harness is how we
turn that accepted risk into measurable fact.

## 1. What already exists

| Piece | State |
| --- | --- |
| Authoritative 60 Hz session over WebSocket, 4 slots, snapshots at 10/20/30 Hz | `server/ws/**`, PR #98 |
| Trusted identity, envelope gateway, join/leave/disconnect rules | merged, independently tested |
| Transport-injected client core + browser `WebSocket` adapter | `src/game/networking/wsSessionClient.ts`, `browserWsAdapter.ts` (no UI) |
| Node synthetic client that drives scripted fixture input | `server/ws/nodeWsClient.ts` + `benchmarks/ws/**` |
| Split server/client roles for multi-machine runs | `benchmarks/ws/runWsBenchmark.ts --mode=server|client`, PR #104 |
| Real browser host + client over WebRTC | PR #100 (not needed for architecture A) |
| **Online entry point in the actual game** | **missing** — the local game never opens a socket |
| **Snapshot rendering / interpolation for a remote client** | **missing** |
| **Real-match server mode (as opposed to fixture benchmark)** | **missing** |
| **Network metrics (RTT, snapshot gaps, input latency)** | **missing** — every network field is `NOT_MEASURED` |

So the request is achievable, but three pieces must be built first. The good news: the hard
correctness layer (authority, identity, envelope, disconnect) already exists and is tested.

## 2. Two ways for the agent to play

**Option A — Node bot (recommended first).** A headless Node process that joins as P2–P4, sends
deterministic input and records metrics. No browser, no GPU, no rendering; runs in any small VM or
container. It exercises the real network path and the real server, but not the browser client code.

**Option B — headless Chromium (Playwright) in the VM.** The agent opens the served game page in
headless Chromium, plays via synthetic key events and takes screenshots. This exercises the real
browser client, at the cost of a heavier VM, slower input injection and screenshot flakiness.

**Recommendation:** build Option A first (cheap, robust, gives the numbers), then add Option B as a
thin reuse of the same page for UI verification. Both can run against the same server at once.

## 3. Pieces to build

### 3.1 Real-match server mode
A `serve` entry (for example `npm run serve:match`) that binds an explicit host/port, accepts up to
four players, starts the match when the roster is full (or on an explicit start), runs the 60 Hz
authoritative loop in real time and closes cleanly. This is a thin wrapper over `AuthoritativeWsSession`
and `startWsServer`; it must not reuse the benchmark's fixture driver.

### 3.2 Browser client entry
A minimal online page (for example `online.html` or `?online=1`) that
1. reads a server URL (query parameter or input field),
2. joins as a chosen player slot through the existing client core,
3. maps local keyboard/gamepad input to canonical `InputFrame`s at 60 Hz,
4. renders received snapshots with **interpolation between snapshots** and no prediction,
5. shows connection state, RTT and a snapshot counter so the player can see the link quality.

Explicitly out of scope for the first version: client prediction, rollback, reconciliation, matchmaking,
accounts. Input latency will be roughly RTT plus up to one snapshot interval; this must be visible in
the UI so nobody mistakes it for a bug.

### 3.3 Bot client
`npm run bot -- --url=ws://HOST:PORT --players=P2,P3,P4 --pattern=fixture|wander`:
- joins the requested slots, validates that it was granted exactly those slots,
- drives deterministic input (the existing fixture schedule for reproducibility, or a simple wander
  pattern for human-feeling movement),
- logs per-tick send/receive counters and exits cleanly on match end or disconnect,
- never claims a slot it was not granted and never writes to a manifest it does not own.

### 3.4 Network metrics
Measured **on the client**, recorded as JSON with provenance (command, host role, path: `lan` / `vm` /
`internet`, server and client OS/Node/browser, match seed, ticks):

| Metric | How |
| --- | --- |
| RTT p50/p95/p99 | existing ping/pong, timestamped at the client |
| Snapshot inter-arrival p50/p95/p99, max gap | arrival timestamps per snapshot |
| Input-to-snapshot latency | client send timestamp vs. the first snapshot that reflects it (approximate, documented as such) |
| Bytes up/down per second | counted at the socket |
| Late/denied inputs, disconnect events | existing counters |
| Tick pacing on the server | server-side tick duration histogram |

The manifest must state `path` and must **not** generalise a LAN number to "the internet". Only fields
actually measured are written; everything else stays `NOT_MEASURED`.

### 3.5 Runbook
A short procedure for the owner:
1. Start the server on this machine, bound to the LAN interface; note the port.
2. Open the online page locally and join P1.
3. In the VM, run the bot against `ws://<this-machine-lan-ip>:<port>` with P2–P4.
4. Confirm the match starts and runs 120 s; save the metric files and screenshots.
5. Repeat three times; record the path (`lan`, `vm`, later `internet`).

## 4. Why this matters for the accepted decision

ADR 0001 accepted TCP head-of-line blocking as a known risk **because nothing was measured**. This
harness produces exactly the missing evidence:

- If snapshot gaps and RTT stay small on a real link, the ADR is confirmed and can be closed as
  validated in practice.
- If gaps correlate with loss and produce visible stutter, that is the trigger recorded in the ADR's
  reconsideration criteria, and the response is either client interpolation, WebTransport, or
  architecture B — in that order of cost.

It also gives genuine multi-player testing (one human plus bots, and later several humans) without
waiting for matchmaking infrastructure.

## 5. Non-goals and risks

- **No production security.** `ws://` is unencrypted; there is no authentication or rate limiting.
  Do not expose the port to the open internet. Use LAN, a VPN (Tailscale/ZeroTier) or an SSH tunnel.
  TLS and auth are separate hardening work.
- **No client prediction.** The first version will feel laggy over a WAN; that is expected and must be
  labelled in the UI.
- **Determinism is not affected.** The server remains authoritative; bots send canonical inputs like any
  client and simulation rules do not change.
- **VM cost.** Option A needs no GPU; Option B needs a Chromium-capable image and tolerates screenshot
  flakiness.
- **Measurement honesty.** A single VM on the same LAN is not an internet run. Report the path
  explicitly, keep the raw JSON, and do not turn one lucky run into a claim.

## 6. Suggested order of work

1. `M7-ONLINE-SERVER-MODE` — real-match server role.
2. `M7-BOT-CLIENT` — headless Node players with metrics.
3. `M7-ONLINE-BROWSER-CLIENT` — served page, interpolation, RTT display.
4. `M7-NETWORK-MEASUREMENTS` — metric schema, manifests, first LAN/VM runs.
5. `M7-ONLINE-RUNBOOK` — the owner-facing procedure and evidence checklist.

Each slice is independently testable; the first two already give a real multiplayer session between
this machine's server and the VM, before any rendering work.
