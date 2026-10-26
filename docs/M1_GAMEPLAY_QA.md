# M1-GAMEPLAY-QA — deterministic gameplay and input regression

**Owner:** `gameplay-session`  
**Priority:** P0  
**Depends on:** merged M1-GAMEPLAY  
**Implementation branch:** `feature/m1-gameplay-qa`  
**Parallel task:** M1-VISUAL-QA (graphics-session)

## Objective

Independently review, test and correct the M1 Score Brawl simulation, mode rules and player input edge cases. Do not expand M1 feature scope. Preserve the existing 60 Hz deterministic contract, 120-second match, host-only start, explicit join, three attacks, KO/respawn and score semantics.

## Exclusive editing boundary

**May modify:** `src/game/simulation/`, `src/game/modes/`, `src/game/input/`, and relevant `tests/`. Add regression tests within existing test structure. Any documentation of QA results belongs in this specification or a separate `docs/M1_GAMEPLAY_QA_RESULTS.md` (not in `docs/visual/`).

**Must not modify:** `src/game/presentation/` (including `StationScene.ts`, HUD, camera, sprite mappings), `public/assets/`, `docs/visual/`, or graphics-agent branches. Do not alter rendering, audio or asset manifests. If a defect needs changes outside scope, record a reproducible issue and coordinate with planning/graphics rather than editing their files.

## Test matrix

1. **Deterministic replay:** fixed initial state and tick-indexed inputs yield identical full state/fingerprint on repeated runs; verify immutability of input and previous state; cover 60 Hz boundaries, attack state progression and exact 120-second terminal tick. No wall-clock, random or presentation dependency.
2. **Combat concurrency:** simultaneous hits, mutual KO, competing scores, overlapping hitboxes, hit cooldown/de-duplication, attack startup/active/recovery transitions, hit stun, knockback, airborne jumpkick and boundary interactions. Assert outcomes and tie-breaking rather than assuming unspecified behavior.
3. **KO and match lifecycle:** score attribution, KO delay, spawn selection, invulnerability window, prevention of repeated KO scoring, late KO at time expiry, results ordering/ties, rematch reset and retained lobby roster.
4. **Input/lobby:** join only on explicit button/key, no auto-join on controller connection, P1 host-only start with >=2 joined, unique controller assignment, held-key/button edge-triggering, repeated joins, disconnect/reconnect, unavailable gamepad, rematch inputs and keyboard/gamepad coexistence. Where browser hardware cannot be emulated, document manual verification gaps.
5. **Scalability:** unit-test core simulation with more than four logical fighters (e.g. eight) if supported by current types/config. Keep M1 presentation limited to four; identify any core hardcoded cap rather than changing UI.
6. **Arena decoupling:** simulation and rules must not read visual assets, Phaser state, pixel sizes or `arenaId`-specific branches. Test that changing purely visual config cannot affect deterministic simulation (or demonstrate architecture-level separation with tests if visuals are never passed into simulation). Typed logical geometry may affect movement intentionally; do not introduce a new stage implementation.
7. **Regression:** `npm test`, `npm run build`, relevant Playwright tests and CI. Add focused failing tests before fixes when practical; keep corrections minimal and backward compatible.

## Evidence and completion

Record each scenario as PASS / FAIL / NOT VERIFIED with command, expected and observed behavior, relevant test file and commit. State explicitly which browser/gamepad cases were not tested. Include a summary of discovered bugs and fixes, any outstanding issues and whether all automated checks passed.

Follow `docs/AGENT_WORKFLOW.md`: after this preparation PR merges, claim the `ready` task in a **separate claim PR**, wait for its merge, then create implementation branch from current `main`. Open implementation PR with exact line `Task: M1-GAMEPLAY-QA`. Never merge your own implementation PR without user approval. Coordinate `.github/AGENT_TASKS.yaml` metadata edits to avoid concurrent updates.

**Non-goals:** network multiplayer, enemy AI, scrolling stages, new game modes, visual redesign, audio, balance overhaul, and any new post-M1 beat-'em-up mechanics.
