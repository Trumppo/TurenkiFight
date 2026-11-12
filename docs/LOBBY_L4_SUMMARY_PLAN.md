# Lobby L4: setup summary

Status: implemented locally on `graphics/lobby-player-count` (2026-11-11); full verification passed
Dependency: LOBBY-L3-CHARACTER-SELECT
Scope: local lobby presentation and browser QA only

## Goal

Show one trustworthy, live summary of the local match setup before the host
starts the match:

`ARENA · MODE · PLAYERS · HUMANS · BOTS`

The summary presents existing lobby state. It must never create players, infer
missing bots or become a second source of match configuration.

## Locked decisions

- Place the summary directly before `START MATCH` in the local lobby action panel.
- `PLAYERS` is the selected active-slot count, not merely the number currently joined.
- `HUMANS` counts joined non-bot fighters; `BOTS` counts joined bot fighters.
- Empty active slots are not silently counted as bots.
- Wave uses the same counts; its existing human/player and bot/enemy explanation
  remains the authoritative team rule.
- Arena uses the selected display name and mode uses the existing mode label.
- The summary is hidden outside the lobby because match/results HUD already has
  phase-specific status and roster presentation.

## Implementation slices

1. Add an accessible summary element immediately before the start button.
2. Derive its text from `arenaSelection`, `selectedMode`,
   `selectedPlayerCount`, `state.fighters` and `botSlots`.
3. Render it on every HUD update and synchronize it with arena, mode,
   player-count, join, bot, reset and Wave changes.
4. Keep the text compact and readable at 640x360 and 1280x720.
5. Add browser coverage for empty lobby, joined humans/bots, all-bot mode,
   Wave, arena/mode/player-count changes and reset/reload.
6. Record evidence in the lobby specification and task queue.
7. Keep the complete numbered browser-to-results flow in
   `docs/LOBBY_FLOW.md` as the shared project reference.

## Acceptance

- Summary appears before START MATCH in the lobby.
- It shows the selected arena, mode and player count.
- It shows current human and bot counts without inventing unclaimed slots.
- It updates immediately when any lobby selection, join, bot or reset action changes.
- Wave retains the human/enemy rule and reports the same roster counts.
- It is hidden or phase-appropriate outside the lobby.
- Existing character, player-count, arena, mode, keyboard, gamepad, bot,
  online, retro and results tests remain green.
- Build, all Vitest tests, all Playwright tests and `git diff --check` pass.

## Verification evidence

- `npm run build`: passed.
- `npm test -- --run`: 72 files / 621 tests passed.
- `npm run test:browser`: 146 passed, 2 skipped.
- `tests/browser/lobbySummary.spec.ts`: 2 passed.
- `git diff --check`: passed.

## Non-goals and safety

- No simulation, protocol, replay, server or online-lobby changes.
- No new lobby controls beyond the summary.
- No automatic bot filling; the summary reports actual current roster state.
- No classic visual mode or mobile-specific feature work.
