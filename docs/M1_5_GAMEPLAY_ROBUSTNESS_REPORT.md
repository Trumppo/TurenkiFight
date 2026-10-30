# M1.5 Gameplay Robustness Report

Task: M1.5-GAMEPLAY-ROBUSTNESS
Branch: `feature/m1-5-gameplay-robustness`

## Baseline and compatibility

Read `docs/M1_GAMEPLAY_IMPLEMENTATION.md`, `docs/M1_GAMEPLAY_QA.md`, existing M1 unit tests, `tests/gameplay-qa.test.ts` and current pure `src/game/simulation/step.ts`. M1 accepted: 60 Hz, countdown 180 ticks, fight 7200 ticks, punch/kick/jumpkick scoring, 180-tick KO delay, 90-tick protection. No changes to rules, simulation, presentation or visual files.

## Reproduction: deterministic seeds

- `npm test -- tests/m1-5-robustness.test.ts` (or `npm test`).
- Seeds: integer sequence `1..1000`, xorshift32 (unsigned 32-bit, shifts 13,17,5), four fighters `P1..P4`, 72 active ticks per seed. Each case runs **twice**, compares entire final `GameState` and SHA-256 of ordered event stream + terminal state.
- Full-length reproducibility: seeds `1`, `42`, `20261030` with 7200 active ticks, each replayed twice; asserts exact ending tick, phase, remaining time and checksum.
- These are **1,000 seeded match segments** (plus three full 120-second replays), not 1,000 complete 120-second matches. This distinction is intentional and should be reviewed against the requested acceptance criterion.
- Other deterministic tests: simultaneous four-fighter attacks and KO credit, state immutability, respawn/protection windows, 180-tick countdown + 7200-tick match, device-agnostic normalized inputs.
- Graphical assets, Phaser, browser time, wall-clock and random global state are absent from these tests.

## InputFrame / bot-ready contract

There is **no currently exported type named `InputFrame`**. The existing `PlayerInput` is the normalized per-player frame accepted by `step(state, inputs: PlayerInput[]): GameState`:

```ts
type PlayerInput = {
  playerId: string;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  jump: boolean;
  punch?: boolean;
  kick?: boolean;
  jumpkick?: boolean;
  attack?: boolean; // backward-compatible alias for punch
};
```

A future AI bot, replay/test client, or network client may construct this same data for each 60 Hz simulation tick. The simulator needs no knowledge of physical input source. Omitted/disconnected input is neutral on that tick; client adapters must handle device joining, authority, edge-triggering when needed, and player ID assignment. `step` tracks previous buttons to avoid repeating held attacks. No bot, network protocol or mode added.

## Findings and gaps

- Existing `PlayerInput[]` boundary is sufficient; no changes to core game code are needed.
- Existing `tests/browser/lobby.spec.ts`, `four-player.spec.ts` and `p1-gamepad-start.spec.ts` exercise explicit joining, four players, host-only start, simulated disconnect/reconnect and rematch; hardware gamepads remain unverified.
- The 1000-case campaign covers 72-tick active segments rather than 1000 full 7200-tick games; if full-match interpretation is mandatory, extend harness before approving.
- No new game balance values or M1 rules were modified.

## Verification

Run `npm test`, `npm run build`, `npm run test:browser` via GitHub Actions on the PR. CI status must be checked on the final commit; do not claim PASS before that. Manual physical-controller verification remains an open limitation.
