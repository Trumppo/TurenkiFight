# Photo Reference to Retro Arena Workflow

**Purpose:** Repeatable process to update or create arena backgrounds (station, K-kauppa, Mesku, future) using real-world photos as reference while staying strictly within the retro-only visual style.

**Owner:** Designer (spec) + Graphics (implementation)
**Status:** 2026-11-11 – updated to current target state
**Related:** 
- `docs/GRAPHICS_ROADMAP.md` (G1–G6 principles)
- `docs/visual/STYLE_GUIDE.md`
- `src/game/presentation/arenaVisuals.ts`
- Existing arena SVGs in `public/assets/`

## Current Target State (2026-11-11)

The goal is **photo-accurate retro stylization**, not the previous purely invented look:

- Real photos are the primary source for colors, proportions, window rhythm, canopy structure and signage.
- AI image generation is used only as an **intermediate reference tool** to quickly produce a 320×180 retro-style starting point with correct colors and quiet platform.
- The final deliverable is always a **hand-crafted SVG** created by graphics in Aseprite (or equivalent), closely matching the structure, crispness and readability rules of the existing game assets (e.g. current station SVG).
- Generated JPG/PNG files are **never** committed as game assets — they are temporary aids.
- Color accuracy is critical (example: Turenki station facade must be nearly white or light pinkish-white wooden siding with dark grey roof and white trim; old warm ochre is deprecated for this arena).
- The lower fighting plane must remain very quiet for 8-player readability.
- The same workflow must be reusable for K-kauppa and Mesku without major changes.

This evolved target state replaces earlier assumptions where arenas were created from imagination only. All future arena updates should follow this photo-based approach.

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
- Use an image generation tool (e.g. the project's available image model) with a **very strict prompt**.
- The generated image is **only a visual reference**, never the final asset. Its purpose is to give graphics a quick 320×180 retro-style starting point that already has the correct real-world colors and a calm platform.
- Example prompt template (use the latest version that produced good results):

```
Create a 320x180 retro 1990s arcade pixel art background exactly in the style of TurenkiFight (geometric flat fills, crispEdges, limited palette, quiet platform).

The building must be the real <Arena Name> based on the attached reference photos.

Critical color accuracy:
- Main building facade: <exact real color, e.g. nearly white or very light pinkish-white horizontal wooden siding>
- Roof: <exact, e.g. dark grey or dark slate>
- All trim, window frames, columns: crisp white
- Key features: <canopy with "TURENKI" sign, window cross-panes, clock, etc.>

Requirements:
- Very quiet lower platform (bottom third of image) – large flat calm areas, minimal lines and texture so 8 fighters remain readable
- Stylized geometric retro look, not photoreal
- Clear, readable signage in retro lettering
- Match the existing game retro aesthetic (see current <arena>-retro.svg for structure and crispness)
- Resolution exactly 320 wide × 180 high
```

- Generate 1–3 variants if the first color or simplification level is not accurate.
- Save generated files to `docs/visual/retro-<arena>-<description>.jpg` (e.g. `retro-turenki-white-facade.jpg`).
- **Important:** If the generated color is wrong, iterate with the user/owner by providing new photos or feedback (e.g. "facade must be lighter pinkish-white, not yellow").

- These files are **temporary references only** and must not be used directly in the game.

### Color Accuracy Iteration (common step)
Real photos often require 1–2 iterations because AI color interpretation can be off (as happened with the first Turenki generations that came out yellow instead of light pinkish-white). 
- Provide the generated reference back to the owner with the real photos side-by-side.
- Ask for precise feedback ("facade must be almost white with slight pink tint in daylight").
- Regenerate with updated prompt.
- Document the final accepted colors in the arena's references/README.md.

### 3. Manual Recreation in Aseprite / Pixel Tool (Graphics)
- Open all of these together:
  - Real reference photos (multiple angles and seasons — these are the authority for color and shape)
  - Generated retro reference image(s) (quick 320×180 retro starting point)
  - The existing `<arena>-retro.svg` (to match exact crisp retro style, rect usage, and quiet platform treatment)
- Create a fresh 320×180 canvas.
- Recreate the arena by hand:
  - Follow the same layer/structure logic as the current SVG (sky, main building, canopy/annex, very quiet platform).
  - Apply the correct real colors from the photos (do not keep old invented colors like warm ochre for station).
  - Keep the lower fighting plane extremely calm (large flat areas, very few seams or details).
  - Use the same retro techniques: heavy use of small rects, crispEdges, limited palette.
- The goal is a hand-crafted SVG that feels like it belongs with the existing fighters and other arenas, while being much more recognizable from the real photos.

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

**Turenki station (first arena updated with this workflow):**
- Real photos: Multiple angles and seasons provided by owner in the 2026-11-11 discussion (frontal, side, platform, winter/summer). Copy the clearest ones to `docs/visual/references/turenki-station/`.
- Generated reference images (AI aids only):
  - `docs/visual/retro-turenki-white-facade.jpg` — main reference with correct light pinkish-white facade
  - `docs/visual/retro-turenki-from-photo-ref.jpg` — earlier iteration
- Key learning: AI needed color correction iteration because the first generations produced yellow instead of the real nearly-white/pinkish-white siding.

See `docs/visual/references/turenki-station/README.md` for detailed observations.

**Note for other arenas:** The same structure (references folder + generated refs + this workflow doc) will be used for K-kauppa and Mesku when their photo updates begin.

These generated reference files + the references folder must be preserved for future graphics work. Do not delete them when implementing the final SVG.

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