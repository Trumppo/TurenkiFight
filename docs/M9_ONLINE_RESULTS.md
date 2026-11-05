# M9 online results: result fields, rematch and the online result screen

**Status:** Implemented in PR #149 (merged `eeeb084`), independently gated by Tester. Related decision record: [ADR 0003](adr/0003-online-match-result-fields.md).
**Owner choice 2026-11-04:** the next work package is the online results screen plus rematch. This is the largest
remaining product gap: the online client has no result screen, and `serve:match` serves exactly one match per
process.

## 1. What the player sees online

1. When the authoritative match ends, the online page replaces the fight HUD with a result card: the winner (or
   `DRAW`), the end reason, 2nd and 3rd place, and 4th-8th when the roster is larger than three.
2. A visible **REMATCH** button starts a new match on the same server with the same roster. No page reload, no new
   server process, no re-join.
3. While waiting for the rematch, the card says that it is waiting and who is still connected. If a player has left,
   the rematch is refused with a readable reason instead of silently starting a smaller match.
4. The existing local celebration rules hold: no invented winner, a draw is a draw, and place information is not
   colour-only.

## 2. Rule: the client never ranks

Ranking is computed on the server from the authoritative event stream, exactly like the local `rankMatch`, and sent
to clients. The client renders what it receives and never derives an order from fighter order or from the snapshot's
per-tick `events` (which carry only one tick, so Last Man Standing elimination order cannot be reconstructed
client-side).

## 3. Wire shape (proposal, see ADR 0003)

- The existing server message `match-end` gains an optional `result` payload:
  `{ reason, winner: PlayerId | null, ranking: Array<{ id, rank, metric }> }`.
- The payload is canonical only for a finished match; omitting it must remain valid so old clients keep working and
  so no existing snapshot or session bytes change.
- A new client message `rematch` asks the server to start another match with the same roster. It is accepted only
  while the session is in `results` and only when the full original roster is still connected; otherwise the server
  replies with a typed error and stays in `results`.
- Each accepted rematch increments a match identifier that the server echoes in `match-start`, so a late snapshot
  from the previous match cannot be applied to the new one.

## 4. Slice decomposition

| Task | Owner | Content |
| --- | --- | --- |
| `M9-ONLINE-RESULT-FIELDS` | gameplay | Server-side result computation and the `match-end` payload; codecs, validation and tests |
| `M9-ONLINE-REMATCH` | gameplay | `rematch` message, session reset with the same roster, match identifier, guards and tests |
| `M9-ONLINE-RESULTS-UI` | graphics | Online result card, ranking display, draw handling, REMATCH control, waiting and refusal states |

Gameplay ships first; the UI builds on the message contract it lands.

## 5. Accept criteria

1. `match-end` carries the authoritative reason, winner (or `null`) and a full ranking that matches `rankMatch` for
   the same state and accumulated events, for all three modes and for a draw.
2. Omitting the payload stays valid; no snapshot canonical bytes change for the existing pinned expectations, and no
   simulation fingerprint moves.
3. `rematch` starts a second match in the same process with the same roster and zeroed scores, and the client sees a
   new `match-start` with a higher match identifier.
4. `rematch` is rejected with a typed reason when the session is not in `results` or a player has left; the session
   stays consistent and can still be closed cleanly.
5. The online page renders the result from the payload only: winner, reason, podium, draw, 4th-8th, and a REMATCH
   button that works without a reload.
6. Tests: codec and server unit tests, an end-to-end browser test with a real server that plays a short match, shows
   the result and starts a rematch, plus the existing suites in both builds.

## 6. Out of scope

- Matchmaking, lobby persistence, rejoin after disconnect, host migration, authentication, TLS and rate limiting.
- Persistent statistics, replays and shareable results.
- Changing simulation rules, scoring or end conditions.
- Eight players in networked play: still an owner decision and a two-machine measurement.

## 7. Risks

- `serve:match` is currently a one-shot harness; turning it into a repeatable session touches lifecycle code that
  many tests assume is terminal. Guard with explicit tests for the old terminal behaviour where it is still wanted.
- The client's interpolation buffer must be cleared on rematch, or the new countdown will render stale positions.
- A rank payload increases the `match-end` message size slightly; it is sent once per match, not per tick.
