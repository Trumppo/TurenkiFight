# M1 Visual QA — integrated gameplay and graphics

**Status:** Ready for graphics-session after M1-GAMEPLAY and M1-VISUAL-POLISH merges. This checklist is not a claim that manual QA has passed.

## Scope and acceptance evidence

1. Launch integrated current `main` in desktop browser. Verify 2, 3 and 4 fighters simultaneously with distinct identities/colors, readable outlines and shadows, and no visual overlap that hides player state.
2. Confirm the **640×360** internal render target, top-row P1–P4 numeric HP and live scores, readable 02:00 clock, countdown and results. Verify negative scores and KO/respawn feedback.
3. Check attacks (punch/kick/jumpkick), walking, hit, KO, respawn, invulnerability and pose transitions; compare actual simulation events with shown animation cues. No gameplay changes from purely cosmetic swaps.
4. Check station recognizability and composition: TURENKI sign, foreground/background layers, platform and ground plane; ensure the combat area is unobstructed.
5. Verify sharp nearest-neighbor rendering at native, 2×, 3× and responsive mobile fit; preserve 16:9 aspect without stretching. Confirm 960×540 **configuration-only** render uses the same camera framing and simulation replay results; record any blockers.
6. Build/test: `npm test`, `npm run build`, relevant Playwright browser tests. Review CI. Verify production GitHub Pages subpath, asset loading and browser console (no missing textures/audio/404).
7. Exercise keyboard and available physical gamepads; record which device/browser combinations were actually tested, rather than claiming untested hardware passed.
8. Document screenshots or observations, exact commands/results, remaining bugs, and whether each criterion passed, failed or could not be verified.

## Ownership

Graphics-session may adjust `public/assets/`, `src/game/presentation/` and `docs/visual/` on `feature/m1-visual-qa`. Avoid simulation, input and modes. If a defect requires gameplay changes, report it and coordinate a separate gameplay fix. Keep data-driven asset contracts and 640×360 configuration separation intact. Submit a PR for review; do not merge without explicit user approval.

After visual QA is merged, planning-session performs independent M1-ACCEPTANCE, checks evidence and requests explicit milestone sign-off.
