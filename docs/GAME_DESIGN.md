# TurenkiFight – Game Design v0.3

**Date:** 2026-10-24  
**Status:** Initial prototype design; all numeric balance values are provisional.

## Vision

A chaotic, accessible browser-based 2.5D party fighting game set in stylized Turenki locations. The first map is Turengin rautatieasema (Turenki railway station). Visual direction: 8-bit-inspired pixel art, readable silhouettes and lively arcade feedback. Inspired by the energy of IK+, but original in content and mechanics.

## Core decisions

- **Fixed arena camera**: same entire arena visible to all players; no camera tracking or in-match zoom.
- **2.5D**: characters move on the X/Y ground plane and jump along Z. Draw sprites in foot-Y order, subtracting Z from the on-screen vertical position.
- **Configurable player count**: no permanent hard-coded maximum. Four local players are the first milestone; test eight players and beyond before setting supported limits.
- **LAN and internet multiplayer**; multiple local controllers on one computer should be possible.
- **First mode: Score Brawl**. Future modes may include Last Man Standing and Deathmatch.

## Camera and visual baseline

- Internal render target: **384 × 216 px**, 16:9, nearest-neighbor integer scaling where possible.
- Static side/raised-side viewpoint showing both X and depth movement.
- Initial playable ground plane: approximately 384 × 96 game-world units, subject to playtesting.
- Camera framing must preserve space for HUD and fighter visibility.
- At larger player counts, test a higher internal resolution, compact HUD, adjusted sprite sizes and arena composition instead of assuming 384 × 216 always suffices.

## First stage: Turenki railway station

Stylized station building and a clearly readable **TURENKI** sign; platform, rails, station details, optional passing train and ambient animations. Background, playfield and foreground are separate layers. Arena boundaries are visually understandable. The stage is an interpretation of the location, not a promise of geographic accuracy.

## Fighter fundamentals

- Move freely in X/Y; jump uses Z and vertical velocity.
- Facing direction, walk/run, idle, hitstun, attack startup/active/recovery, block, knockout and respawn.
- Punch, kick and jump kick in the initial move set; block and dodge can be added iteratively.
- Hit detection uses logical hitboxes/hurtboxes and world-space depth ranges, **not overlapping sprite pixels**.
- Attacks have cooldown/recovery; one attack cannot repeatedly score against the same target in a single active window.
- Visual clarity: player identifiers, distinct palettes, hit flashes, shadows at ground contact and restrained screen effects.

## Score Brawl – provisional rules

All players fight simultaneously. Highest score when the timer expires wins.

| Rule | Initial test value |
| --- | ---: |
| Match length | 120 seconds |
| Punch hit | +100 |
| Kick hit | +150 |
| Jump kick hit | +200 |
| Knockout | +500 |
| Being knocked out | −200 |
| Respawn delay | 3 seconds |
| Respawn protection | 1.5 seconds; ends on attack |

Points are awarded by the authoritative game simulation only. Knockout credit goes to the finishing attacker. A valid hit is counted once per attack-target pair. Blocked attacks give no points in the initial ruleset. Tie breakers: knockouts, then fewer hits received; otherwise draw. Values are **tuning hypotheses**, not finalized balance.

## Match flow

Lobby → countdown (3 s) → fight → time up → results → rematch or lobby. Spawn points avoid immediate overlap. On respawn, grant temporary protection to reduce spawn camping.

## Mode architecture

Game mode rules are separate from fighter simulation. A `GameMode` implementation receives match-start, hit, knockout and tick events and decides scoring, respawns, end conditions and results. The initial implementation is `ScoreBrawlMode`; later implementations should not require changes to movement and combat simulation.

## Prototype acceptance criteria

1. Four local players can fight with a fixed camera on the station stage.
2. Hits are consistent across depth lanes; jumping is readable.
3. Score Brawl ends correctly and displays standings.
4. A networked LAN session reproduces authoritative scores and knockouts.
5. Remote internet play works under tested network conditions.
6. Player count and HUD readability are benchmarked at eight players, with higher counts explored.

## Open design questions

Character roster and art pipeline; keyboard/controller mapping; friendly-fire/team variants; combat timing and frame data; accessibility; map collision boundaries; score tuning; actual maximum supported player count.
