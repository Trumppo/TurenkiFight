# M2 integration gate and protocol contract reconciliation

**Designer review date:** 2026-10-31
**Status:** proposed integration checklist; not an authorization to merge PR #25 or select network transport.

## Verified baseline
- Main at review: `485b4c917855601428fdf5cb47f1206f64410c40` (planning PR #29).
- `feature/m2-input-frame-contract` compared against main: 56 commits ahead, one behind, status diverged. This means the branch contains additional work; it does **not** prove PR #25 has the same head or passing checks.
- Main roadmap states the WebSocket vs WebRTC decision remains open.
- Graphics VIS-02A proceeds separately and must not edit protocol files.

## Design conflict: benchmark proposal vs implemented v1 wire contract
`docs/NETWORK_BENCHMARK_PLAN.md` originally proposes an input envelope of:
`InputFrame {version, playerId, seq, tick, buttons, axisX, axisY}`.

The implemented `docs/M2_INPUT_PROTOCOL.md` on the M2 branch documents:
`{version:1,tick,inputs:[{playerId,moveX,moveY,jump,punch,...}]}`
with multiple canonical sorted player inputs per frame and strict decoding.

These are **not wire-compatible**. Do not quietly adapt the codec to match the earlier illustrative benchmark shape or maintain two unrelated definitions under the same name. For M2 v1, propose treating the existing tested transport-neutral codec as the canonical simulation-boundary payload. Network-specific sequence numbers, sender identity, authorization and per-client delivery framing belong to a separate versioned session/transport envelope to be designed and tested later. This is a design proposal pending owner review, not a network implementation decision.

## Acceptance gate before PR #25 merge
1. Fetch latest remote state, inspect `gh pr view 25 --json state,isDraft,headRefName,headRefOid,baseRefName,mergeable,statusCheckRollup` and `gh pr checks 25`. Verify actual head and whether local changes remain unpushed.
2. Reconcile main divergence on an isolated worktree. Preserve the reviewed history; do not force-push or discard local changes. Re-run checks on the final candidate SHA, not a previous green SHA.
3. Independently review strict decoding, canonical encoding, byte limits, event ordering, state snapshot validation, replay checkpoint boundaries and rejection of malformed payloads.
4. Check tick authority, sender/roster authorization and replay protection are **explicitly not implemented**. Do not advertise the v1 codecs as a secure online session protocol.
5. Inspect edge cases documented in `docs/M2_INPUT_PROTOCOL.md`: EventBatch 8192-byte cap can reject schema-valid maximal messages; snapshots validate finite z/vz without physical bounds and fail closed on invalid advancement. Decide whether these are documented limits acceptable for a transport-neutral first slice; do not silently weaken validation.
6. Run exact project unit/protocol tests, production build, browser smoke and deterministic regression tests on candidate SHA; check relevant Actions workflows and provide links and logs. Distinguish local test results from remote CI.
7. Tester independently records PASS / PASS WITH LIMITATIONS / FAIL with tested SHA, reproducible defects, remaining risks and recommendation.
8. Only after explicit owner approval and passing required checks should the reviewed PR be merged. This planning PR grants no merge permission.

## Follow-on implementation slices (not yet authorized)
- M2-SESSION-01: versioned session envelope and ownership model (session ID, client ID, player ID, tick/sequence, authority checks, disconnect neutrality) without choosing WS or WebRTC.
- M2-SESSION-02: deterministic host-side input buffering, bounded reorder/late-frame policy and scripted replay of disconnect/reconnect; test against existing codec.
- M2-BENCH-01: revise benchmark protocol examples to use the actual versioned contract and explicit transport envelope. Define identical payload/rates for both network alternatives, measure bytes per input/snapshot/event and CPU before selecting a topology.
- M2-NET-A/B: only then build fair WebSocket server and WebRTC browser-host prototypes.

## Commands for the next Gameplay agent
```text
Read the latest GitHub state FIRST: fetch origin/main and feature/m2-input-frame-contract; inspect actual PR #25 metadata, latest Actions and docs/M2_INTEGRATION_GATE.md. Compare docs/NETWORK_BENCHMARK_PLAN.md with docs/M2_INPUT_PROTOCOL.md. Do not invent a second InputFrame format. Audit the integration checklist and report precise gaps, current remote SHA, test commands/results and merge blockers. Make no network transport choice, force-push or merge.
```

## Commands for Tester
```text
Read the latest GitHub state FIRST, including PR #25 head, CI, main and docs/M2_INTEGRATION_GATE.md. Independently test the exact candidate SHA and the negative cases for malformed/oversized frames, tick ordering, duplicate IDs, event ordering, snapshot validation and replay determinism. Report reproducible evidence, not old CI status. No merge.
```
