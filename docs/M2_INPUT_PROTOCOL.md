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

A complete snapshot has the shape `{"version":1,"state":{...}}` where `state` is the current simulation `GameState`, including fighters, tick counters and the event list emitted for that state tick (not a historical log). The codec validates finite coordinates, z >= 0, health as an integer in 0..100, phase/timer ranges, coherent attackMove/attackFrames pairs, distinct roster IDs, bounded hit-target/button arrays and strict event payloads. A decoded snapshot can seed deterministic stepping and replay. The protocol advancing APIs validate each resulting state and fail closed if it cannot be re-encoded; terminal tick/counter boundary snapshots are accepted for inspection but cannot be advanced. The format is intended for correctness testing, not yet a compact bandwidth-optimized network packet. The snapshot parser caps the roster at four fighters, the event list at 64 current-tick events, and each hitTargets list at four unique opponent IDs (no self ID). previousButtons is limited to four unique simulator labels: punch, kick, jumpkick and jump. A diagnostic FNV-1a 32-bit fingerprint and byte limits are implemented in `fingerprint.ts`. This checksum is not collision-resistant or suitable for security. Transport authentication, tick authority and schema migration are not implemented.

## EventBatch v1

`eventBatch.ts` defines `{version:1,tick,events}` for existing simulation events: `HitLanded` requires attacker, target and move; `Knockout` requires attacker and target but no move; `Respawned` requires target; `MatchStarted` and `MatchEnded` carry no player fields. All event ticks must match the batch tick. The shared strict parser enforces type-specific required/forbidden fields and can optionally validate participants against a host-supplied roster. The roster is not part of the wire payload; a host that needs membership validation must call parseEventBatch(batch, roster) before encoding, because encodeEventBatch alone validates schema but not session membership. At most 21 events are accepted per batch (conservative four-player upper bound: 12 directed hits, 4 knockouts, 4 respawns, one lifecycle event). The 8192-byte UTF-8 cap applies before decode and after encode; schema-maximal escaped IDs can exceed it, so the cap is binding. Event order is preserved because it is significant to replay diagnostics.

## Deterministic replay verification

`replay.ts` provides `verifyReplay()` over a starting StateSnapshot, consecutive InputFrames and expected FNV-1a checkpoints. It checks input ticks, validates wire frames, verifies every post-step state can be encoded, and raises an error at the first mismatching checkpoint. Checkpoints are diagnostic only: this is not a cryptographic integrity or authentication mechanism. Replay verification is bounded to 7200 frames and 7201 checkpoints per record to prevent unbounded synchronous work. A network authority and session handshake are not yet implemented.

## Scope and next work

This is an independent first slice of issue #24. EventBatch v1 now defines the standalone event-message schema; future M2 work should integrate it into authoritative sessions and define tick ownership, replay framing, session identity and ingress authorization. Both `decodeInputFrame()` and `decodeStateSnapshot()` reject oversized UTF-8 payloads before JSON parsing and encoders enforce the same caps. Schema-max sizes after tighter state validation, measured with wide escaped IDs: InputFrame 2,000 B (<4,096 B cap), StateSnapshot 62,985 B (<65,536 B cap), and EventBatch 18,045 B at 21 events (>8,192 B cap). InputFrame and snapshot caps are defensive bounds not reached by schema-valid v1 messages; the EventBatch byte cap remains binding. Keep the size-characterization tests as guards if schema limits expand. `assertWireSize()` remains available for other boundaries. Current limits are 4096 bytes per input frame and 65536 bytes per snapshot. The present codec does not claim to solve these concerns.

## Remaining validation boundary

Snapshots require finite coordinates and z >= 0, but no physical upper bound is imposed on z/vz because jump impulse and gravity are private simulation constants. A finite extreme pair can still produce a non-finite step result; stepBuffered and verifyReplay re-encode each step and fail closed, and stepBuffered preserves its staged frame on failure.

Owner-approved scope for this M2 v1 slice: retain finite-only z/vz validation and fail-closed advancement; do not duplicate jump physics in the protocol. Before authoritative online snapshot/restore is used, scope a separate Gameplay task to expose jump impulse/gravity or a derived apex and validate a physical range. This scope decision does not claim extreme finite states are physically reachable or trusted.

## Verification

Run `npm test`, `npm run build` and browser CI. See `src/game/protocol/inputFrame.test.ts` for round-trip, rejection and deterministic ordering tests.

Local verification on revision/m2-protocol-hardening, updated with current main c0ae871: protocol suite 60 tests across 10 files; full unit suite 106 tests across 19 files; npm run build passed with the existing >500 kB chunk warning; manual git diff --check and an untracked-file whitespace scan passed; full Playwright browser suite had 28 tests, 23 passed and 5 retro-only tests skipped in classic mode. A finite but extreme z/vz state is accepted for inspection, while its non-finite stepped result is rejected before the buffer consumes input. These are local results, not GitHub Actions CI for an updated PR #25 head.

InputFrame v1 currently caps each tick at four player inputs, matching the M1 local roster. Larger rooms require an explicit protocol revision or negotiated limit.

StateSnapshot serialization recursively sorts object keys while preserving array order, ensuring equivalent snapshots produce identical diagnostic fingerprints regardless of object property insertion order.

## Tick input staging (M2 groundwork)

`InputFrameBuffer` accepts bounded, out-of-order future InputFrames, rejects duplicates, stale ticks and unknown players, and produces a complete roster with neutral input for missing players. `peek()` does not advance; `consume()` advances exactly one tick. This is a transport-neutral staging primitive, **not** a network transport or multiplayer synchronization guarantee. The neutral-on-missing policy is a provisional local test behavior and must be revisited for authoritative online matches.

`stepBuffered(state, buffer)` connects staged inputs to the simulation; it requires the buffer roster to match the state roster and verifies each step result is encodable before consuming the frame. Tick, roster or output-validation failures preserve the pending frame. A 90-tick integration test compares out-of-order staged inputs against direct deterministic simulation at every tick. This does not yet implement rollback, latency compensation or network synchronization.

`restoreBufferedSimulation(snapshot)` validates and deep-clones the saved state, then constructs a fresh input buffer starting at the saved tick. Pending inputs are intentionally discarded. A continuation regression compares 60 subsequent ticks against direct simulation. This is snapshot restoration groundwork, not a network rollback implementation.
