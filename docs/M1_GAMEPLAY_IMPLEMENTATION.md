# M1 Gameplay implementation specification — Score Brawl

**Status:** Approved design for implementation, not a claim of implemented functionality.  
**Owner:** gameplay implementation session.  
**Baseline:** `main` after visual PR #1, Phaser 3 / TypeScript / Vite, 384×216.  
**Related:** [Game design](GAME_DESIGN.md), [Roadmap](ROADMAP.md), [Visual integration](visual/IMPLEMENTATION.md).

## Objective and boundaries

Deliver a fully playable **four-local-player, 120-second Score Brawl** at Turenki station, including keyboard/gamepad joining, three attacks, deterministic combat, knockout/respawn, results and rematch. Player count is configured from the joined roster, not baked into simulation. Support testing at eight players later; no arbitrary four-player engine limit.

Do not implement networking or choose WebSocket/WebRTC in M1. No graphics overhaul. Keep existing art integration working. No direct commits to `main`: create `feature/m1-gameplay`, open a PR and await review.

## Existing code and gaps

- `src/game/simulation/types.ts`: `PlayerInput` has one generic `attack` boolean; `GameState` only has tick/fighters.
- `src/game/simulation/step.ts`: `createState()` hardcodes P1/P2; movement and Z jumping work; one generic attack awards +100; KO instantly heals and teleports, without a mode; tick transition does not mutate its argument.
- `src/game/presentation/StationScene.ts`: two keyboard input mappings, generated sprites, scores and a **presentation-only 180 s countdown**. This must become a view of the authoritative 120 s match clock.
- `src/game/presentation/fighterSprites.ts`: idle, walk, depth, punch, kick, jump, jumpkick, hit, ko and respawn poses exist for P1–P8. Some poses are not connected to gameplay events.
- Existing unit tests cover only basic determinism, movement and bounds.

## Simulation contract

Implement a pure `step(state, inputs): GameState` that advances **exactly one 60 Hz tick**; no `Date.now`, `Math.random`, Phaser APIs, browser inputs or network calls in simulation/mode code. If randomness becomes necessary, use explicit seeded state. Preserve immutability of input state and stable iteration order (joined roster order, then player ID for ties). Use integer ticks for all gameplay durations and avoid frame-time-dependent outcomes.

Recommended structure (names may adapt without changing contracts):

```text
src/game/
  simulation/
    types.ts           # input, fighter, match, events, state
    step.ts            # one deterministic tick
    combat.ts          # attacks and hit validation
    movement.ts        # X/Y and Z physics
    spawns.ts          # deterministic spawn selection
  modes/
    GameMode.ts        # rules interface / mode events
    ScoreBrawlMode.ts  # score, KO, timer, ranking
  input/
    localPlayers.ts    # joined local slots, device assignment
    keyboard.ts
    gamepads.ts
  presentation/
    StationScene.ts    # renders simulation state and event cues
```

The above is a target decomposition, not a requirement to over-engineer. Keep combat/movement independent of mode-specific scoring. The mode consumes a stable event stream, for example `HitLanded`, `Knockout`, `Respawned`, `MatchStarted`, `MatchEnded`, and updates match state. Events must be deterministically ordered, carry event tick and player IDs, and must not be emitted twice.

### Inputs

Replace ambiguous generic attack with explicit **punch, kick and jump-kick** commands; keep jump as a separate control. Normalize keyboard/gamepad events into an input frame per joined player, including neutral input for missing/disconnected controllers. Button presses should be edge-triggered where appropriate, so holding a key does not auto-retrigger attacks unless deliberately designed. Do not allow two players to claim the same exclusive gamepad.

Allow 2–4 joined local players in M1; one-player practice is optional. Default controls for existing P1 and P2 should continue to work. Provide a documented workable P3/P4 setup using gamepads; do not assume four players can comfortably share one keyboard. The browser Gamepad API is polled by the input adapter, not the simulation. Show controller slot and joining feedback.

### Locked M1 lobby and join decisions (2026-10-24)

These decisions supersede any ambiguous lobby implementation assumptions:

1. **Explicit join:** A player joins only by pressing a designated **Join** button/key on their own input device while the lobby is open. Merely connecting or detecting a gamepad does not automatically reserve a player slot. Show immediate feedback with assigned P1–P4 slot and device.
2. **P1 host starts:** Only the player occupying **P1** can activate **Start match**. The control is disabled until at least two players have joined. Other players cannot start the countdown. Start triggers the existing 180-tick countdown, then the 7200-tick fight.
3. **No ready state:** M1 has **no per-player Ready / Not ready toggle**, indicator or all-ready gate. Joined players are eligible to start immediately once the P1 host starts.
4. **Stable assignment:** Preserve one exclusive gamepad per joined slot, maintain existing workable keyboard mappings, and prevent accidental duplicate joins from held inputs. A disconnected controller produces neutral gameplay input and does not silently reassign the slot.
5. **Rematch:** Keep the joined player roster and P1 host assignment for rematches. Returning to lobby permits a fresh join flow.

**Implementation coordination:** This clarification belongs to the existing `M1-GAMEPLAY` task; it is not a separate task or permission to modify graphics-session files. The gameplay agent should reconcile its current branch with this specification before final PR review, without discarding work already in progress.

**Focused acceptance checks:** Controller detection alone never joins; a Join press creates one slot; P2–P4 cannot start; P1 cannot start with fewer than two players; P1 can start with 2–4 players; no ready flags are required; rematch retains assignments.

### Fighter state and movement

Track ground-plane `x,y`, jump height `z`, vertical velocity, facing, health, current attack phase, hitstun, KO state, respawn timer, protection timer and per-attack target-hit set. Logical arena bounds are configurable and independent of rendered sprites. Preserve existing Y-depth sorting, ground shadows and Z-offset display.

Jump is permitted only when grounded and alive. Normalize diagonal X/Y input so diagonal movement is not faster than cardinal movement. Dead/respawning fighters cannot attack or receive damage. Invulnerability ends when the protected player starts an attack. Prevent overlapping respawn positions where possible; choose deterministically.

### Combat

Implement separate move definitions for punch, kick, jump kick with **startup → active → recovery** phases, logical hitboxes/hurtboxes and lane/depth tolerance. A move hits each target at most once during its active window. Facing matters. Jumps use logical Z overlap, not sprite collision. Attacks cannot start while KO, stunned, in recovery or otherwise ineligible.

Initial suggested move data (balance values are provisional and should be centralized, not spread across files):

| Move | Startup ticks | Active ticks | Recovery ticks | Damage | Hit score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Punch | 4 | 5 | 12 | 10 | 100 |
| Kick | 7 | 6 | 16 | 15 | 150 |
| Jump kick | 6 | 7 | 18 | 20 | 200 |

Use separate reach and depth tolerances per move; calibrate in playtesting. Jump kick requires airborne state; punch/kick may be ground-only for M1. Ensure simultaneous hits are resolved deterministically: collect eligible hits from the pre-resolution combat snapshot, order by attacker/target ID, then apply effects. Document how mutual KO and multiple finishers resolve (recommended: deterministic event order, first lethal credited, never two KO credits for one victim). No blocking or dodge required in M1.

### Score Brawl rules

- **Match clock:** 120 s = 7200 active fight ticks at 60 Hz. 3 s = 180-tick pre-fight countdown. Pausing is not required in M1.
- **Phases:** lobby → countdown → fighting → results → rematch/lobby.
- Punch hit **+100**, kick hit **+150**, jump-kick hit **+200**.
- Finishing attacker **+500** for KO. Knocked-out fighter **−200** (negative total score is allowed).
- Respawn delay **180 ticks** (3 s). Respawn protection **90 ticks** (1.5 s), canceled by attacking.
- Scoring and damage occur only in the fighting phase. At time zero, no new hits or KOs count; transition once to results.
- Rank by score, then number of KOs, then fewer hits received; exact tie is a draw (shared rank). Results must not depend on join order.
- KO must be observable as a state/animation, not instant heal/teleport.
- If all players are simultaneously KO, the clock continues; respawns remain scheduled.
- A disconnected gamepad yields neutral input; it must not break the match. Player stays joined for M1.

Separate match-specific counters (`koCount`, `hitsReceived`) from fighter physics state where practical. All gameplay timing is based on ticks. Rendering only reads `remainingTicks` and phase; delete presentation-owned `elapsedRound` and 180 s timer.

### Presentation integration

Reuse `StationScene`, `fighterSprites`, `visualTheme` and station SVG. Drive pose from explicit simulation state/events: punch/kick/jumpkick/hit/ko/respawn. Display joined player IDs, scores, countdown, 02:00 match clock, KO/respawn feedback, standings and rematch controls. Keep game view legible at 384×216 and check 2×/3× scaling. Do not silently remove current two-player keyboard functionality. UI can be modest but must be readable.

### Locked M1 HUD layout (2026-10-24)

The following are **approved design decisions**, superseding any alternative HUD mockups:

- **Layout:** All joined player panels appear in **one horizontal top row**, ordered by player slot P1–P4. Do not use four-corner placement. For 2–3 joined players, show only active slots while preserving clear alignment.
- **Health:** Display health as a numeric **`HP <value>`** field, not a health bar. Use authoritative fighter health; clamp the displayed value to the simulation's valid range and make KO state obvious.
- **Score:** Show each player's **live score throughout the match**, including negative values. Scores must come from the authoritative match state and remain visible in the fighting phase.
- **Timer:** Keep the authoritative match clock visually prominent and legible; show `02:00` at the start of fighting and do not decrement during the 3-second countdown.
- **384×216 constraint:** Reserve a compact, consistent top HUD strip (suggested target height 28–34 internal pixels). Four panels must fit across 384 internal pixels without horizontal scrolling, clipping, or covering each other. Use high-contrast, readable pixel-aligned text, slot color plus explicit P1/P2/P3/P4 labels, and check both native scale and 2×/3× display scaling. Avoid obscuring fighters or the center of the arena. Exact font size and spacing may be tuned during visual QA; correctness and legibility are acceptance criteria.
- **Events:** KO/respawn effects and other feedback must not hide the top-row HP, scores or timer. Presentation reads state; it never calculates health, scores or clock.

**Coordination:** HUD wiring in `StationScene.ts` and related gameplay presentation belongs to the existing `M1-GAMEPLAY` task. Graphics-session's parallel `M1-VISUAL-POLISH` must not edit `StationScene.ts` or HUD; `M1-VISUAL-QA` may refine visuals after gameplay integration. Gameplay agent should incorporate these locked decisions when reconciling its feature branch, without discarding existing implementation work.

**HUD acceptance checks:** With 2, 3 and 4 players, the top-row panels show correct slot labels, numeric HP and live scores; the clock shows 02:00 at fight start; no panels overlap or clip at 384×216; negative scores, KO/respawn and rematch state remain correct.

## Acceptance tests (automated)

1. Same initial state + same per-tick inputs over >=7200 ticks produces byte-equivalent normalized state and event checksum on repeated runs; original state and inputs are never mutated.
2. Joining 2, 3 and 4 players creates exactly those fighters, with unique IDs and deterministic non-overlapping initial spawns. No hardcoded P1/P2 assumptions.
3. Cardinal and diagonal movement speeds are consistent; arena bounds and Z landing work.
4. Punch/kick/jumpkick validate startup/active/recovery, facing, lane and Z; no double-hit per attack/target; cooldown and stun block invalid attacks.
5. All scoring values, KO credit, -200 victim penalty, respawn delay and protection are exact.
6. Clock stays at 120 s during countdown; fighting lasts exactly 7200 ticks; final tick scoring boundary is unambiguous; no scoring after results.
7. Tie breakers, exact draws, mutual hits and multiple attackers are deterministic.
8. Gamepad disconnect becomes neutral input and does not crash.
9. `npm test`, `npm run build` and `npm run test:browser` pass; Playwright confirms a canvas, four joined player indicators, visible 02:00 timer, and results after a deterministic accelerated test path (do not wait two real minutes in CI).
10. Production build works under GitHub Pages `/TurenkiFight/` subpath; assets load and no browser console errors occur.

Prefer focused Vitest unit tests for simulation, mode and controls; use Playwright only for integration/browser behavior. Add scripted match replay fixtures for regressions.

## Implementation sequence and review gates

**G1 – Core state and four-player setup:** generalized roster, input contract, deterministic spawns, local device slots, tests. Existing two-player flow still works.

**G2 – Combat:** three moves, hitboxes, KO and respawn states, deterministic event ordering and unit tests.

**G3 – Score Brawl:** phases, authoritative 120 s clock, scoring, standings, results, rematch, tests.

**G4 – Phaser integration:** controller joins, animations/HUD, visual feedback, browser smoke test.

**G5 – Validation:** full CI, browser playthrough with four controllers where available, production Pages path, documented limitations. Open PR; do not merge without approval.

## Non-goals

Networking, rollback, WebSocket/WebRTC selection, matchmaking, teams, sophisticated AI, finalized character art, final balance, full accessibility redesign, production anti-cheat. Keep extension points for later milestones.

## Delivery from implementation session

Provide PR URL, commits, changed files, unit/browser test evidence, four-player control instructions, gameplay recording/screenshots if feasible, known limitations and explicit recommendation whether M1 can be accepted. Update roadmap checkboxes only for independently verified work. Do not mark M1 done on the basis of compile-only success.
