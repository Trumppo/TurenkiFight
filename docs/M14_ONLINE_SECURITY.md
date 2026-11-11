# M14: eight-player online productisation

**Status:** Design spec, 2026-11-06. Part of the active long-term goal. Measurement is owner-blocked; the code below
is implementable without it.
**Related:** [LONG_TERM_PLAN.md](LONG_TERM_PLAN.md) M14, [ADR 0001](adr/0001-network-topology.md).
**Operator instructions:** see [Gate F hosting guide](GATE_F_HOSTING_GUIDE.md) for LAN/VPN and TLS/WSS internet setup.

## 1. What exists

An authoritative WebSocket prototype: `serve:match` hosts one match (opt-in rematch), the session envelope validates
input, snapshots are sent at 10/20/30 Hz, and an online browser client renders them. The M14 hardening slices add TLS,
room codes, a per-room connection cap, per-connection rate/size limits and a mid-match rejoin window (see §5–§8).
There is still no authentication.

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

## 6. Implemented in `M14-RATE-LIMITS`

This second hardening slice implements §2.3 (the per-room cap already landed in §5) and closes the Tester's finding
that a peer rejected for a wrong room code kept its socket open.

The limits are **policy constants, not measurements**. No bandwidth, RTT, jitter or server-cost number is added or
implied by this slice; every network figure remains `NOT_MEASURED` and the two-machine measurement stays owner-blocked.

Exported from `server/ws/clientMessageLimits.ts`:

- `MAX_CLIENT_MESSAGE_BYTES = 5120` (reuses `MAX_SESSION_ENVELOPE_BYTES`, the envelope codec cap). A larger message is
  closed with WebSocket code **1009** and the reason `client message exceeds 5120 bytes`. The transport's hard payload
  bound is one KiB above the policy so the server, not the library, supplies the reason; anything above that is still
  closed with 1009.
- `MAX_CLIENT_MESSAGES_PER_WINDOW = 240` over `CLIENT_MESSAGE_WINDOW_MS = 1000` (sliding window). An honest browser
  client sends one input frame per 60 Hz tick plus an occasional ping, so the default leaves roughly four times the
  steady-state cadence. Exceeding the window closes with WebSocket code **1013** and the reason
  `client message rate exceeds 240 per 1000 ms`.
- `MAX_CLIENT_VALIDATION_FAILURES = 5` consecutive protocol/authorization denials (malformed or non-canonical
  envelopes, replayed sequences, unauthorized or unknown player claims, ...) close with WebSocket code **1008** and the
  reason `too many consecutive invalid client messages (5)`. Timing-only denials (`late-tick`, `future-tick`,
  `tick-out-of-window`) and normal lifecycle/capacity refusals do not count, so a stalled honest client is not
  disconnected. Any accepted message resets the counter.
- A room-code rejection (`room-code-required` or `room-code-mismatch`) closes the socket at once with code **1008** and
  the reason `room code rejected (<code>)`.

Behaviour:

- The guard runs before the session parses a message: size is checked first, then the rate window. Both are counted
  per trusted connection, never per payload field.
- Closing a peer removes it from the transport map and calls `room.disconnect` before the close handshake finishes, so
  the room slot and the room connection margin are freed immediately. A subsequent correct join is admitted even at a
  zero margin.
- The per-room cap from §5 is unchanged (roster plus `DEFAULT_MATCH_CONNECTION_MARGIN = 2`), and `serve:match` still
  prints it.
- The ready line now also prints `maxMessageBytes`, `messageRateWindowMs`, `maxMessagesPerWindow` and
  `maxValidationFailures`. Without these limits (the synthetic benchmark harness calls `startWsServer` directly) the
  historical behaviour is unchanged, which keeps fixture bursts deterministic.
- `serve:match --help` documents the fixed policy.

## 7. Out of scope

- Accounts, matchmaking, persistence, leaderboards.
- Multiple rooms per process, horizontal scaling.
- Host migration and peer authority (architecture B stays an evaluated alternative).

## 8. Implemented in `M14-REJOIN`

This third hardening slice implements §2.4. It changes no simulation rule, adds no network measurement and does not
introduce authentication or host migration.

- **Window.** A non-host player who drops while the session is `running` keeps their player id reserved for
  `DEFAULT_REJOIN_WINDOW_MS = 30_000` ms. `startMatchServer({ rejoinWindowMs })` configures it; `0` restores the
  historical immediate revocation, and `MAX_REJOIN_WINDOW_MS = 600_000` bounds a misconfiguration. The ready line
  reports `rejoinWindowMs`.
- **Reservation.** During the window the slot stays claimed (`playerCount` and the `roster` message are unchanged),
  the connection is no longer trusted and the fighter receives neutral input. The other players keep playing. Queued
  input for the reserved slot and the dropped connection's sequence domain are revoked immediately.
- **Rejoin.** A new connection with the same room code and player id may claim the complete reserved slot set. The
  join is reattached by `join-request` and confirmed with `join-result`, followed by a targeted `match-start` and an
  immediate `snapshot`; subsequent snapshots follow the ordinary 10/20/30 Hz broadcast. The slot is transferred, so
  there is one fighter and one roster entry, never a duplicate.
- **Fresh sequence domain.** The rejoining connection starts its own monotonic sequence counter. The old connection is
  absent from the trusted connection set, so its late frames are ignored; its sequence domain is deleted, so a rejoin
  cannot resurrect the old counter with a small sequence number.
- **Expiry.** `expireReservations()` runs from the tick/message/connection paths and from a transport expiry timer. After
  the window the roster drops the player (`roster`), the match continues, and the id follows the ordinary admission
  path: a `running` match denies a late join with `match-started`. Closing the session still releases every slot and
  emits `session-closed` as before.
- **Limits.** Rejoin uses the same `join-request` code path: a missing or wrong room code is denied with
  `room-code-required` / `room-code-mismatch`, and the new connection gets its own `ClientMessageGuard`. A policy close
  (`1008`, `1009`, `1013`) passes `reserve: false`, so an abusive peer never leaves a recoverable slot.
- **Host.** A host disconnect still terminates the session with `session-closed: host-lost`; the host slot is never
  reserved, because rejoin is not host migration.

Honest limitations: the room code plus player id is the whole identity. There is no account, token or cryptographic
proof, so any peer that knows both values can reclaim a reserved slot. This slice adds no bandwidth, RTT, jitter or
server-cost number; every network figure remains `NOT_MEASURED` and the two-machine measurement stays owner-blocked.
