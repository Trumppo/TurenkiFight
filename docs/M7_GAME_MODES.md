# M7 game modes: Last Man Standing and Deathmatch

**Status:** Design spec, owner-selected goal 2026-11-02. Not implemented.
**Scope:** deterministic gameplay rules plus presentation. The existing Score Brawl stays exactly as it is.

## 1. Mode contract

A match is created with one mode:

| Mode | Id | Nature |
| --- | --- | --- |
| Score Brawl | `score-brawl` | Existing behaviour. 120 s, respawns, score from hits and KOs. **Must not change.** |
| Last Man Standing | `last-man-standing` | One stock per fighter. A KO eliminates the fighter for the rest of the match. Last fighter standing wins. |
| Deathmatch | `deathmatch` | Respawns as today. Every KO credits a frag to the attacker. First to the frag limit, or most frags at time, wins. |

Rules are parameters of the match setup, not branches scattered through the simulation. A mode is a
small, typed rules object passed where the match state is created, so the authoritative server can
select a mode later without protocol changes beyond carrying the mode id.

## 2. Last Man Standing

- Each fighter starts with **1 stock**.
- On KO the fighter is **eliminated**: no respawn, no further input effect, rendered as out.
- The match ends immediately when **one or zero** fighters remain. The remaining fighter wins.
- If the 120 s timer expires with two or more alive, the winner is the fighter with the most
  remaining HP; ties on HP break on KOs dealt, then on damage dealt, otherwise the match is a draw.
- HUD shows stocks (1/0) instead of score, and an "eliminated" state per fighter.
- No respawn protection is needed after elimination; hit protection for the brief spawn moment still
  applies at match start.

## 3. Deathmatch

- Respawns and protection work as in Score Brawl.
- A KO credits **one frag** to the attacker. Self-destruction or simultaneous KO credits nobody.
- The match ends at **20 frags** or 120 s, whichever comes first.
- If the timer expires, most frags wins; ties break on fewest deaths, then on most damage dealt,
  otherwise draw.
- HUD shows frags and deaths per fighter; the results screen shows the frag table and the winner.

## 4. Shared rules

- Tick rate, movement, hit detection, damage values, input handling and the 120 s default timer are
  unchanged. Modes change only scoring, elimination and end conditions.
- Determinism is mandatory: the same seed, fixture and inputs must produce identical final state and
  ordered events for each mode. Existing Score Brawl fingerprints must remain byte-identical.
- Event stream gains explicit end reasons (`elimination`, `frag-limit`, `time`) and a winner field so
  the UI, audio cues and the online client can react without parsing text.
- Mode selection is part of match setup, not of per-tick input.

## 5. Acceptance criteria

1. Score Brawl is unchanged: existing regression tests and pinned fingerprints pass without edits.
2. Last Man Standing: a KO eliminates without respawn; the match ends when one remains; timer
   tie-breaks behave as specified and are covered by tests.
3. Deathmatch: frags are credited to the attacker, the frag limit ends the match, and timer
   tie-breaks are covered by tests.
4. Each mode has a deterministic replay test over a scripted fixture with a pinned final-state and
   ordered-event hash.
5. Mode-specific events are typed and tested, including winner and end reason.
6. UI: mode selection before the match, mode-appropriate HUD (stocks / frags / score) and a results
   screen naming the winner and the end reason.
7. Audio: the existing cue bridge still works; a match-end cue fires for every mode.
8. npm test, npm run build, full browser suite and git diff --check pass.

## 6. Out of scope

- Online mode selection (separate follow-up; the server currently always runs score brawl).
- New arenas, new characters, new combat moves.
- Ranked play, matchmaking, persistence of results.

## 7. Risks

- Elimination must not leave a fighter able to be hit, targeted or animated as active; tests must
  cover the ghost-input case.
- Timer tie-breaks are easy to get subtly wrong; they belong in pure helper functions with unit tests.
- HUD changes can regress the readability work just completed; the existing VIS-05 checks must stay green.
- Changing match-end timing can affect the existing browser harness that waits for `fighting`; run the
  full suite, not only the new specs.
