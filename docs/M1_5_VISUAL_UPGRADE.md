# M1.5 — Retro raster visual upgrade

**Status:** planned; visual direction approved by project owner on 2026-10-30. M1 remains accepted. This is a visual-only milestone before M2 networking.

## Art direction
Use the early-1990s raster/pixel-art treatment explored in the Janne50v birthday card as a *style reference*, not its Dune setting or assets. TurenkiFight must remain recognizably Finnish, playful and arcade-readable. Keep the Turenki railway station and four distinguishable fighters. Original artwork only; do not copy sprites or backgrounds from commercial games.

## Resolution contract
- Keep existing **640 × 360** logical camera, 16:9 framing, game coordinates and HUD layout contract.
- Design principal artwork on a **320 × 180** reference grid (2 logical pixels per art pixel) as the initial prototype; use nearest-neighbor integer scaling and consistent pixel density.
- This is an **art grid**, not an instruction to change Phaser's render resolution, gameplay simulation, input mapping or camera bounds.
- Test fighter silhouettes, labels, scores and attack cues at native size, 2×/3× display scaling and mobile fit. Allow higher-resolution HUD typography when essential for legibility.
- Treat 320 × 180 as a **provisional art-direction choice**: validate with a real prototype before converting every asset. If readability fails, revise art pixel density rather than modifying simulation.

## Work packages
1. **M1.5-VIS-01 — Visual concept and proof:** define palette, pixel scale, Turenki station sample and one fighter with key poses. Compare with current game, get owner approval before mass asset replacement.
2. **M1.5-VIS-02 — Fighters:** four distinct silhouettes, outfits and faces, consistent foot anchors, attack/KO/respawn poses; preserve sprite keys and API contracts.
3. **M1.5-VIS-03 — Station:** recognisable Finnish station architecture, layered original raster background, uncluttered combat plane; decorative motion only.
4. **M1.5-VIS-04 — HUD and feedback:** period-appropriate readable typography, score/HP/timer/results, impact effects; no changes to game rules or scoring.
5. **M1.5-VIS-05 — QA and release:** visual snapshots and browser playtest at 640 × 360, 2×/3×, mobile; unit/browser tests and production build; document regressions and limitations.

## Boundaries and acceptance
No changes to deterministic simulation, combat balance, mode rules, multiplayer architecture or join flow. Art assets must be modular, replaceable and independent of core logic. Preserve existing animation pose names and asset-loading contracts. Review a one-character/one-background prototype first; no claim that M1.5 is implemented or accepted until tested and explicitly approved.
