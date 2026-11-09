# G4 arena depth and background contrast review

Task: `GRAPHICS-G4-ARENA-CONTRAST`

## Scope and method

The screenshots use a fixed 640×360 Phaser backing canvas, four or eight fighters in a deterministic `fighting` state at their normal spawn positions, and full desktop viewport captures at 640×360 and 1280×720. There are 24 captures before and 24 after (48 PNGs total). The classic Mesku request deliberately falls back to station art because Mesku has no classic variant; the manifest records the selected arena for each capture.

Contrast was measured from the captured pixels, not estimated from SVG swatches. For every fighter, the visible screenshot was paired with a background-only screenshot of the same scene (fighter sprites, marker labels and floor shadows hidden). Each changed pixel inside the fighter sprite bounds was compared with the exact corresponding pixel under it using the WCAG relative-luminance contrast formula used by `fighterMarker.ts`. The table reports the median of per-fighter median ratios, the median per-fighter 10th percentile, and the median share of silhouette pixels at or above 3:1, aggregated across both fighter counts and viewport sizes (24 fighter observations per requested style/arena). Ratios are descriptive over varied costume pixels; 3:1 is the G2 marker-vs-floor target, not a claim that every costume pixel must reach 3:1.

## Measurements

| Requested arena | Style | Before median / p10 / pixels ≥3:1 | After median / p10 / pixels ≥3:1 | Selected art |
|---|---|---:|---:|---|
| Station | Classic | 2.95 / 1.45 / 43% | 2.95 / 1.45 / 43% | Station |
| Station | Retro | 2.26 / 1.19 / 28% | 2.27 / 1.19 / 28% | Station |
| K-kauppa | Classic | 3.07 / 1.56 / 56% | 3.24 / 1.36 / 56% | K-kauppa |
| K-kauppa | Retro | 2.10 / 1.16 / 33% | 2.42 / 1.20 / 35% | K-kauppa |
| Mesku | Classic | 2.95 / 1.45 / 42% | 2.95 / 1.45 / 43% | Station fallback |
| Mesku | Retro | 2.00 / 1.22 / 10% | 2.00 / 1.22 / 10% | Mesku |

Per-view, per-fighter values and sample counts are in each stage's `measurements.json`. The 3:1 coverage is not universal: costume pixels vary by player palette and local background, while dark sprite outlines provide additional silhouette separation. The existing G2 marker contrast tests remain unchanged. K-kauppa's median improved in both styles; the retro lower tail remains low, so this is a measured reduction in background competition, not a universal 3:1 costume guarantee.

## Visual changes

Only K-kauppa changed, in its two existing SVG variants:

- Toned down the lower shelf's colored packages and the shelf rails around SVG rows y=77–101, where back-row heads and upper bodies sit.
- Muted the checkout front and supports behind the fighting band while preserving the checkout shape and brighter upper shelf/fridge detail.
- Reduced floor grid line opacity so tiles still cue depth without competing with fighter legs: classic main seams `.75` to `.45`; retro main seams `1` to `.45`; secondary highlights `.45` to `.25` in both.
- Clarified the floor edge with a darker 3 px boundary and a 1 px light lip (y=124–127 in the 320×180 art grid).

The K-kauppa shelf hazard band remains the separate existing presentation overlay (`SHELF ZONE` is visible in captures); its timing, appearance logic and damage were not edited. Deathmatch zone code/visuals were also untouched. Station and Mesku assets were deliberately left byte-for-byte unchanged to preserve their accepted looks.

## Visual QA observations and limits

- Viewed all before/after combinations at both desktop viewport sizes in contact sheets, then inspected native-size K-kauppa, station and Mesku examples. The K-kauppa lower shelf and checkout recede more; the floor edge reads more clearly while the broad floor seams still provide depth. The station and Mesku compositions remain unchanged and comparatively quiet.
- The screenshots retain the 640×360 logical backing. Browser layout fits the canvas inside the full 640×360 or 1280×720 screenshot viewport (the outer page margins are part of each capture).
- Four/eight-player states are static initial positions, not a sampled live match. Markers can crowd in the existing eight-player spawn arrangement; no marker or fighter art was changed here.
- This pass did not change the Deathmatch zone or capture it in a Deathmatch match. The browser suite's `deathmatch-zone.spec.ts` is the regression check for that existing visual, alongside `kkauppaArena.spec.ts` for shelf-band rendering and simulation invariants.
- No phone-sized review was done, per the owner decision that the game is desktop-only.

Capture index: [before/after 24-capture matrix](./g4-arena-contrast/README.md).
