# M14: eight-player online productisation

**Status:** Design spec, 2026-11-06. Part of the active long-term goal. Measurement is owner-blocked; the code below
is implementable without it.
**Related:** [LONG_TERM_PLAN.md](LONG_TERM_PLAN.md) M14, [ADR 0001](adr/0001-network-topology.md).

## 1. What exists

An authoritative WebSocket prototype: `serve:match` hosts one match (opt-in rematch), the session envelope validates
input, snapshots are sent at 10/20/30 Hz, and an online browser client renders them. There is **no TLS, no
authentication, no rate limiting, no room concept and no rejoin**.

## 2. What this phase adds, in order

### 2.1 TLS (`wss`)

- `serve:match` accepts `--cert <pem> --key <pem>` and then serves `https`/`wss` instead of plain `ws`.
- Without the flags it stays `ws://` and prints the same ready line, so LAN/VPN use is unchanged.
- The client chooses `wss://` when the page is served over `https`, and `ws://` otherwise unless the URL overrides it.
- Certificate management is the operator's job; no self-signed cert is committed.

### 2.2 Room codes

- `serve:match` prints a short room code in its ready line and accepts `--room <code>` to fix it.
- A join must carry the room code; a mismatch is rejected with a typed error before a slot is allocated.
- The online page takes the code from the URL (`?room=ABCD`) or a form field.
- One process still hosts one room; a multi-room server is out of scope.

### 2.3 Rate limiting and connection caps

- Per connection: a maximum message rate and a maximum payload size; exceeding either closes the connection with a
  typed code.
- Per room: a maximum connection count (players plus a small margin for spectators/reconnects).
- The limits are configuration constants with documented defaults, and the numbers are recorded in the ready line so
  an operator can see what is enforced.

### 2.4 Rejoin after a drop

- A disconnected player keeps a rejoin window (for example 30 s) during which the same player id may reconnect and
  resume the same slot.
- A rejoin uses a fresh connection and a fresh sequence domain; the session must not accept stale frames from the old
  connection.
- After the window the slot is released and the match continues without that player.
- Rejoin is not host migration: the server keeps authority.

### 2.5 Eight-player load

- With eight players the snapshot budget, CPU and memory must be measured on one machine and reported as
  single-machine numbers, explicitly not network numbers.
- Readability at eight humans is already a known limitation; this phase does not fix it, it re-measures it.

## 3. Explicitly owner-blocked

- **Two-machine measurement** (bandwidth, RTT, jitter, loss, server load under a real link): agents cannot run it.
  Every network figure stays `NOT_MEASURED` until the owner does.
- **TURN** and browser WebRTC support: not in this phase at all; architecture A is the decision.

## 4. Accept criteria

1. `serve:match --cert --key` serves wss and the browser client connects over it with a valid certificate.
2. A join with a wrong or missing room code is rejected with a typed error and no slot is allocated.
3. Flooding or oversized messages close the connection without crashing the server; the limits are documented.
4. A player can reconnect within the rejoin window and resume the same slot; stale frames from the old connection are
   rejected.
5. Eight-player single-machine numbers are measured and committed with provenance; network numbers remain absent.
6. Existing one-shot and rematch runbooks keep working.

## 5. Implemented in `M14-TLS-ROOMCODES`

This first hardening slice implements only §2.1 and §2.2 plus the per-room connection cap from §2.3.
Rate limits, rejoin and eight-player measurement are not part of it.

- `serve:match` always prints `roomCode` and `maxConnections` in the ready line. Without `--room` the
  code is five characters from an unambiguous alphabet (no `O`, `0`, `I`, `1`); `--room` accepts 4-12
  letters or digits, normalised to uppercase.
- A join must carry the matching `roomCode`. A missing code is denied with `room-code-required` and a
  wrong one with `room-code-mismatch`, both before a player slot is allocated.
- `--cert=<pem>` and `--key=<pem>` must be supplied together. Unreadable, empty or malformed PEM
  material fails before the port is bound. Without both flags the server remains plain `ws://`.
- The room cap is the roster plus `DEFAULT_MATCH_CONNECTION_MARGIN = 2`. A socket beyond the cap is
  closed with WebSocket code 1008 before registration.
- `startMatchServer` keeps the code-less behaviour when `roomCode` is omitted, so existing benchmark
  and harness sessions are unchanged; the CLI always enforces a generated or fixed code.
- The online page defaults to `wss://` when served over https and `ws://` otherwise; an explicit
  `ws://`/`wss://` in the field or URL wins. The room code comes from `?room=CODE` or the form field.
  The headless bot CLI also accepts `--room=CODE` for the same server.
- No network figure is added by this slice. Two-machine measurement remains owner-blocked and every
  network field stays `NOT_MEASURED`.

## 6. Out of scope

- Accounts, matchmaking, persistence, leaderboards.
- Multiple rooms per process, horizontal scaling.
- Host migration and peer authority (architecture B stays an evaluated alternative).
