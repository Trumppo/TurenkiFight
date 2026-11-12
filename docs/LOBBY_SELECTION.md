# Lobby selection: arena, mode, players and character

**Status:** Owner requirement 2026-11-10. L1 arena selection, L2 player count and L3 character selection are
implemented locally; L4 summary is implemented locally as well.
**Related:** [GRAPHICS_ROADMAP.md](GRAPHICS_ROADMAP.md), [GAME_DESIGN.md](GAME_DESIGN.md), [M1_GAMEPLAY_CONTROLS.md](M1_GAMEPLAY_CONTROLS.md).

## 1. The gap

Today a local match is created like this:

- **Mode:** selectable (`MODE` dropdown).
- **Players:** joined by keyboard or gamepad into fixed slots P1-P8; bots can fill.
- **Arena:** only through the URL (`?arena=kkauppa`, `?arena=mesku`). There is no control in the browser.
- **Character:** each slot always uses its own art. P1 is always the same fighter, P2 always the same, and so on.

The owner wants all four decided in the browser before a match: arena, characters, mode and player count.

## 2. Requirement

In the lobby, before starting a match, a player can choose:

1. **Arena** - Turenki station, K-kauppa, Mesku.
2. **Mode** - Score Brawl, Last Man Standing, Deathmatch, Wave.
3. **Player count** - how many slots take part (1-8), with bots filling the rest.
4. **Character per slot** - which of the eight fighters a slot looks like.

The chosen combination is visible as one summary line before the match starts, and the match starts from it.

## 3. Design rules

1. **The simulation keeps its ids.** A slot is always `P1`...`P8` for scoring, protocol, results and replays. A "character" is a **presentation mapping** from slot to one of the eight art sets. Changing a character must not change simulation bytes, hitboxes or balance.
2. **Defaults preserve today's behaviour.** With no choices made, slot `Pn` uses character `n` and the station arena; the game looks exactly as it does now except that retro is the default style.
3. **Choices are local.** Arena, mode and characters are local-lobby choices. Online matches keep the server's `--mode` and arena until an online lobby exists.
4. **One panel.** Arena, mode, players and characters belong to the same pre-match panel; no hidden URL-only options.
5. **Persistence.** Character and arena choices persist in `localStorage` and are reflected in the URL (`?arena=`), so a refresh keeps the setup.
6. **Bots follow the selection.** Bot slots use the characters chosen for their slots; bots do not pick their own.
7. **Readable at 640x360 and 1280x720**, text at least 14 px, no clipping, keyboard-only reachable.

## 4. Slices

### L1 - Arena selector (smallest, unblocks the rest)

- Add an arena select to the lobby panel with the three arenas.
- Selecting an arena updates the backdrop, the URL (`?arena=`) and the arena passed to `createState`, so K-kauppa's hazard applies to the chosen arena.
- Acceptance: switching arena before start changes the backdrop and the simulation arena id; station remains byte-identical when selected; reload keeps the choice.

### L2 - Player count

- A count control (1-8). Slots above the count are inactive and not created in the match state.
- Bots fill the empty active slots when the player chooses; a "bots" toggle or the existing ALL BOTS path stays.
- Acceptance: a 1-player match creates one fighter, an 8-player match eight; results and HUD match the count; no ghost slots.
- Evidence: `docs/LOBBY_L2_PLAYER_COUNT_PLAN.md` and `tests/browser/lobbyPlayerCount.spec.ts`.

### L3 - Character per slot (current work package)

- Each active slot shows its character name and a small preview; cycling changes the appearance only.
- Presentation maps `slot -> characterId`; `fighterKey` uses the mapped character for sprites, and the HUD shows the character name next to the slot.
- Acceptance: P1 can look like P6 and still act as P1 (score, results, replays unchanged); all eight appearances available; choice persists; simulation snapshots and fingerprints unchanged.
- Evidence: `docs/LOBBY_L3_CHARACTER_SELECT_PLAN.md` and `tests/browser/lobbyCharacterSelect.spec.ts`.

### L4 - Summary and start (current work package)

- One summary line: `ARENA · MODE · PLAYERS · BOTS`, plus a start hint.
- Acceptance: the line matches the actual match that starts; changing any control updates it immediately.

Locked format: `ARENA · MODE · PLAYERS · HUMANS · BOTS`; counts report the current joined roster and do not invent bots for empty slots.
Evidence plan: `docs/LOBBY_L4_SUMMARY_PLAN.md`.
Complete menu path: `docs/LOBBY_FLOW.md`.

## 5. Acceptance for the whole feature

1. A player can start a match without touching the URL and without reading documentation.
2. Arena, mode, player count and characters are all visible and changeable in the lobby.
3. Character choice changes appearance only: identical inputs produce identical simulation results and identical state hashes as before.
4. 640x360 and 1280x720 screenshots inspected in retro.
5. Existing keyboard, gamepad, remap and pause behaviour unchanged.

## 6. Out of scope

- New characters or new art; the eight existing fighters are the roster.
- Per-character stats, moves or balance.
- Online lobby sync, character choice on the server, accounts.
- New game modes.

## 7. Risks

- The character mapping can leak into gameplay if it is stored on the fighter instead of the presentation layer; the test suite must prove identical state hashes.
- A crowded lobby panel can push the arena out at 640x360; the panel must stay compact and collapsible.
- Player count and bot filling interact with the Wave rule (humans are players, bots are enemies); the Wave path must be handled explicitly.
