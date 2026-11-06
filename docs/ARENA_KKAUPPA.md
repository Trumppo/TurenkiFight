# K-kauppa arena (M15-ARENA-2)

K-kauppa is a presentation-only small Finnish convenience-store interior. Select it locally with `?arena=kkauppa`;
the station remains the default and Ravintola Mesku remains available with `?arena=mesku`. Original geometric SVG
art is authored on the 320×180 art grid for both classic and retro styles. The composition has a high window band,
back-wall grocery shelves, a drinks fridge, checkout counter and a subdued tiled floor. There are no external art
assets or imported logos. Phaser keeps the 640×360 logical camera and nearest-neighbor rendering.

## Hazard status — telegraph only

The planned shelf event is **not a damaging hazard**. In a match, the presentation timeline begins when the fight
phase begins. Every 45 seconds, the last 3 seconds show a few small shelf-edge vibration/flicker marks and emit a
quiet procedural two-note shop-bell cue (if browser audio has been unlocked and is not muted). There is no warning
copy, collapse, collision, damage, score change or item interaction. The cues are decorative and do not affect
simulation state, protocol, server, world bounds, spawns or camera.

The design proposal for a future damaging version remains unimplemented: a fixed shelf band would collapse after
its 3-second telegraph and deal 15 damage to fighters standing in the band. That behavior needs a separately
accepted arena-rules ADR and deterministic gameplay implementation. The graphics and this page do not claim it
exists.

## Verification

`tests/browser/kkauppaArena.spec.ts` captures the four-fighter arena at native 640×360 and nearest-neighbor 2×
1280×720 for both styles. It also checks arena selection and pins the byte hashes of station classic, station
retro, Mesku retro, and the classic Mesku-to-station fallback from a clean pre-change `main` worktree. Captures are
written to the ignored `artifacts/screenshots/` directory. `arenaTelegraph.test.ts` checks the presentation timing;
the simulation and protocol suites are unchanged.

The background-only Chromium screenshot SHA-256 baseline values are: station classic and classic Mesku fallback
`b09668e72ffcc431e278a76e4abead6139bee5dd16fc76a3497c73d65ec08569`; station retro
`af31b96717e62ea3bfef03a7b325dc1c4c049bd600f096f96da6fe881925e3d0`; Mesku retro
`2dabe679ea6e05a0007412c3d371e49cb81b17d4f4569980f8be7da4573a4fa2`. The four new captures are
`m15-kkauppa-{classic,retro}-{640x360,1280x720}.png`.
