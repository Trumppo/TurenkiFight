# Photo Reference to Retro Arena Workflow

**Purpose:** Repeatable process to update or create arena backgrounds (station, K-kauppa, Mesku, future) using real-world photos as reference while staying strictly within the retro-only visual style.

**Owner:** Designer (spec) + Graphics (implementation)
**Status:** 2026-11-11 – documented for future graphics work
**Related:** 
- `docs/GRAPHICS_ROADMAP.md` (G1–G6 principles)
- `docs/visual/STYLE_GUIDE.md`
- `src/game/presentation/arenaVisuals.ts`
- Existing arena SVGs in `public/assets/`

## Core Principles (non-negotiable)
1. **Retro-only**: All work uses the current retro style (no classic fallback).
2. **Presentation only**: Changes affect only visuals. Simulation, protocol, hitboxes, state hashes remain byte-identical.
3. **Quiet platform rule** (from G2/G4/G6): The lower ~1/3 of the image (fighting plane) must be very calm – large flat areas, minimal lines, no busy textures or details that reduce fighter readability at 8 players.
4. **Recognizable but stylized**: Use real photos for proportions, colors, silhouette and key landmarks (e.g. "TURENKI" sign, window rhythm, canopy). Never photoreal – geometric flat fills, crispEdges.
5. **Color accuracy**: Match real building colors exactly (e.g. Turenki station is nearly white / light pinkish-white siding, dark grey roof, white trim). Do not use previous warm ochre unless owner approves.
6. **Final asset is SVG**: 320×180 art grid, `shape-rendering="crispEdges"`, heavy use of `<rect>` and simple `<path>` (see existing station SVG for structure). Generated JPG/PNG files are **references only**.
7. **Semantic QA + owner visual review**: No PNG byte pinning. Tests use texture keys, layout checks and human review at 640×360 / 1280×720.

## Step-by-Step Workflow

### 1. Collect Reference Photos (User / Designer)
- Gather high-quality photos from multiple angles and seasons.
- Prioritize:
  - Frontal view of main building + canopy
  - Side angles showing proportions
  - Clear details of windows, roof, trim, signage
  - Platform level (to understand quiet area)
- Store originals in:
  ```
  docs/visual/references/<arena-id>/
  e.g. docs/visual/references/turenki-station/
  ```
- Name files descriptively: `turenki-front-summer-2026.jpg`, `turenki-canopy-detail.jpg`
- Add a `README.md` in the folder with:
  - Date collected
  - Photographer / source (ensure CC0-compatible or owner permission)
  - Key observations (e.g. "Facade is light pinkish-white, not yellow")

### 2. Generate Retro Reference Image(s) (Designer or Graphics)
- Use an image generation tool with a strict prompt.
- Example prompt template (copy and adapt):

```
Create a 320x180 retro 1990s arcade pixel art background in the exact style of TurenkiFight (geometric flat fills, crispEdges, limited palette, quiet platform).

Arena: <arena name>
Real reference photos show:
- Main color: <exact description, e.g. nearly white / light pinkish-white horizontal wooden siding>
- Roof: <dark grey / black>
- Trim & details: <white>
- Key features: <canopy with TURENKI sign, window rhythm, clock, etc.>

Requirements:
- Very quiet lower platform (bottom third) – large flat calm areas, minimal lines
- Stylized geometric look, not photoreal
- Clear readable "TURENKI" style sign
- Match existing game retro station spirit (see current SVG)
- Resolution exactly 320 wide × 180 high
```

- Generate 1–3 variants (different lighting / simplification levels).
- Save to `docs/visual/retro-<arena>-ref.jpg` (or similar).
- These are **temporary references**, not final assets.

### 3. Manual Recreation in Aseprite / Pixel Tool (Graphics)
- Open:
  - Real reference photos (multiple angles)
  - Generated retro reference image(s)
  - Existing arena SVG (for style matching)
- Create new 320×180 canvas with pixel grid.
- Recreate using the structure of the current SVG:
  - Sky + distant elements (simple)
  - Main building mass (left/center)
  - Canopy / annex (right)
  - Very quiet platform (large flat rects)
- Use rect-heavy approach for retro crisp look.
- Match or update palette to real colors while keeping good contrast for HUD and fighters.

### 4. Export as SVG
- Export with `shape-rendering="crispEdges"`.
- Keep file size reasonable (hundreds of bytes to a few KB).
- Example header:
  ```xml
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" shape-rendering="crispEdges">
  ```
- Place in `public/assets/<arena>/<arena>-retro.svg`

### 5. Integrate & Test
- Update `src/game/presentation/arenaVisuals.ts` only if adding new arena or changing paths.
- Run:
  - `npm run visual:matrix`
  - Focused browser tests for the arena
  - Full `npm test` + `npm run test:browser`
- Capture before/after in `docs/visual/` if significant.
- Test in-game at both desktop resolutions with 4 and 8 fighters.

### 6. Owner Visual Review & Acceptance
- Owner reviews the live game (not just the reference image).
- Check:
  - Color accuracy to real building
  - Fighter readability (especially 8 players)
  - Quiet platform
  - Overall retro consistency with fighters and other arenas
- Record decision in the arena's doc (e.g. `docs/visual/TURENKI_STATION_UPDATE.md` or `ARENA_KKAUPPA.md`).

## Reusable for All Arenas

| Arena   | Reference Folder                     | Notes |
|---------|--------------------------------------|-------|
| station | `docs/visual/references/turenki-station/` | Current example (multiple photos + generated refs) |
| kkauppa | `docs/visual/references/kkauppa/`    | Include interior shelf details for hazard context |
| mesku   | `docs/visual/references/mesku/`      | Evening mood, quiet interior |

For new arenas:
1. Follow the same 6 steps.
2. Create new manifest entry in `arenaVisuals.ts`.
3. Add to `npm run visual:matrix` if needed.
4. Document in `docs/visual/<ARENA>_ARENA.md`.

## Current Examples (2026-11-11)

- Real photos: User provided multiple angles/seasons of Turenki station (stored as conversation attachments; copy to `docs/visual/references/turenki-station/`).
- Generated references:
  - `docs/visual/retro-turenki-from-photo-ref.jpg` (earlier version)
  - `docs/visual/retro-turenki-white-facade.jpg` (corrected light pinkish-white facade)

These files must be preserved for future graphics work.

## Out of Scope / Risks
- Direct use of generated images as game assets (they are references only).
- Changing simulation or gameplay.
- Adding real photo textures (would break retro style and performance).
- Ignoring the quiet platform rule.

## Checklist for Graphics Agent
- [ ] References collected and organized
- [ ] Retro reference image generated with correct colors
- [ ] SVG recreated manually in Aseprite
- [ ] Quiet platform verified
- [ ] Colors match real building
- [ ] Tests green + visual:matrix run
- [ ] Owner visual review recorded

This workflow ensures consistency across all arenas while allowing photo-accurate retro stylization.