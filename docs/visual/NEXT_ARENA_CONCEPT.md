# M2-VIS-ARENA-01 — Next TurenkiFight arena: concept and graphics architecture

**Status:** proposal only, 2026-10-31. **No arena selected or approved.** No new assets, gameplay rules or scene code are included in this task. M1.5 VIS-05 independent QA remains in progress.

## Candidate comparison

Qualitative assessment: 5 = most favorable. Effort: 1 = easiest, 5 = hardest. These are concept estimates, not measured costs.

| Candidate | Visual interest | Local recognizability | Implementation effort | Key concern |
| --- | ---: | ---: | ---: | --- |
| Turengin yläaste | 4 | 4 | 3 | School architecture needs strong identifiable details without clutter |
| K-kauppa | 4 | 5 | 3 | Real store signage/trademarks and changing storefront |
| Ravintola Mesku | 5 | 4 | 4 | Complex evening lighting, window and sign legibility |
| Keskustan kävelykatu | 5 | 5 | 4 | Multiple facades and perspective create a busy fighting plane |

**Recommendation for owner review: Turengin yläaste.** It contrasts clearly with the station while remaining recognizably local, and its repeating school facade can be built from reusable tile modules. It has fewer moving decorative parts than the shopping street and fewer night-lighting constraints than Mesku. A fictionalized, non-branded school sign avoids importing third-party logos. The owner's choice is required before production.

## Proposed 8-bit composition: Turengin yläaste

- **Camera and art grid:** unchanged 640 × 360 logical 16:9 camera; author original background on a provisional 320 × 180 grid and upscale with nearest-neighbor filtering. Do not change simulation coordinates or input handling.
- **Back layer (art y=0–52):** pale blue-grey Finnish sky, sparse blocky clouds and distant tree silhouettes. Keep low contrast behind the top HUD.
- **Middle layer (art y=42–106):** recognizable low school building with warm brick, pale concrete framing, broad rectangular windows and a recessed entrance. Put the distinctive entrance at art x=110–180; signs and detail above the platform boundary.
- **Combat plane (art y=106–180):** matte asphalt schoolyard in desaturated grey-green, two short edge markings and subtle seams only at extreme left/right. Keep x=45–275 and y=115–165 free of detailed textures to preserve four overlapping fighter silhouettes.
- **Foreground accents:** optional small fence/planter fragments strictly outside playable fighter silhouettes. Decorative-only, with no collision or gameplay meaning.
- **Palette (draft):** sky `#829fac`, cloud `#c2c7bf`, brick `#a56e58`, concrete `#c4b8a0`, window `#3c5965`, asphalt `#6d7471`, outline `#25343b`, accent `#e2bd76`. Preserve existing fighter colors and high-contrast outlines; do not tint sprites to match the arena.
- **HUD:** preserve existing top-row HP, score, timer and status hierarchy; keep high-frequency window detail outside HUD overlap. Validate P1–P4 at 640 × 360, 1280 × 720, 1920 × 1080 and mobile fit.
- **Motion:** optional slow distant clouds only after static readability approval. Animation must be presentation-only, deterministic gameplay unaffected.

## Arena graphics architecture: proposed, not implemented

The current station backdrop selection is coupled to the scene's visual-style switch. Before adding arenas, introduce a **typed, data-only arena manifest** in the presentation layer, rather than hard-coding a second station-specific conditional in `StationScene`.

Suggested future contract (illustrative, not production API):

```ts
type ArenaVisualManifest = {
  id: string;
  displayName: string;
  logicalSize: { width: 640; height: 360 };
  artSize: { width: 320; height: 180 };
  variants: {
    classic?: { backdropPath: string };
    retro: { backdropPath: string };
  };
  layers: Array<{
    id: 'sky' | 'architecture' | 'combat-surface' | 'foreground';
    assetPath: string;
    depth: number;
    parallax?: number; // presentation-only; default 1
  }>;
  hudContrast: 'dark' | 'light';
};
```

**Migration path:** (1) inventory current station assets and retain existing paths; (2) add a single station manifest and a pure resolver with unit tests; (3) make the scene consume the resolver behind unchanged defaults; (4) only then introduce a second arena manifest and art. Do not add per-arena collision, spawn, physics, input or game-rule properties to the graphics manifest. Arena selection and any authoritative gameplay metadata belong to a separately reviewed gameplay contract.

**Validation gates:** missing asset path fails clearly; original station classic and retro screenshots remain unchanged; nearest-neighbor scaling and HUD readability hold; browser and production build pass; no simulation imports in graphics manifest; ownership and licenses recorded for any external references.

## Decisions awaiting approval

1. Choose the next arena (recommendation: Turengin yläaste).
2. Approve the proposed 320 × 180 visual grid and palette, subject to prototype readability.
3. Approve a separate graphics-manifest implementation task before any second arena assets or scene changes.

**VIS-05 protection:** do not modify M1.5 station, fighters, HUD or hit effects while Tester is validating them. Any Tester defect gets its own narrowly scoped regression task and a retest request.
