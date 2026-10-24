# TurenkiFight — configurable, data-driven game architecture

**Status:** Approved cross-milestone architecture principle (2026-10-24). Applies to M1 work and later milestones, but does not expand the current M1 feature scope.

## Principle

**No content-specific hardcoding in gameplay logic.** Graphics, character sprites, animation assets and mappings, stages, props, music, sound effects, UI theme, render resolution, controls and balance values must be replaceable through configuration, asset manifests or declarative data without modifying the core deterministic simulation. Content additions should not require editing long switch statements or copying gameplay implementations.

This is a separation-of-concerns requirement, **not** a promise that entirely new mechanics can be invented without code. New mechanics may need new simulation systems, but changing existing assets and tuning existing mechanics must not.

## Architectural boundaries

1. **Deterministic simulation / modes:** world coordinates, inputs, combat, state transitions, scoring and ordered events. No Phaser, DOM, audio playback, asset paths, renderer dimensions or wall-clock dependencies. Fixed-tick, reproducible behavior.
2. **Declarative game data:** versioned, typed character definitions, attack profiles, arena definitions, object definitions, audio/event mappings, input profiles, and ruleset settings. Centralized defaults and validation, no scattered magic constants.
3. **Presentation adapters:** Phaser scene, camera, renderer, sprite and animation registry, HUD, audio manager, visual effects. These translate simulation state/events to visuals and sounds, never decide combat outcomes.
4. **Asset manifests:** stable logical asset IDs resolve to paths/URLs and metadata. No hardcoded filename assumptions in simulation. Asset replacement or new cosmetic variants should be a data/asset change.

## Configurable components

| Area | Configurable without simulation edits | Stable interface |
| --- | --- | --- |
| Render resolution / scaling | Internal resolution, scale mode, camera projection, UI layout | World-space camera framing unchanged |
| Fighters | Character IDs, names, shirt/trouser palettes, sprite sheets, poses, portraits, cosmetics | Player ID separate from character ID; preserve pose contract |
| Animation | Frames, timing, sprite offsets, visual event mappings | Logical attack phases and simulation tick timing remain authoritative |
| Arenas | Background/foreground layers, art, visual props, theme | Logical arena bounds/spawns are explicit data, not inferred from image dimensions |
| Interactive objects (future) | Object types, visuals, damage/throw profiles and sound mappings | Typed object events and deterministic interactions once implemented |
| Audio | Music tracks, loops, volume, hit/KO/UI sounds, event-to-sound mappings | Audio is presentation-only; gameplay works muted |
| UI/HUD | Colors, labels, fonts, spacing, layout and localization-ready text | Reads authoritative score, HP and timer |
| Input | Key/gamepad mappings and join/start bindings | Normalized logical actions; P1 host rule stays in lobby controller |
| Rules and balance | Move parameters, scoring, timers, KO/respawn settings | Typed ruleset consumed by deterministic mode; changes intentionally affect gameplay but require no algorithm rewrite |

## Implementation guidance

- Prefer simple TypeScript typed configuration objects and manifests for M1; introduce JSON schema/external data files only when useful. Do not build a general plugin engine or content editor prematurely.
- Keep explicit schemas/interfaces, defaults, validation, stable IDs and clear ownership. Validate missing assets and unknown IDs with helpful errors or deliberate fallbacks.
- Avoid hardcoded asset paths, dimensions, per-character switch cases, stage-specific collision assumptions and audio calls inside simulation.
- Store rendering configuration separately from world geometry. The M1 default is 640×360, with the same camera framing at 960×540 and other future 16:9 resolutions.
- Define animation keys as a stable contract; allow asset substitutions without renaming keys or breaking existing scene integrations.
- Allow running headless deterministic simulation with no graphics or sound loaded.
- Avoid overengineering: one clear configuration entry point and a small number of typed registries is preferable to a speculative extensibility framework.

## Verification / acceptance

1. Replace a fighter's shirt/trouser palette or sprite resource by changing only character/asset configuration.
2. Replace station background art through the asset manifest without changing combat or scoring.
3. Replace a music track or mute all audio without changing simulation output.
4. Change internal render resolution 640×360 → 960×540 in presentation configuration without changes to world physics, collision, scoring or camera coverage.
5. Adjust existing move damage, match length or score awards in centralized ruleset data, with deterministic tests showing the expected changed outcomes.
6. Missing/invalid configuration produces an explicit validation error or documented fallback, not silent undefined behavior.
7. Unit and browser tests confirm that presentation asset changes do not change deterministic simulation replay results.

## Agent ownership and rollout

- **Planning session:** architecture decisions, content contracts, future backlog and acceptance criteria.
- **M1-GAMEPLAY:** preserve simulation/presentation separation; own scene, camera, HUD, input and rules configuration. Adopt these principles when touching relevant code, but do not expand M1 to interactive objects or a full asset pipeline.
- **M1-VISUAL-POLISH:** own station art, sprite generation and visual theme within the existing agreed file scope. Preserve existing pose keys and public APIs; do not edit `StationScene.ts` or gameplay simulation.
- **M1-VISUAL-QA:** review visual configuration and asset swaps after gameplay integration.
- **Future work:** generalized asset registry, external content packs, audio customization, interactive objects and editor tooling can be scoped as separate tasks.

The goal is **low-cost future replacement and extension**, not absolute zero code changes for novel gameplay systems.
