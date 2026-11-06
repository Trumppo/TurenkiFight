# M13: co-op wave mode "Asemahalli"

**Status:** Design spec, 2026-11-06. Part of the active long-term goal. Not implemented.
**Related:** [LONG_TERM_PLAN.md](LONG_TERM_PLAN.md) M13, [M12_OBJECTS.md](M12_OBJECTS.md).

## 1. Why

The spiritual ancestors are *Target Renegade* and *Streets of Rage*: you and your friends against a crowd. The
current modes are free-for-all only. A co-op wave mode is the closest thing to that heritage that fits the fixed
camera and the existing simulation.

## 2. First slice, deliberately small

- **New mode id `wave`.** Players are humans plus optional bot allies; enemies are the bots that are not allied.
- **Waves.** The match runs a fixed number of waves (first slice: 3). A wave ends when its enemy fighters are
  knocked out; the next wave starts after a short countdown and adds pressure (more enemies or tougher tuning).
- **Respawn.** Players respawn; the match does not end on a player knockout. Score decides the result if the timer
  runs out.
- **Win/lose.** Clear all waves: `MatchEnded` with `reason: 'waves-cleared'`. Timer out: the existing `time` reason
  with ranking by score. All players KO'd at once is not a loss in the first slice; it just costs time.
- **Scoring.** KOs by players score; enemy KOs on players do not.
- **HUD.** Wave number, enemies remaining, and the next-wave countdown.

## 3. What it reuses

- The bot policy drives enemies with a seeded policy, so an all-bot wave match is deterministic and testable.
- The existing mode rules table gains a `wave` entry rather than new branches in the tick loop.
- The results screen shows the same ranking and metrics as Score Brawl.
- Objects from M12 can appear in waves once the object system is stable.

## 4. Wire

- `ModeId` gains `'wave'`, and the snapshot carries optional wave state (`wave`, `waveCountdownTicks`) with
  canonical omission for other modes. This is an additive extension like ADR 0002 and needs its own short ADR.
- Existing presets are unchanged; the strict decoder accepts `wave` only with its mode fields.

## 5. Accept criteria

1. A three-wave match is playable locally with one to four humans and bots, and it ends with `waves-cleared`.
2. The wave counter, enemy count and countdown are correct in the HUD and derivable from the snapshot.
3. Determinism: the same seed and inputs produce the same wave outcomes.
4. Score Brawl, Last Man Standing and Deathmatch bytes and rules are unchanged.
5. Tests: simulation rules, wave transitions, determinism, and a browser test that plays a wave match.
6. The mode is selectable and its own mode label appears online.

## 6. Out of scope for the first slice

- Enemy types, bosses, pathfinding, weapon pickups specific to waves.
- Shared life pool and revive mechanics.
- Wave-specific arenas.

## 7. Risks

- Enemies are the same roster slots as players, so "co-op" vs "free-for-all" is a rules distinction, not new
  entities. That keeps the first slice cheap but limits enemy variety.
- Wave tuning decides whether the mode is fun; expect several playtests.
