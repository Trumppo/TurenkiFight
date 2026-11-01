# Ravintola Mesku arena

Ravintola Mesku is a presentation-only, retro-style arena built as original pixel art on a 320×180 SVG grid and rendered into the existing 640×360 logical camera with Phaser pixel-art settings and nearest-neighbour CSS scaling. The evening scene uses subdued dusk colors, localized amber window light, a fictional readable restaurant sign and a flat combat surface; it contains no real trademarks or imported photography. Window and facade detail stay above the platform edge, while combat-plane accents are confined to the far left and right.

The Turenki railway station remains the default arena. In a retro build, use `/?arena=mesku` to select Mesku locally or `/online.html?arena=mesku` on the online presentation page. Online still requires a match server to connect; arena selection only changes the rendered background. Unknown arena IDs fall back to the station and replace the page subtitle with an explicit warning. Mesku has no classic variant, so a classic build also explains that it is showing the station instead.

The typed arena visual manifest contains art metadata only. Arena selection, backdrop loading and layer depth are presentation concerns; the manifest does not define simulation bounds, spawn locations, collision, input, scoring or item lifetime. Fighter animation keys, logical camera size, HUD DOM and simulation interfaces are unchanged.

## Verification

The `meskuArena.spec.ts` browser checks capture 640×360, 1280×720, 1920×1080 and 390×844 views, validate the asset request, inspect four distinct fighter alpha silhouettes and verify HUD contrast. The existing `retroScaleVisual.spec.ts` remains the responsive HUD and station visual regression gate. `artifacts/visual/mesku-*.png` are generated locally by Playwright and are git-ignored.
