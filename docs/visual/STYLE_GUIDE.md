# TurenkiFight visual style guide — M1

## Directions evaluated

1. **Nordic Arcade (selected):** muted Nordic blue sky, warm ochre station, dark slate roof, readable arcade fighters. Strong local identity with restrained noise.
2. Neon Tournament: saturated cyberpunk lighting; less recognizably Turenki and weak foreground contrast.
3. Sepia Pixel: nostalgic Finnish postcard; attractive but low team-color contrast for 4–8 fighters.

## Rendering contract

Logical resolution remains **384 × 216**. Phaser pixelArt=true, antialias=false; use integer coordinates and nearest-neighbor filtering. Do not alter simulation or networking. Draw in layers: sky/distant buildings, station/platform, combat plane, depth-sorted fighters, foreground accents, HUD.

Palette: sky #6d8999, ochre #c2a27d, slate #293f45, platform #76786f, cream #f4e5b4. Players: coral #cf665c, teal #54b7ae, gold #e3b85e, lavender #9e85cc. Each player needs a distinct ID label and silhouette in addition to color.

## Visual geometry

Keep ground-plane combat space visually uncluttered. HUD occupies the upper 24 pixels. Keep high-contrast fighter outlines and ground shadows. No active rail tracks in the collision plane. Station sign must read TURENKI. Environmental animation must never alter game state.

## Animation specification (next integration)

Idle 4 frames, walk 6, depth-walk 4, punch 4, kick 5, jump 3, jump-kick 4, hit 2, KO 5, respawn 4. Suggested cell size 32 × 48 pixels with foot anchor at bottom center; animation durations determined by presentation state, not simulation ticks. For missing gameplay events, display neutral idle/walk instead of inventing simulation flags.

## Asset provenance

This guide and initial scene art are original project work. No third-party sprites or copyrighted photographs embedded. Turenki station reference photographs should be used only to identify architectural characteristics; record individual URLs and rights before importing any third-party asset.

## Acceptance gates

Review station recognizability against references; compare four fighter colors under typical HUD and overlapping silhouettes; run npm test, npm run build and browser smoke tests. Preserve 384 × 216 and verify scaling at 1×, 2× and mobile fit. Do not merge without approval.
