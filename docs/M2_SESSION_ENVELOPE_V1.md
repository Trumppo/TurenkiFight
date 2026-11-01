# M2 session envelope v1 — approved design contract

**Status:** **APPROVED as the design contract by the project owner on 2026-11-01**, for implementation as a transport-neutral layer. Not implemented yet and **not a transport selection**. Baseline: `main` after #41, #43 and #79. Preserve the existing `src/game/protocol/inputFrame.ts` canonical InputFrame; do not add a competing simulation codec.

**Owner decisions recorded 2026-11-01:**
1. **Slot ownership:** one connection **may own multiple player slots** (shared local controllers in one browser). Ownership always comes from trusted adapter context.
2. **Duplicate input for one tick:** **first valid frame wins**; later duplicates for the same player/tick are rejected without mutating accepted input.
3. **Late input:** **rejected**; the tick consumes neutral input for missing players. No retroactive application.
4. **Reconnect:** a reconnect is a **fresh join** with new authorization. No implicit ownership recovery and no reconnect token in v1.
5. **Tick/sequence exhaustion:** reject and require session reset; never wrap silently.

These decisions approve the contract only. Transport choice (WebSocket vs WebRTC), authentication provider, encryption and production deployment remain separate gates.

## Trust boundary
The transport adapter supplies a **trusted** `connectionId` from connection state, never from client JSON. Session manager resolves `connectionId -> playerId(s)` via `SessionRoster`. Client-supplied `playerId` is an *assertion to verify*, not authority. No client may choose host status, room ID or authoritative tick.

## Envelope shape
Define a separate transport-level envelope with a `version: 1`, `kind`, `sequence` and `targetTick` where applicable. Room/session ID is bound to the trusted connection context; a client-provided room identifier, if present for diagnostics, must match the bound room. Payload for gameplay is the existing canonical v1 InputFrame representation after validation. A transport adapter decodes bytes, enforces a pre-parse limit, checks kind/version, and forwards trusted connection context plus validated payload to `AuthorizedSessionIngress`.

Suggested client kinds: `join-request`, `leave-request`, `input`, `ping`. Suggested server kinds: `join-result`, `roster`, `match-start`, `snapshot`, `events`, `error`, `pong`. These names are **not yet a frozen wire schema**. Keep authority/control messages separate from simulation frames.

## State machine and transitions
- `LOBBY`: first successful join is host; other connections may claim available local slots only after server approval; host-only explicit start, no ready state in M1.
- `STARTING`: freeze roster for countdown, establish initial tick and deterministic seed; reject premature gameplay frames.
- `RUNNING`: accept only owned player input with valid sequence/tick bounds; missing input is neutral at consumption; never replay a submitted action twice.
- `RESULTS`: match clock ends at exactly 7,200 active ticks; accept no new combat actions; host may initiate a new match after reset.
- `CLOSED`: revoke ownership, queued frames, sequence state and room resources.

Host disconnect: do not silently transfer host authority. Until explicit host-migration design exists, terminate or return to lobby with a documented host-lost result. Reconnect must not automatically recover revoked ownership without a fresh, server-validated capability.

## Input acceptance order
1. Check raw byte length and per-connection rate quota **before** parsing.
2. Parse strict versioned envelope; reject unknown kinds, duplicate fields if decoder supports detection, invalid number ranges and extra fields.
3. Resolve authenticated/bound connection and room, reject cross-room messages.
4. Resolve player slot ownership via roster; reject spoofed or unassigned IDs.
5. Validate monotonically increasing per-connection sequence and bounded `targetTick`; reject stale, far-future and duplicate frames.
6. Decode canonical InputFrame and ensure its player list exactly matches the authorized slots for this message.
7. Submit to deterministic session buffer; first-valid frame wins. Consume once at each authoritative 60 Hz tick.
8. Emit snapshot/events with authoritative tick and stable ordering; client input never overrides authoritative score/state.

## Decisions settled before implementation (2026-11-01)

- **Multiple local players per connection:** approved. One envelope may carry inputs for every slot owned by that connection; ownership is verified against trusted roster context.
- **Duplicate submissions:** first valid frame for a player/tick wins; later duplicates are rejected without side effects.
- **Late input:** rejected; missing players use neutral input at tick consumption.
- **Reconnect:** fresh join with fresh authorization; no implicit token-based recovery in v1.
- **Tick overflow and sequence exhaustion:** reject and require session reset; never wrap silently.

## Still open, to be defined from evidence

- Numeric byte and rate quotas, derived from codec limits and measured benchmarks rather than arbitrary thresholds.
- JSON duplicate-key rejection: `JSON.parse` accepts duplicates; a strict decoder or canonical byte-level check is required only if this becomes a security guarantee.
- Pre-parse byte quotas, parse-time budget, per-room queue size and maximum room count must be bounded independently.

## Required independent tests
| Case | Expected outcome |
| --- | --- |
| Valid owned player input | accepted exactly once on target tick |
| Client claims another player or host | denied without state mutation |
| Input from connection bound to another room | denied |
| Same sequence or target tick replay | denied; first valid frame wins for that player/tick |
| Late input | rejected; neutral input used at consumption |
| Unknown version, kind or extra fields | denied |
| Oversized packet / input flood | rejected before unbounded allocation |
| Disconnect then stale input | denied; queue and sequence revoked |
| Rejoin without fresh authorization | denied; reconnect is a new join |
| Four-player 7,200-tick scripted match | deterministic identical state and event fingerprints |
| Host leaves during countdown or match | explicit documented transition, no accidental host migration |
| Same canonical inputs over WS and WebRTC adapters | identical simulation results, transport-independent |

## Implementation slices and owners
1. **Designer:** contract approved 2026-11-01 (ownership, duplicates, late input, reconnect, exhaustion); quotas still to be derived from measurements.
2. **Gameplay:** transport-neutral decoder and adapter interface in a separate PR, with trusted identity injected by the adapter. No sockets in this slice.
3. **Tester:** adversarial negative cases, fuzz corpus, cross-room and replay checks; report exact SHA.
4. **Graphics:** no protocol file ownership.

**Release gate:** green unit/build/browser CI + independent Tester report + owner merge approval. This contract does not claim authentication, online multiplayer or a topology decision.
