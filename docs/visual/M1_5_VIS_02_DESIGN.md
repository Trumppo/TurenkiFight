# M1.5-VIS-02 — Four-fighter retro art design and acceptance gate

**Status:** DESIGN READY FOR OWNER REVIEW; implementation NOT authorized by this document.
**Baseline:** PR #21 merged at c0ae871; retro preview opt-in via VITE_VISUAL_STYLE=retro. P1 retro 32×48 default, 48×64 experiment remains opt-in. P2–P4 classic.

## Objective
Extend approved original early-1990s Finnish arcade raster treatment to P2–P4 while keeping four combatants instantly distinguishable in a 640×360 match. No rule, collider, spawn, input or animation-key changes. Keep classic style rollback.

## Art contract
- Keep the existing ten pose identifiers, their animation keys and four-frame expectations; inspect actual keys and contracts in current source before implementation.
- Use a common anatomical pose rig with character-specific silhouettes and color palettes. Avoid three recolors of the same outfit: vary hair/headgear, upper-body outline, outerwear and trousers while preserving combat readability.
- Character selection and player ID are distinct: each fighter must remain identifiable by player ID even if future players select the same character. Keep palette and labels accessible against station background.
- Preserve origin (0.5, 1), foot placement, depth sorting, attack visibility and logical hitboxes. No change to world-space reach or collision.
- Default P1 32×48 contract remains. 48×64 experiment is not promoted. If other fighters need different canvas dimensions, demonstrate compatibility first and obtain owner approval.
- Keep station retro 320×180 art grid provisional and logical camera 640×360. No art-derived physics or camera changes.
- Reuse existing asset and animation registry interfaces; add typed declarative character visual data instead of character-specific branches where practical.
- Maintain a single opt-in retro toggle and classic baseline. No proprietary reference sprites.

## Proposed visual differentiation (not final character identities)
P1: existing coral-red jacket, moustache and dark trousers; preserve approved proof.
P2: taller slim outline, cool blue outerwear, distinctive lighter hair/head shape, quick readable punches.
P3: broader stocky silhouette, ochre/olive heavy jacket, darker hair/headwear and strong kick silhouette.
P4: compact athletic outline, pale/light top with dark contrasting vest and distinctive head shape; avoid merging with station façade.
These are design placeholders, not locked identities, lore or balance archetypes. Owner may approve or replace.

## Small implementation slices
VIS-02A: render P2 in retro mode using same pose contract; keep P1 and classic unchanged. Submit native/mobile screenshot proof.
VIS-02B: add P3/P4 through reusable visual manifest/rig; four-player screenshot and animation coverage.
VIS-02C: polish contrast/occlusion and visual regression checks; no HUD redesign (VIS-04 owns HUD).
Keep each slice independently testable and reversible. No automatic full M1.5 milestone acceptance.

## Acceptance matrix
1. Four unique silhouettes identifiable without reading labels at 640×360 and 390×844 viewport; also verify player IDs and HUD.
2. All existing pose keys and frame counts preserved; idle, walk, punch, kick, hit, KO and respawn read clearly. No third limb/pose clipping.
3. Station sign and fighter overlap remain readable; no lobby text occlusion regressions introduced.
4. Feet remain aligned and depth ordering consistent; logical positions and hitboxes unchanged.
5. Compare classic vs retro at 640×360, 1280×720, 1920×1080 and 390×844; lobby and actual fighting screenshots.
6. Run relevant Vitest, build, browser smoke and retro visual QA; capture artifacts and exact commit SHA; record errors and limitations.
7. Independent Tester review, explicit owner approval of side-by-side art before default style change or milestone acceptance.

## Agent assignment (read latest repository first)
Graphics: fetch origin/main and PRs, inspect latest source, implement only Designer-approved VIS-02A first; provide screenshot evidence and scoped PR. Do not touch simulation or choose a new canvas default.
Tester: independently fetch latest remote head and verify regression evidence for VIS-02A; do not accept screenshot file existence as proof of visual quality.
Designer: reconcile accepted decisions, visual proof and CI, obtain owner approval before VIS-02B and default style switch.

## Dependencies and risks
PR #25 M2 work is separate and should not block VIS-02A if changes remain presentation-only. Shared test files and StationScene.ts require explicit ownership to prevent branch conflicts. Existing retro opt-in P1 implementation is the visual reference, not an authorization to change game mechanics.
