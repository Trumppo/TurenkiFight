# ADR 0002: Carrying match mode in snapshots and events

- **Status:** Proposed. Implementation is `M7-MODE-ONLINE`.
- **Date:** 2026-11-02
- **Related:** [ADR 0001](0001-network-topology.md), [game modes spec](../M7_GAME_MODES.md), `src/game/protocol/stateSnapshot.ts`, `src/game/protocol/inputFrame.ts`.

## Context

The deterministic simulation now supports three modes (`score-brawl`, `last-man-standing`,
`deathmatch`). Mode-specific state exists only in the simulation: `eliminated` for Last Man Standing,
`frags`/`deaths` for Deathmatch, plus a typed `MatchEnded` reason and winner.

The v1 `StateSnapshot` codec is strict: unknown fields are rejected, and there is no mode field. As a
result, an online client cannot display stocks or frags, and the authoritative server can only play
Score Brawl. Tester confirmed this explicitly: `encodeStateSnapshot` rejects a mode state as
"Malformed simulation state".

We must decide how mode data reaches the wire without breaking what already works, above all the
pinned Score Brawl fingerprints used by benchmarks and regression tests.

## Decision

**Extend protocol v1 with optional, canonically-omitted mode fields. Do not bump the version.**

- `StateSnapshot` gains optional `mode?: 'last-man-standing' | 'deathmatch'` and, per fighter, optional
  `eliminated?: true`, `frags?: number`, `deaths?: number`, `damageDealt?: number`.

  `damageDealt` was added during implementation: the simulation already carries it in mode state and the
  pinned mode hashes include it, so leaving it off the wire would make the snapshot an incomplete
  deterministic state while strict unknown-field rejection would refuse to encode mode states at all.
- The canonical encoder **omits** every optional field that is absent. For Score Brawl no optional
  field is present, so the encoded bytes are identical to today's v1 output. The pinned fingerprints
  (`de544fcd…`, `5bb44bd6…`) must remain byte-identical and are the regression gate for this decision.
- The strict decoder accepts the new fields only when well formed, rejects them when inconsistent
  (for example `mode` absent while `frags` is present, or `eliminated` on a living fighter), and
  continues to reject unknown fields.
- `MatchEnded` events gain optional `reason` and `winner`, omitted for Score Brawl so its event stream
  stays exactly `{ tick, type }`.
- The match server takes a mode flag, creates the session with those rules, and reports the mode in
  its ready line. Unknown modes fail at startup with a clear message.

## Why not bump to v2

A version bump would force every client, bot, benchmark fixture and pinned hash to change for a
feature that only appears when a non-default mode is selected. Optional fields keep one wire format,
keep Score Brawl byte-identical, and let old clients keep working for Score Brawl. The cost is a
stricter validator, which we want anyway.

## Canonical projection details (added during implementation)

- **`eliminated: false` normalises to absence.** The simulation stores `eliminated: false` for living
  fighters in Last Man Standing. Changing that would alter pinned mode hashes, so the encoder drops the
  field instead, and the strict decoder rejects an explicit `false`. Consequence: for Last Man Standing,
  `decode(encode(rawState))` is semantically identical to the raw state but not deeply equal (absent
  versus `false`). This is a deliberate canonical projection and must stay covered by a test.
- **`score-brawl` is never encoded explicitly.** The decoder rejects an explicit `"mode":"score-brawl"`
  as non-canonical; the default mode is represented by absence.
- **Ready line always carries `mode`,** including `score-brawl`, so operators can see the mode without
  guessing. Consumers asserting an exact key set must accept the key.
- **Per-mode field requirements are strict:** `frags`/`deaths` only with `deathmatch` and both
  required; `eliminated` only with `last-man-standing` and only `true`; `damageDealt` only in the two
  non-default modes; Last Man Standing enforces `(health === 0) === eliminated`.

## Consequences

- Bots can keep using the current client core; they do not need mode fields to play, only to report.
- The online client can display the mode and its counters without a second snapshot format.
- Benchmark manifests for Score Brawl remain comparable with earlier runs.
- Every new optional field needs a canonical-encoding test and a rejection test, otherwise the
  "unknown fields rejected" guarantee silently erodes.
- If a future mode needs per-fighter data that is not a small scalar, this decision should be revisited
  with an explicit v2 rather than stretching the optional set.

## Acceptance gate

1. Score Brawl snapshot bytes and pinned fingerprints unchanged.
2. Mode snapshots round-trip canonically and reject malformed combinations.
3. A server started with `--mode=deathmatch` plays Deathmatch, and the client shows frags/deaths from
   snapshots rather than computing them.
4. A server started with an unknown mode fails clearly and does not fall back silently.
5. No simulation rule changes; the mode is chosen at match creation and carried, not decided by the
   client.

## Reconsideration

Reopen if the optional set grows beyond a few scalars, if a mode needs nested per-fighter data, or if
a second transport requires a different framing that makes optional fields ambiguous.
