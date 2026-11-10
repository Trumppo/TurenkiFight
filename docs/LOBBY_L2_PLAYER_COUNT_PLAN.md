# Lobby L2: player count

Status: implemented locally on `graphics/lobby-player-count` (2026-11-11); full verification passed
Dependency: LOBBY-L1-ARENA-SELECT / PR #196
Scope: local lobby presentation and roster wiring only

## Goal

Let the local lobby choose an active roster size from 1 to 8. The chosen
count controls which player slots may exist in the local match. Simulation
identities remain the stable `P1`...`P8` ids; no protocol, replay or combat
rule changes are intended.

## Decisions

- P1 is always active in the lobby.
- A non-Wave match may start with one fighter when the selected count is 1.
- `ALL BOTS` fills exactly the selected count, including P1 as the existing
  bot-driven host slot.
- Lowering the count removes joined players, bots, gamepad assignments and
  reclaim state above the selected range; it must not leave ghost fighters.
- Slots above the selected count are disabled in the lobby and are absent from
  the started `GameState` and results.
- Wave mode requires at least one human and one enemy. Selecting count 1 in
  Wave is invalid and is explained in the lobby instead of being silently
  changed.
- Arena and mode choices remain intact while the player count changes.
- The player count is persisted in local storage and reflected in the current
  lobby UI. Existing arena URL persistence remains unchanged.
- Character selection is out of scope; each slot keeps its existing retro look.

## Implementation slices

1. Add an accessible `PLAYERS` control to the lobby and a typed count value in
   the presentation state.
2. Route the count through lobby state creation, joinable-slot selection,
   keyboard/gamepad joins, bot add/remove, `ALL BOTS`, reset and match start.
3. Keep inactive HUD slot controls disabled and ensure no inactive slot enters
   `createState`.
4. Add the Wave validation message and preserve the existing human/enemy team
   split for valid counts.
5. Add browser regression coverage for one, four and eight players, count
   changes, bot filling, reset/reload and Wave validation.
6. Update the lobby specification with implementation evidence.

## Implementation evidence

- `index.html` exposes an accessible 1–8 player selector beside the arena selector.
- `StationScene` persists the selection, constrains keyboard/gamepad/bot joins, filters
  out-of-range roster and controller state, and keeps arena/mode selection intact.
- `ALL BOTS` fills exactly the selected active slots; non-Wave matches with count 1 can start.
- Wave count 1 remains blocked with an explicit human-plus-bot explanation.
- Inactive HUD slots are hidden, so they cannot be mistaken for match participants.
- `tests/browser/lobbyPlayerCount.spec.ts` covers persistence, one-player start,
  exact four-slot all-bot fill and Wave validation.

## Acceptance criteria

- Count 1 starts exactly one fighter; counts 4 and 8 cap the active roster and
  create exactly that size when the selected slots are joined or filled by bots.
- Counts between them obey the same upper-bound rule.
- `ALL BOTS` creates exactly the selected number of fighters.
- Reducing the count removes out-of-range humans, bots and device ownership.
- Results and HUD contain no inactive slots.
- A one-player non-Wave match starts and runs without a second fighter.
- Wave count 1 is rejected with a readable reason; valid Wave counts retain a
  human and enemy side.
- Reload preserves the count; arena and mode selections remain unchanged.
- Existing gamepad, keyboard remap, reset, arena, mode and online tests remain
  green.
- `npm run build`, `npm test -- --run`, `npm run test:browser` and
  `git diff --check` pass.

Verification: build passed; Vitest 72 files / 621 tests passed; Playwright 142
passed / 2 skipped; `git diff --check` passed.

## Non-goals and safety

- Do not modify `src/game/simulation/`, protocol codecs, server behaviour,
  replay formats or balance rules.
- Do not add characters or change retro art.
- Do not merge or alter the already-open PR #196.
- Keep the work on a separate branch and record all verification commands.

## Risks

- Existing join logic is event-driven, so lowering the count must clean gamepad
  ownership and bot sets as well as the visible state.
- `ALL BOTS` and Wave mode have different human/enemy semantics; both need
  explicit tests.
- A one-player start is a local-lobby rule and must not accidentally alter
  deterministic state serialization for the existing two-to-eight-player
  cases.
