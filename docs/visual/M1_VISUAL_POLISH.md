# M1 visual polish — change log

Task: M1-VISUAL-POLISH

## Before / after
- **Station:** previously flat facade and uninterrupted blue horizon; now roof/eaves, masonry base, richer window mullions, subtle reflections, distant roofline/foliage and rhythm in the service building. The TURENKI sign remains prominent. Platform combat zone stays deliberately low-contrast.
- **Fighters:** previously four colors with near-identical silhouettes; now the four variants have distinctive cap/hair/ear guards/headband, plus differing torso stripe patterns. P5–P8 reuse those variants with unique ID labels, as before.
- **Animation:** walk alternates foot displacement, punch and kick reach varies by frame, jump frames shift vertically, hit uses a flash, KO uses a flattened pose and respawn has a fading highlight. Strike extremities stay inside the 32-pixel texture width.

## Compatibility contract
- Unchanged exports: `FighterPose`, `POSES`, `FRAMES_PER_POSE`, `fighterKey`, `createFighterTextures`.
- All ten pose strings and four texture frames per pose retained. Texture keys remain `fighter-${id}-${pose}-${frame % 4}`.
- Canvas cell remains 32×48, bottom-center anchor is owned by the unchanged scene.
- No changes to `StationScene.ts`, simulation, inputs, mode rules or HUD.

## QA checklist
- CI verified on commit `996bf545e7448f3b5f86edd43ae3365a1bac099f`: workflow run #59 completed successfully, including unit tests, production build and Playwright browser smoke. Agent task validation #17 and PR tracking #19 also succeeded. https://github.com/Trumppo/TurenkiFight/actions/runs/40081446774
- Verify all 4 players at 384×216 and overlapping fighters; check silhouette at 2× and mobile scaling.
- Check station reference photographs before claiming architecture is historically accurate; this is an original stylized interpretation, not a photo trace.
- Confirm the published GitHub Pages asset path after integration.

## Rights
All modified art and code are original authored assets. No third-party images or sprites incorporated.
