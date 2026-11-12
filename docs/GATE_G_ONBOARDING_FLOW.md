# Gate G playtest prerequisite: start screen, lobby and player identity

**Status:** Owner-requested scope, refined and approved in this session on
2026-11-12. Implementation has not started; task slices below are plans, not
claims about shipped behaviour. This work prepares the experience for Gate G
but does not constitute Gate G playtest or acceptance.

## Owner direction recorded 2026-11-12

- A fresh browser load shows a retro title/start screen before the game lobby.
- A user activation leaves the start screen for a main menu with **LOCAL FIGHT**,
  **CREATE ROOM**, and **JOIN ROOM** paths.
- The start screen may have a new retro splash image before Gate G. This is a
  narrow, explicit exception to the prior deferral of new graphics; it does not
  authorize other arena/art overhauls.
- Local and online players must join, choose their player identity, and set
  READY before the host can start.
- Player display names may replace P1/P2 in prominent labels, while slot IDs
  P1-P8 remain stable internal identities.
- For each player slot, the player can choose which existing retro character
  art it uses. Character selection remains presentation-only.
- Use the existing procedural chiptune; no new music composition is approved.
  Browser audio is gesture-gated: the first activation must unlock/start audio
  and proceed to the menu. Do not claim reliable sound before that gesture.

## Proposed end-user flow

1. **Start screen:** retro splash/title, game title and a concise “PRESS ANY
   BUTTON” prompt. It is a presentation state; no match starts here.
2. **Main menu:** LOCAL FIGHT, CREATE ROOM, JOIN ROOM. Keyboard, pointer and
   gamepad activation are the proposed supported ways to continue; exact
   keyboard/gamepad event mapping is implementation detail, not a new gameplay
   control.
3. **Local setup lobby:** choose mode, arena, active player count and per-slot
   display name/character. Slots remain P1-P8 internally. Each participating
   human slot can READY. Proposed rule: a bot-filled slot is shown as
   automatically ready; an unfilled required slot blocks host start. P1 remains
   local host.
4. **Online room lobby:** the host creates/configures the room; each joining
   participant chooses the name and character for their own claimed slot and
   readies. The server publishes these presentation values to everyone. The
   existing first-entrant host may start only when all required participants
   are ready.
5. **Match/results:** show the chosen display name prominently and retain a
   smaller P1-P8 slot marker for unambiguous identity. Arena, mode, roster and
   character presentation match the confirmed lobby setup.

## Identity and ready contract

- A display name is presentation metadata, not a fighter ID, score key, replay
  field or simulation input. Never replace P1-P8 in snapshots, network
  ownership, scoring, hashes or deterministic fixtures.
- A character choice is the existing slot-to-art mapping, never a simulation
  character or balance field.
- Local display names are proposed to persist per slot on that browser. Online
  names/character choices are room-scoped, not accounts or permanent identities.
- Changing a participant's name or character marks that participant unready.
  Changing host-owned room settings clears readiness for all participants, as
  already specified in `GAME_DESIGN_DECISIONS.md`.
- Names must be rendered as text, length-bounded and stripped of control
  characters. Proposed display policy: trim surrounding whitespace, permit
  duplicate names, and retain the slot marker so duplicates remain distinct.
  A precise maximum length is left to the implementation task's UI fit check.
- Proposed local READY policy (not separately owner-confirmed): P1 is host;
  every active human seat must ready, bots are automatically ready, and
  unfilled required slots prevent start. This preserves a clear barrier without
  asking a bot to perform a UI action.

## Work packages

### GATE-G-TITLE-SCREEN

- **Objective:** make the start/title screen the first visible application
  state, then enter a main menu on the first valid user activation.
- **Rationale:** the current page boots directly into the live local arena and
  lobby, so first-time players have no clear entry point.
- **Dependencies:** this specification; coordinate against open PR #196's
  retro-only asset/style changes before implementation.
- **Files / ownership:** Graphics owns `index.html`, `src/main.ts`,
  `src/style.css`, and the new title-screen presentation/asset. Tester owns the
  corresponding `tests/browser/startScreen.spec.ts` checks. Do not change
  `StationScene` simulation/input rules in this slice.
- **Out of scope:** match rules, player names, online lobby protocol, new
  soundtrack, other arena art, accounts or matchmaking.
- **Acceptance tests:** first load presents only the title state; the game
  cannot start while it is visible; keyboard, pointer and gamepad activations
  each enter the main menu exactly once; audio context/music starts only after
  the user activation; the next screen offers all three routes; semantic visual
  checks cover 640x360 and 1280x720 without pixel-byte pins.
- **Risk:** browser autoplay policy prevents guaranteed music before a user
  gesture; a Phaser canvas loading behind the overlay must not steal the entry
  input or create duplicate scenes.
- **Branch / PR:** `graphics/gate-g-title-screen`; one `GRAPHICS:` PR with
  `Task: GATE-G-TITLE-SCREEN`.
- **User decision gate:** the owner approved a new splash image as the sole
  pre-Gate-G new-art exception and approved reusing existing chiptune. A
  separate new music composition is not approved.

### GATE-G-LOCAL-IDENTITY-READY

- **Objective:** make local setup show editable per-slot player names and
  character choices, then require every active human seat to READY before P1
  starts.
- **Rationale:** aliases and characters identify who is playing; a visible
  readiness barrier prevents starting before local participants have confirmed
  the setup.
- **Dependencies:** GATE-G-TITLE-SCREEN; existing local arena/mode/count and
  presentation-only character selection.
- **Files / ownership:** Graphics owns the local lobby/HUD integration in
  `index.html`, `src/game/presentation/StationScene.ts`, `src/style.css`, and
  `tests/browser/lobbyIdentity.spec.ts`; Gameplay review is required if a change
  reaches normalized input or simulation state.
- **Out of scope:** changing P1-P8 IDs, simulation/protocol snapshots, fighter
  balance, online name transport, accounts, new characters or modes.
- **Acceptance tests:** edit each active slot's display name and art choice;
  localStorage persistence; all active human seats must READY; bot seats are
  automatically ready; unfilled required slots block start; host start becomes
  available only after the barrier; alias appears in lobby/HUD/results with the
  P-slot marker; snapshot bytes and deterministic hashes remain unchanged.
- **Risk:** crowding at 640x360, keyboard focus stealing gameplay keys, unsafe
  display text and unfilled slots becoming impossible to start.
- **Branch / PR:** `graphics/gate-g-local-identity`; `GRAPHICS:` PR with
  `Task: GATE-G-LOCAL-IDENTITY-READY`.
- **User decision gate:** local READY for human players is owner-approved;
  automatic READY for bots and P1's local host role are designer
  recommendations derived from the existing bot/host model and must be called
  out in the implementation report, not misrepresented as separately approved.

### GATE-G-ONLINE-IDENTITY-CONTRACT

- **Objective:** let each online participant set their own room-scoped display
  name and character appearance; broadcast authoritative lobby metadata and
  clear that participant's READY state when either value changes.
- **Rationale:** the current Gate F room already has server-authored READY and
  host START, but client-owned presentation identity is not yet synchronized.
- **Dependencies:** merged Gate F room creation/READY/host-start contract and
  GATE-G-TITLE-SCREEN.
- **Files / ownership:** Gameplay owns
  `src/game/session/sessionEnvelope.ts`,
  `src/game/networking/wsMessages.ts`,
  `src/game/networking/wsSessionClient.ts`,
  `src/game/networking/onlineMatchController.ts`,
  `server/ws/authoritativeWsSession.ts`, and corresponding session/server
  tests. No Phaser rendering files in this task.
- **Out of scope:** accounts, persistent online profiles, room discovery,
  matchmaking, multi-room hosting, changes to simulation state, or real-network
  performance claims.
- **Acceptance tests:** only a connection may update its claimed slot; server
  validates bounded text and allowed character IDs; metadata is broadcast to
  all room participants; changing name/character clears only that participant's
  READY; host start remains refused until all required participants ready;
  canonical messages and reconnect behavior are tested; snapshots, replay
  fingerprints and simulation hashes do not change.
- **Risk:** untrusted name input, stale-client protocol compatibility,
  reconnect restoring the wrong identity, or presentation metadata leaking into
  simulation state.
- **Branch / PR:** `gameplay/gate-g-online-identity`; `LOGIC:` PR with
  `Task: GATE-G-ONLINE-IDENTITY-CONTRACT`.
- **User decision gate:** presentation-only identity and READY-before-host-start
  are owner-approved. Alias maximum length and duplicate-name policy are
  proposed implementation defaults and remain reviewable in the PR.

### GATE-G-ONLINE-IDENTITY-UI

- **Objective:** expose per-slot name/character selection and clear READY state
  visibly on a change; show aliases in online lobby, match HUD and result card.
- **Rationale:** server identity metadata is useful only if every player can set
  and understand it in-browser.
- **Dependencies:** GATE-G-ONLINE-IDENTITY-CONTRACT.
- **Files / ownership:** Graphics owns `online.html`, `src/online.ts`,
  `src/game/presentation/OnlineScene.ts`, `src/style.css`, and
  `tests/browser/online.spec.ts` presentation/E2E additions. Shared room
  contract fields are Gameplay-owned; agree the interface before parallel
  edits.
- **Out of scope:** simulation IDs, simulation balance, matchmaking, account
  profiles, lobby redesign beyond the named controls and status.
- **Acceptance tests:** host and guest can choose their own name/character;
  both clients show the same server-authored room choices; selection clears
  that participant's READY and visibly blocks host START until everyone
  readies; match HUD/results show the selected name plus slot marker; changing
  presentation identity leaves simulation hashes unchanged; browser tests cover
  both clients and malformed/overlong input.
- **Risk:** small-screen/desktop density (game targets desktop), duplicate names
  and mismatch between room metadata and sprite selection.
- **Branch / PR:** `graphics/gate-g-online-identity`; `GRAPHICS:` PR with
  `Task: GATE-G-ONLINE-IDENTITY-UI`.
- **User decision gate:** the user approved per-player identity and the online
  readiness barrier. Visual treatment and alias-length fit remain for owner
  review; no online account identity is implied.

## Gate G acceptance remains owner-controlled

These tasks prepare and test the requested flow. They do not mark Gate G
accepted, replace the owner's local/online playtest, change M1/M1.5 accepted
baselines, or claim network performance. Keep all network measurements
`NOT_MEASURED`.
