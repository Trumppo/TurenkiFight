# Bots and eight-player matches

**Status:** Design spec, owner-requested 2026-11-02. Not implemented.
**Owner request:** when starting a match and players join, allow choosing to fight one or more bots, so a full
eight-player round can be tested alone against the computer.
**Scope:** local play first; networked bots already exist separately as the `npm run bot` CLI.

## 1. What blocks eight players today

The four-player limit is deliberate and enforced in several layers:

| Layer | Current limit |
| --- | --- |
| `MAX_PLAYERS_PER_FRAME` (input codec) | 4 |
| `MAX_SNAPSHOT_FIGHTERS` / `MAX_EVENT_FIGHTERS` | 4 |
| Session roster / input buffer | max 4 |
| Match server roster | 1–4 |
| Local join logic | P1 plus P2–P4 from gamepads |
| HUD | four slots |

The simulation itself accepts an arbitrary roster (`createState(ids)`), and eight-fighter simulation
scalability was already exercised in earlier tests. So this is a **cap and presentation** problem, not a
simulation rewrite.

## 2. Two slices, deliberately separated

### Slice A — bots inside the current four-player game

- A lobby control per empty slot: **BOT**. Pressing it fills that slot with a computer player.
- Bot inputs are produced by a pure, seeded policy from the current state, so the whole match stays
  deterministic and replayable.
- Policy for this phase: approach the nearest living opponent, attack when in range, occasionally jump;
  seeded variation so bots are not identical. One difficulty level, no learning.
- Bots participate in every mode: respawn in Score Brawl and Deathmatch, eliminated permanently in Last
  Man Standing.
- Bots must not be able to join as P1 in a way that removes the human's control, and the human must be
  able to remove a bot before the match starts.

### Slice B — raise the roster to eight

- Raise the caps to eight **without changing what a four-player match produces**: Score Brawl
  four-player snapshot bytes and pinned fingerprints must stay identical, because the cap only permits
  more fighters; it does not alter encoding for four.
- The snapshot at eight players is roughly twice the size; measure it and record the number rather than
  guessing.
- HUD and lobby must handle eight slots legibly (4×2 grid), and the arena must remain readable with
  eight overlapping fighters — the owner's real question is whether eight is playable, not merely
  supported.
- Bots fill as many slots as needed, so a single human can run eight-player matches.

## 3. Non-goals

- Smart AI, pathfinding, blocking, combos or difficulty levels beyond one.
- Ranked play, matchmaking, persistence of bot results.
- Networked eight-player matches (the server cap can rise in slice B, but proving it over a network is
  a separate measurement task).
- Changing damage, movement or hit rules.

## 4. Acceptance criteria

1. The lobby offers bots for empty slots and the match starts with the chosen mix.
2. A bot match is deterministic: same seed, roster and inputs give identical final state and events.
3. Bots fight, not idle: they move toward opponents and land hits within a bounded time in a test.
4. Bots behave correctly per mode, including LMS elimination.
5. Eight-player local matches run, and the HUD shows all eight slots legibly at 640×360, 1280×720,
   1920×1080 and 390×844.
6. Score Brawl four-player bytes and pinned fingerprints are unchanged.
7. Snapshot size at eight players is measured and recorded.
8. The owner can start an eight-player match alone and judge whether it is playable.

## 4b. Measured results after the cap change (2026-11-02)

One constant, `MAX_PLAYERS = 8` in `src/game/protocol/players.ts`, now drives the input codec, snapshot
and event codecs, session roster and buffer, match server and the WS client. Nine players or more is
rejected at every layer with a clear error.

**Four-player bytes unchanged.** Score Brawl tick-0 snapshot captured from `main@a6a26eb` is 1,086 bytes
(sha256 `1d23bad2…`), 1,088 bytes after 300 ticks, and is pinned as an exact string. BASE-4 replay
fingerprints remain `7fddf007…` / `de544fcd…` / `5bb44bd6…`.

**Eight-player snapshot size, measured not estimated:**

| Measurement | Canonical | Server message |
| --- | ---: | ---: |
| Authoritative session at tick 3 | 2,083 B | 2,126 B |
| Full 7,200-tick BASE-8 replay, mean (2,400 samples) | 2,333.2 B | 2,376.2 B |
| BASE-8 replay, min / max | 2,203 / 2,597 B | 2,246 / 2,640 B |

That is about 46,664 B/s per client of codec bytes and 373,312 B/s for eight clients at 20 Hz — still a
codec measurement, not a network measurement.

**Schema maxima forced two bounds to move.** A schema-valid eight-fighter snapshot is 83,373 bytes
because the snapshot can carry a full event batch, so `MAX_SNAPSHOT_BYTES` rose from 65,536 to 131,072
and the WS server message bound to 132,096. Without that, a valid state would parse but fail to encode.
The eight-player input frame is 3,950 bytes, still inside the unchanged 4,096 cap; the session envelope
cap is untouched because it is client-to-server.

**Benchmark path change, reported explicitly.** With eight slots fitting one frame, `BASE-8-60-20` now
uses one frame per tick instead of two: 7,200 frames instead of 14,400, fixture hash
`6f6eaf7a…` (was `9a07ff61…`), and its final state is now recorded with `state-snapshot-v1` instead of
the harness-local digest (`f4da9054…`). Its ordered-event hash is unchanged (`3d87b8ad…`). BASE-4 values
did not move. The old multi-slice adapter test was replaced by a single-frame eight-player atomicity
test.

**Still four-scoped on purpose:** the match-server default roster is 4 (eight is opt-in with
`--players=8`), the bot CLI drives the BASE-4 fixture, and networked eight-player measurement remains a
separate follow-up.

## 5. Risks

- Eight fighters in a 640×360 arena may be visually unreadable regardless of correctness; that is a
  finding, not a failure to hide.
- Raising a protocol cap touches the accepted contract; it must be a single, reviewed change with
  strict bounds and unchanged four-player output.
- Bots driven from current state can create feedback loops that make a match endless; the timer and
  mode end conditions must still terminate it.
- Determinism must survive bot input generation; the bot policy therefore may not use wall-clock time
  or unseeded randomness.

## 6. Suggested order

1. `M8-BOT-OPPONENT` — local bot policy, lobby wiring, determinism tests (four-player cap).
2. `M8-EIGHT-PLAYER-CAP` — protocol, session and server caps to eight, unchanged four-player bytes.
3. `M8-EIGHT-PLAYER-UI` — eight-slot lobby/HUD and readability at eight.
4. `M8-BOT-QA` — independent determinism, termination and readability QA, plus an owner playtest checklist.
