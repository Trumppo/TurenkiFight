# M2 InputFrame v1 — transport-neutral contract

The first M2 slice adds a strict input codec in `src/game/protocol/inputFrame.ts`. It does not alter `PlayerInput`, the simulation, game rules, renderer, or network architecture.

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

## Scope and next work

This is an independent first slice of issue #24. Future M2 work should define `StateSnapshot`, game-event schema, authoritative tick ownership, replay checksum framing, session identity and bounded message size. The present codec does not claim to solve these concerns.

## Verification

Run `npm test`, `npm run build` and browser CI. See `src/game/protocol/inputFrame.test.ts` for round-trip, rejection and deterministic ordering tests.
