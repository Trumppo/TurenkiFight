# M1 visual integration status

Branch: `feature/visual-design`. No simulation or networking changes.

## Implemented
- Original station backdrop (`public/assets/station/turenki-station-background.svg`) with readable TURENKI sign.
- Presentation-only `visualTheme.ts` color mapping for P1–P4.
- `fighterSprites.ts` creates reusable 32×48 canvas textures for 4 palettes and 10 pose categories, 4 frames each. Textures are runtime-generated rather than PNG atlases, avoiding binary source files.
- `StationScene.ts` loads station backdrop, shows depth-sorted fighter images, labels, shadows, scores, and a presentation-only countdown.

## Known limitations
- Simulation currently spawns only P1 and P2; four visual variants are ready, but a four-player gameplay test depends on the M1 mechanics branch.
- Pose categories kick, KO and respawn are prepared but not driven by current simulation events. Punch is used for current generic attack.
- Countdown does not change match rules; it is not authoritative.
- Station backdrop is a stylized first pass. Photographic architectural reference verification remains outstanding.
- Build and browser checks have **not** been run in this session: GitHub connector supports file changes but no general workflow dispatch, and the execution container cannot reach GitHub.
- SVG source is rasterized by Phaser's SVG loader at 384×216. Keep texture filtering nearest-neighbour.

## Reviewer commands
```bash
git checkout feature/visual-design
npm ci
npm test
npm run build
npm run test:browser
```

Check browser console for asset load failures. Test 384×216 canvas at mobile fit, 2× and 3×. Compare sprite readability at 4 and 8 fighters after the M1 mechanics branch lands. Review local station references before marking final visual approval.

## Rights
All newly authored graphics and source in this branch are original project contributions. No third-party photos or sprites have been copied. The repository currently has no declared project-wide license; establish one before redistribution.
