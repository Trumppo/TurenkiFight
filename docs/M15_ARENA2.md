# M15 arena 2: K-kauppa

**Status:** Design spec, 2026-11-07. Part of the active long-term goal (M15). Visual slice implemented under this
task; the damaging hazard is a separate decision.

## 1. The arena

Second Turenki location: **K-kauppa**, a small Finnish convenience store. It must read as a shop at 640x360 with two
or more fighters on screen in the supported retro style.

- Interior: shelving along the back wall, a fridge with bottles, a counter, a checkout, floor tiles, a window band.
- The fighting plane stays the same world coordinates as every arena; changing art never changes collision or rules.
- Selectable with `?arena=kkauppa`; the station stays the default and Mesku stays `?arena=mesku`.
- The station and Mesku screenshots must stay byte-identical: this is an additive arena, not a restyle.

## 2. The hazard (scoped honestly)

The long-term plan says every arena has its own hazard. A **damaging** arena hazard needs declarative arena gameplay
data in the simulation (see `GAME_DESIGN.md`: stage gameplay data is typed and loaded by arena id, never hardcoded
branches). That is a new layer and needs its own ADR before any damage exists.

This slice therefore delivers:

- the arena art and the manifest entry,
- a **telegraph-only** shelf-rattle / shop-bell ambience that does no damage,
- the hazard design written down: every 45 s a shelf section rattles for 3 s and would collapse in a fixed band,
  dealing 15 damage to anyone standing there. It stays unimplemented until the arena-rules ADR is accepted.

Saying "the hazard exists" while it does no damage would be dishonest; the spec and the PR say telegraph only.

**Update 2026-11-07:** the damaging hazard is now implemented under [ADR 0006](adr/0006-arena-hazards.md) as
declarative arena rules: a 2700-tick cycle (45 s) with a 180-tick warning (3 s) and a 120-tick active band (2 s),
1 damage per 6 ticks (20 HP over a full window) in the back-wall shelf strip `y 124-156`, only while `fighting`.
This supersedes the earlier "15 damage" sketch in this document. The presentation slice must show the band and the
warning before the hazard is playable; until scene wiring lands, `?arena=kkauppa` still only selects art.

## 3. Accept criteria

1. `?arena=kkauppa` renders the new interior in retro at 640x360 and 1280x720; fighters stay visible and
   distinguishable.
2. Station and Mesku captures are byte-identical to before the change.
3. No simulation, protocol or server change.
4. Existing visual suites stay green; new screenshots inspected.
5. The hazard is documented as unimplemented, with its intended timing and damage.

## 4. Out of scope

- Arena gameplay rules and damage (separate ADR and slice).
- New characters, new modes, music.
- Changing the world bounds, spawn points or camera.

## 5. Risks

- A busy interior can hide fighters; the art must keep the floor readable and the background low-contrast behind
  combat.
- A new arena multiplies screenshot QA; keep the check list small and explicit.
