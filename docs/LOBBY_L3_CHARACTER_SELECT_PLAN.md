# Lobby L3: character selection

Status: implemented locally on `graphics/lobby-player-count` (2026-11-11); full verification passed
Dependency: LOBBY-L2-PLAYER-COUNT and the retro-only visual decision
Scope: local lobby presentation and persistence only

## Goal

Let every active local slot P1-P8 choose which of the eight existing retro
fighters it displays, without changing the simulation identity of the slot.

## Decisions

- A slot keeps its stable simulation id (`P1`...`P8`) for input, scoring,
  results, replay and protocol state.
- The default mapping is identity: P1 looks like P1, P2 like P2, and so on.
- A character choice is a presentation mapping used only when resolving sprite
  texture keys; it is never stored on `Fighter` or serialized into `GameState`.
- Only active lobby slots expose an editable character selector.
- Choices persist in localStorage and are restored safely; invalid or missing
  values fall back to the identity mapping.
- The selector is disabled outside the lobby and count-restricted slots stay
  hidden, preserving the L2 roster boundary.
- Retro is the only supported visual style. Classic-mode acceptance language is
  intentionally removed.

## Implementation slices

1. Add a typed slot-to-character presentation map with safe localStorage load/save.
2. Add an accessible character selector to each HUD slot and show the selected
   character name in the lobby.
3. Resolve all retro sprite textures through the mapping while leaving markers,
   input, simulation ids and results keyed by the original slot id.
4. Re-render immediately on selection and preserve choices across reset and reload.
5. Add browser coverage for P1→P6 remapping, all eight looks, persistence,
   count-limited slots and state-hash invariance.
6. Update task and lobby documentation with verification evidence.

## Acceptance

- Each active slot can select any of P1-P8.
- P1 can look like P6 while state, input ownership, score and results still say P1.
- All eight selected looks resolve to non-empty, distinct retro textures.
- Choices persist across reload and reset without changing arena or mode.
- Inactive player-count slots expose no selector and do not enter match state.
- Identical simulation inputs produce identical state fingerprints before and
  after a presentation-only character remap.
- Existing keyboard, gamepad, bot, arena, mode, online and retro tests remain green.
- Build, all Vitest tests, all Playwright tests and `git diff --check` pass.

## Verification evidence

- `npm run build`: passed.
- `npm test -- --run`: 72 files / 621 tests passed.
- `npm run test:browser`: 143 passed, 2 skipped; the one unrelated online
  Deathmatch movement timing failure was rerun in isolation and passed.
- `git diff --check`: passed.

## Non-goals and safety

- No new art, character stats, hitboxes, moves or balance changes.
- No simulation, protocol, replay, server or online-lobby changes.
- No classic rendering path.
- No merge or force-push; commit and ordinary branch push only after all checks.

## Risks

- Passing a mapped character id into input or simulation code would violate the
  presentation boundary; tests must inspect both rendered texture and state ids.
- Eight selectors can crowd the 640x360 lobby; controls must remain keyboard
  reachable and use the existing compact HUD layout.
