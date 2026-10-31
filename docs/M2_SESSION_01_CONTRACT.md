# M2-SESSION-01 — Session authority and ingress contract

**Status:** DESIGN PROPOSAL, not implemented. No WebSocket/WebRTC selection. Baseline: M2 transport-neutral InputFrame v1 on `feature/m2-input-frame-contract`, pending integration; see `docs/M2_INTEGRATION_GATE.md`.

## Goal
Introduce an explicit trust boundary between untrusted network packets and deterministic `step()`. Preserve the existing versioned `InputFrame {version:1,tick,inputs[]}` as the simulation-facing format. The session layer validates sender identity, tick freshness, player ownership and bounded buffering **before** it constructs an InputFrame. Do not change simulation rules, attack timing, rendering or local keyboard controls.

## Proposed responsibilities
- **Transport adapter** (WS or WebRTC, not chosen): carries bytes and an authenticated connection context. Never trusts a playerId claimed by a packet.
- **Session authority**: allocates opaque session and connection IDs, maintains a roster mapping connection -> permitted player IDs, enforces host-only start and room state, and decides authoritative tick.
- **Ingress gate**: validates envelope version, payload size, connection authorization, monotonic sequence and bounded tick window; rejects invalid packets without mutating game state.
- **Tick assembler**: emits one canonical InputFrame per authoritative tick. Inputs absent at deadline become neutral; duplicate player submissions for a tick are resolved by an explicit first-valid or latest-valid policy (select and test before implementation).
- **Simulation**: consumes validated canonical frames only. Snapshots and event batches are outbound projections; clients cannot submit authoritative state.

## Proposed network ingress envelope (distinct from InputFrame v1)
```json
{
  "envelopeVersion": 1,
  "sessionId": "<opaque session identifier>",
  "sequence": 17,
  "targetTick": 42,
  "controls": {
    "moveX": 0,
    "moveY": 0,
    "jump": false,
    "punch": true
  }
}
```
This is a **design example**, not an approved codec. The connection context determines the allowed playerId. Multi-player-per-connection handling needs an explicit authorized slot field and roster check; do not assume a single device always owns one player. The envelope's `sequence` is per connection, not the simulation tick. Never use sessionId alone as authentication. Do not put untrusted client-provided `playerId` directly into authoritative InputFrames.

## Invariants / acceptance tests
1. Unauthorized connection cannot submit controls for another player's slot; stale/disconnected connection cannot reuse a prior assignment.
2. Duplicate, out-of-order and replayed sequence values cannot create additional simulation steps. Wraparound and reconnect policy is explicit; start with bounded safe integers.
3. Inputs for already-committed ticks and far-future ticks are rejected. Exact accepted lead/lag window and queue capacity are configurable and tested; no unbounded buffers.
4. Every authoritative tick advances exactly once; absent inputs neutralized. Deterministic input ordering independent of packet arrival order once the chosen duplicate policy is applied.
5. Session join/start/leave are separate control-plane operations; only host may start; reconnect needs new authorization and predictable neutral-input behavior.
6. Malformed JSON, oversized payloads, unknown versions/fields, NaN/nonfinite controls, roster overflow and invalid IDs fail closed before reaching simulation.
7. Server does not accept client-authored StateSnapshot/EventBatch as authoritative; diagnostic fingerprints are not authentication.
8. Verify deterministic replay under scripted packet reorder/loss/disconnect, including 4-player 120 s match; no Phaser dependency.
9. Browser local play and retro/classic graphics remain unchanged. Existing M1 and M2 tests must pass on the exact commit SHA.

## Threat and failure cases to test
- Spoofed playerId, stolen sessionId, old socket after reconnect, cross-room replay, rapid reconnect spam.
- Duplicate submissions, intentional tick flooding, large future-tick jumps, slow clients, message-size exhaustion.
- Host departure and authority handoff: **out of scope** until a deterministic policy is approved; never silently migrate authority.
- Sequence number rollover and state resynchronization: document as unsupported until designed.
- Session authorization is distinct from cryptographic authentication; transport security and identity provider are separate deployment decisions.

## Staged engineering tasks
**SESSION-01A:** pure TypeScript session roster/authority interfaces and negative tests; no transport, no renderer, no simulation edits.
**SESSION-01B:** bounded tick ingress and canonical frame assembler with loss/reorder/replay tests.
**SESSION-01C:** adapters for benchmark A/B using the same envelope and simulation; evaluate topology separately.

## Agent instructions
Gameplay: fetch latest remote main, PR #25, CI, and `docs/M2_INTEGRATION_GATE.md` before coding. First report compatibility of current M2 branch with this proposal. Do not implement SESSION-01A until the M2 base is integrated or a reviewed branch strategy avoids duplicate/conflicting codecs.
Tester: fetch latest remote state and independently review spoofing, replay, queue bounds, deterministic stepping and protocol schema tests; record exact SHA and results.
Designer: obtain owner acceptance for session ownership model and duplicate/tick policies before implementation. Keep WS/WebRTC undecided.
