# G4 capture matrix

The `before` captures were made with the unmodified `main` SVGs before editing; `after` captures use the G4 SVGs. Every image is a full viewport screenshot at the named desktop size; each `measurements.json` records its actual dimensions, style, requested/selected arena, fighter count and per-fighter pixel contrast samples. The logical canvas remains 640×360. `node scripts/g4ArenaContrast.mjs before|after` captures whichever assets are currently checked out into that named directory; to reproduce a baseline, run it in a clean worktree at the base commit rather than changing art files in-place.

Each stage has 24 PNGs: 3 requested arenas × 2 styles × 2 fighter counts × 2 viewport sizes. In classic, Mesku intentionally selects the station fallback.

| Style | Requested arena | Fighters | Before 640×360 | Before 1280×720 | After 640×360 | After 1280×720 |
|---|---|---:|---|---|---|---|
| Classic | Station | 4 | [PNG](./before/classic-station-4p-640x360.png) | [PNG](./before/classic-station-4p-1280x720.png) | [PNG](./after/classic-station-4p-640x360.png) | [PNG](./after/classic-station-4p-1280x720.png) |
| Classic | Station | 8 | [PNG](./before/classic-station-8p-640x360.png) | [PNG](./before/classic-station-8p-1280x720.png) | [PNG](./after/classic-station-8p-640x360.png) | [PNG](./after/classic-station-8p-1280x720.png) |
| Classic | K-kauppa | 4 | [PNG](./before/classic-kkauppa-4p-640x360.png) | [PNG](./before/classic-kkauppa-4p-1280x720.png) | [PNG](./after/classic-kkauppa-4p-640x360.png) | [PNG](./after/classic-kkauppa-4p-1280x720.png) |
| Classic | K-kauppa | 8 | [PNG](./before/classic-kkauppa-8p-640x360.png) | [PNG](./before/classic-kkauppa-8p-1280x720.png) | [PNG](./after/classic-kkauppa-8p-640x360.png) | [PNG](./after/classic-kkauppa-8p-1280x720.png) |
| Classic | Mesku (station fallback) | 4 | [PNG](./before/classic-mesku-4p-640x360.png) | [PNG](./before/classic-mesku-4p-1280x720.png) | [PNG](./after/classic-mesku-4p-640x360.png) | [PNG](./after/classic-mesku-4p-1280x720.png) |
| Classic | Mesku (station fallback) | 8 | [PNG](./before/classic-mesku-8p-640x360.png) | [PNG](./before/classic-mesku-8p-1280x720.png) | [PNG](./after/classic-mesku-8p-640x360.png) | [PNG](./after/classic-mesku-8p-1280x720.png) |
| Retro | Station | 4 | [PNG](./before/retro-station-4p-640x360.png) | [PNG](./before/retro-station-4p-1280x720.png) | [PNG](./after/retro-station-4p-640x360.png) | [PNG](./after/retro-station-4p-1280x720.png) |
| Retro | Station | 8 | [PNG](./before/retro-station-8p-640x360.png) | [PNG](./before/retro-station-8p-1280x720.png) | [PNG](./after/retro-station-8p-640x360.png) | [PNG](./after/retro-station-8p-1280x720.png) |
| Retro | K-kauppa | 4 | [PNG](./before/retro-kkauppa-4p-640x360.png) | [PNG](./before/retro-kkauppa-4p-1280x720.png) | [PNG](./after/retro-kkauppa-4p-640x360.png) | [PNG](./after/retro-kkauppa-4p-1280x720.png) |
| Retro | K-kauppa | 8 | [PNG](./before/retro-kkauppa-8p-640x360.png) | [PNG](./before/retro-kkauppa-8p-1280x720.png) | [PNG](./after/retro-kkauppa-8p-640x360.png) | [PNG](./after/retro-kkauppa-8p-1280x720.png) |
| Retro | Mesku | 4 | [PNG](./before/retro-mesku-4p-640x360.png) | [PNG](./before/retro-mesku-4p-1280x720.png) | [PNG](./after/retro-mesku-4p-640x360.png) | [PNG](./after/retro-mesku-4p-1280x720.png) |
| Retro | Mesku | 8 | [PNG](./before/retro-mesku-8p-640x360.png) | [PNG](./before/retro-mesku-8p-1280x720.png) | [PNG](./after/retro-mesku-8p-640x360.png) | [PNG](./after/retro-mesku-8p-1280x720.png) |

Contrast data: [before](./before/measurements.json), [after](./after/measurements.json). Summary and caveats: [G4 review](../G4_ARENA_CONTRAST_REVIEW.md).
