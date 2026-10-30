# M2 InputFrame v1 — transport-neutral contract

The first M2 slice adds strict input and state snapshot codecs. The input codec is in `src/game/protocol/inputFrame.ts`. It does not alter `PlayerInput`, the simulation, game rules, renderer, or network architecture.

## Wire shape

```json
{"version":1,"tick":42,"inputs":[{"playerId":"P1","moveX":0,"moveY":0,"jump":false,"punch":true}]}
```

- `version`: exactly `1`. Future versions must be handled explicitly, not silently coerced.
- `tick`: nonnegative safe integer. The session owner must check tick progression, freshness, and authorization; this codec only validates shape.
- `inputs`: zero or more distinct players, sorted by player ID for canonical JSON encoding. `PlayerInput` remains the existing simulation input type.
- Missing player inputs are neutral for that tick. `neutralPlayerInput(id)` is available for explicit disconnect handling. Reconnection and join authorization belong to the future room/session layer.
- `encodeInputFrame` and `decodeInputFrame` validate every message; unknown fields, duplicate IDs, malformed controls, and unsupported versions fail closed.
- Canonical encoding does not provide cryptographic authentication or replay protection. No transport has been selected.

## StateSnapshot v1

A complete snapshot has the shape `{"version":1,"state":{...}}` where `state` is the current simulation `GameState`, including fighters, tick counters and event list. The codec validates finite numeric coordinates, legal phase and move enums, distinct player IDs, nonnegative integer timers, event ticks and supported version. A decoded snapshot can be fed directly to `step()` to resume deterministic replay. The format is intended for correctness testing, not yet a compact bandwidth-optimized network packet. A diagnostic FNV-1a 32-bit fingerprint and byte limits are implemented in `fingerprint.ts`. This checksum is not collision-resistant or suitable for security. Transport authentication, tick authority and schema migration are not implemented.

## EventBatch v1

`eventBatch.ts` defines `{version:1,tick,events}` for existing simulation events: `HitLanded` requires attacker, target and move; `Knockout` requires attacker and target but no move; `Respawned` requires target; `MatchStarted` and `MatchEnded` carry no player fields. All event ticks must match the batch tick. The codec enforces an 8192-byte UTF-8 limit before decoding and after encoding. Event order is preserved because it is significant to replay diagnostics.

## Deterministic replay verification

`replay.ts` provides `verifyReplay()` over a starting StateSnapshot, consecutive InputFrames and expected FNV-1a checkpoints. It checks input ticks, validates wire frames, and raises an error at the first mismatching checkpoint. Checkpoints are diagnostic only: this is not a cryptographic integrity or authentication mechanism. Replay verification is bounded to 7200 frames and 7201 checkpoints per record to prevent unbounded synchronous work. A network authority and session handshake are not yet implemented.

## Scope and next work

This is an independent first slice of issue #24. Future M2 work should define a standalone game-event wire schema, authoritative tick ownership, replay checksum framing, session identity and session-level ingress controls. Both `decodeInputFrame()` and `decodeStateSnapshot()` now reject oversized UTF-8 payloads before JSON parsing; corresponding encoders enforce the same limits. `assertWireSize()` remains available for other boundaries. Current limits are 4096 bytes per input frame and 65536 bytes per snapshot. The present codec does not claim to solve these concerns.

## Verification

Run `npm test`, `npm run build` and browser CI. See `src/game/protocol/inputFrame.test.ts` for round-trip, rejection and deterministic ordering tests.

InputFrame v1 currently caps each tick at four player inputs, matching the M1 local roster. Larger rooms require an explicit protocol revision or negotiated limit.
