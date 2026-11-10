# Retro-only visual mode plan

Status: implemented on branch `graphics/retro-only-mode`
Owner: project owner
Scope: graphics configuration, presentation assets, tests and documentation only

## Decision

TurenkiFight supports one visual style: the retro style. The former classic
style is removed from the supported runtime and test matrix. The deterministic
simulation, protocol, controls, arena rules and the experimental
`VITE_FIGHTER_CANVAS=expanded` retro canvas option remain unchanged.

## Work package

1. Create a dedicated feature branch and preserve the clean `main` baseline.
2. Remove the classic build-time switch and make retro the only resolved style.
3. Remove classic arena variants and runtime fallback behavior; keep valid retro
   arena selection and explicit unknown-arena fallback.
4. Simplify fighter and object presentation initialization so runtime no longer
   creates classic textures before replacing them with retro textures. Preserve
   the stable fighter texture keys, pose list and 32x48 contract.
5. Update browser/unit tests and visual scripts to exercise retro only.
6. Remove unused classic runtime assets and update active README/docs. Keep
   historical classic screenshots and old reports only when they are explicitly
   labeled historical and are not presented as supported behavior.
7. Run build, unit tests, focused browser tests and the retro visual matrix.
8. Review the final diff, commit, push and open a PR. Do not merge it.

## Explicitly out of scope

- simulation rules, deterministic state, protocol, networking or input
- arena gameplay geometry and hazards
- retro character design, palettes or animation timing
- `VITE_FIGHTER_CANVAS=expanded`
- privacy, provider, OpenCode or deployment settings

## Acceptance criteria

- `VITE_VISUAL_STYLE=classic` is no longer a supported or documented runtime
  option.
- A normal build and the browser test harness use retro without a style toggle.
- All supported arenas resolve to retro art; no classic fallback path remains.
- P1-P8 retro textures, pose keys, markers, objects and HUD remain available.
- Classic-only tests, scripts and runtime assets are removed or clearly marked
  historical rather than silently skipped.
- Build, unit tests and relevant retro browser tests pass.
- The working tree is clean after commit, the branch is pushed, and the PR
  records the exact verification commands and any non-blocking warnings.

## Risks and checks

- `fighterSprites.ts` currently contains both shared texture-key constants and
  classic drawing; move shared constants before deleting the classic generator.
- Arena manifests currently use classic/retro variants; preserve the manifest
  validation contract for retro-only assets.
- Existing visual evidence and scripts may encode classic baselines; update the
  active matrix and retain historical evidence only with clear labeling.
- Confirm that no classic fallback can be selected through environment,
  constructor defaults, online presentation or URL arena selection.

## Implementation evidence

- Runtime now resolves retro art directly; `VITE_VISUAL_STYLE` and classic
  texture generation are gone from active code.
- Classic station and K-kauppa runtime SVGs were removed. Historical visual
  reports and captures remain labeled as historical where they mention them.
- Retro-only G1 matrix regenerated with six captures and a retro-only manifest.
- Verification completed locally:
  - `npm run build`
  - `npm test -- --run` — 72 files, 621 tests passed
  - `npm run test:browser` — 138 passed; one unrelated online Deathmatch
    movement timing check passed on isolated retry after the full run
  - `npm run visual:matrix` — six retro captures generated
