# Gate Implementation Plans – TurenkiFight

**Purpose:** Detailed, agent-actionable plans for each Gate defined in `LONG_TERM_PLAN.md`. The goal is to enable as much independent, deterministic agent work as possible. All decisions should be derivable from the product vision and existing owner decisions.

**Product Vision (owner 2026-11-06):**
- Eight players online, up to four locally.
- 80 % chaos + 20 % skill.
- Legible chaos, fixed-camera 2.5D arena brawler.
- Deterministic simulation.
- Central authoritative WebSocket (decided).
- Retro-only visual style.
- Spiritual ancestors: Target Renegade / Streets of Rage.

**Guiding rules for all plans:**
- Simulation stays deterministic and headless-testable.
- Presentation never affects simulation or protocol.
- Retro-only (no classic).
- Max 8 players (P1–P8 slots).
- Bots fill unclaimed slots.
- Owner playtest is the real acceptance gate (merging is not acceptance).
- All unknowns stay `NOT_MEASURED` until actually measured.

---

## Gate A – Deterministic local match loop

**Objective:** The core simulation + local execution is reliable, replayable and independently testable before any lobby or networking work.

**Entry criteria:** Basic engine exists (M1 baseline).

**Must be ready at exit:**
- Fixed-tick deterministic simulation (no wall-clock or randomness in core rules).
- Full match lifecycle (lobby → countdown → fight → results) produces identical state + event fingerprints on replay.
- Headless replay tests cover at least Score Brawl, LMS, Deathmatch, Wave with 1–8 players.
- Bots have a pure seeded policy that can fill any slot.
- No simulation changes leak into presentation or vice versa.
- All existing pinned fingerprints are green and documented.

**Acceptance evidence:**
- `npm test` (unit + simulation) green.
- Headless replay scenarios produce identical final state + ordered events.
- At least one full 7200-tick match per mode is reproducible.

**Agent work packages:**
- Gameplay: simulation determinism, bot policy, mode rules, event ordering.
- Tester: expand headless replay matrix and fingerprint regression.

**Human input points:**
- None expected at this gate (pure engineering). If new mechanics are proposed, derive from 80/20 vision and existing controls (punch/kick/jump + combinations).

**Recommendation (if ambiguity arises):** Default to "keep simulation byte-identical to M1 unless explicitly required by later gate". Always require fingerprint update + test.

---

## Gate B – Local lobby honest and configurable

**Objective:** Before starting a match, the player can choose arena, mode, player count and character per slot in the browser. The chosen setup must exactly match what appears in the match, HUD and results. No hidden URL magic.

**Entry criteria:** Gate A complete (deterministic match loop).

**Must be ready at exit:**
- Arena selector in lobby (station, K-kauppa, Mesku). Changing it updates backdrop, URL param, and the arena passed to createState. Uses photo reference workflow for future accuracy.
- Mode selector: Score Brawl, Last Man Standing, Deathmatch, Wave.
- Player count selector (1–8). Slots above count are inactive and not created in match state. Bots fill unclaimed active slots.
- Character selection per active slot: presentation mapping only (P1 can look like any of the 8 fighters). Simulation identity (P1–P8) unchanged. No effect on bots or scoring.
- Live summary line: "ARENA · MODE · PLAYERS · HUMANS · BOTS" that exactly matches current lobby state.
- Start validation: normal matches need at least 2 fighters (except 1-player allowed); Wave requires ≥1 human + ≥1 bot enemy.
- Persistence: choices saved to localStorage, restored on load, URL param wins for arena.
- RESET behavior: returns to lobby, clears joined humans/bots but keeps selected preferences.
- All lobby choices are local-only. Online uses server flags until Gate D/F.
- No simulation bytes change due to visual choices (prove with state hash tests).

**Acceptance evidence:**
- Full local match can be started from browser UI only (no URL editing).
- Configured values exactly match match state, HUD, results, and summary.
- State hash regression test: identical inputs with different character visuals produce identical simulation results.
- All L1–L4 combinations covered in browser tests.
- Persistence + reload works.
- Start validation prevents invalid Wave setups.

**Agent work packages (build on existing LOBBY_*.md plans):**
- Designer: maintain `docs/LOBBY_SELECTION.md` and this gate plan; ensure photo workflow referenced for arenas.
- Graphics: implement arena selector UI, character previews using retro assets; apply photo-to-retro for new arena visuals when needed.
- Gameplay: ensure lobby state correctly passes arena/mode/roster to simulation without changing deterministic logic; add state hash tests for character mapping.
- Tester: browser tests for all selector combinations, persistence, start validation, and state hash invariance.

**Human input points:**
- Exact start validation rules for Wave (already specified in LOBBY_SELECTION.md).
- Whether character choice affects bot AI (recommendation: no – bots stay pure policy regardless of visual).

**Locked recommendation (per owner instruction 2026-11-11):** Character selection is strictly visual/presentation only. Simulation IDs (P1–P8), bot behavior, scoring, and state hashes remain completely unaffected. A regression test must prove that identical inputs produce identical state hashes regardless of chosen appearance.

**Current status (2026-11-11):** L1–L4 largely implemented locally; this gate is close to completion.

---

## Gate C – Eight-player local play comfortable

**Objective:** A full 8-player local match (humans + bots) is playable and readable on one machine without frustration.

**Entry criteria:** Gate B complete (honest lobby that can produce 1–8 player setups).

**Must be ready at exit (locked per recommendation):**
- Support for 4 physical controllers; remaining slots via keyboard or bots.
- Bots fill unclaimed slots with deterministic seeded policy that remains competitive at 8 players.
- 8-player presentation readable using:
  - Existing G2 compact per-slot markers with contrast threshold.
  - Semantic checks (no clipping, text size, quiet platform).
  - Photo-to-retro arena updates (station first, using real photos for silhouette and color accuracy).
- All 8 slots work with reset, pause, rematch, results.
- Results screen scales to 1–8 players.
- No performance regression in 8-player local matches.

**Acceptance evidence (pre-Gate G, locked):**
- 8-player ALL BOTS and mixed human+bot matches run cleanly.
- Visual matrix + targeted 8-player browser tests pass (G1/G2/G5 style semantic checks).
- Photo-to-retro applied at least to station; reference images and real photos preserved in docs/visual/references/.
- Designer report confirms 8 fighters are distinguishable at 640×360 using current markers + arena visuals.
- No simulation impact from visuals.

**Agent work packages:**
- Gameplay: bot policy improvements if needed for 8 players.
- Graphics: photo-based arena updates using the documented workflow (station first, then K-kauppa/Mesku).
- Tester: 8-player readability and controller tests.

**Human input points:**
- What constitutes "comfortable" 8-player readability? 
  **Locked recommendation (per owner instruction 2026-11-11):** 
- Use existing G2 fighter marker contrast rules + semantic visual checks (no clipping, text >=14px, platform remains quiet).
- Since owner does not want to playtest before Gate G, acceptance for Gate C will be based on:
  - Automated visual matrix + browser tests
  - Designer/tester reports on readability at 640×360 and 1280×720 with 8 fighters
  - Application of the photo-to-retro workflow for arenas (starting with station)
- If later owner feedback in Gate G indicates problems, address in a follow-up iteration. Do not reduce max players.

- Exact number of supported physical gamepads.
  **Locked recommendation (per owner instruction 2026-11-11):** Apply the photo-to-retro arena workflow (real photos → AI reference → hand-crafted SVG) starting in Gate C for 8-player readability. Station first, then K-kauppa and Mesku. Use the documented process in `docs/ART_PHOTO_REFERENCE_WORKFLOW.md`.

**Derivation from vision:** Local focus first + 80% chaos means we must support crowded fights without the game becoming unplayable.

---

## Gate D – Stabilize the online room contract

**Objective:** The online room/join flow is typed, predictable and independent of the deterministic simulation.

**Entry criteria:** Gate C (comfortable 8-player local).

**Must be ready at exit:**
- Typed room state, join, leave, ready.
- Mode and arena chosen at room creation (or inherited from server flags until later).
- Player identity and slot allocation stable.
- Rejoin window (30 s) works.
- Failure paths (host loss, disconnect, invalid join) have clear typed outcomes.
- Session envelope + authoritative session work over real WebSocket.
- No simulation changes required for room logic.

**Acceptance evidence:**
- Typed tests for room lifecycle.
- Local + single-machine online tests for join/rejoin/rematch.
- Clear separation: room state is not mixed with match simulation state.

**Agent work packages:**
- Gameplay / Networking: room contract, ingress gateway, typed messages.
- Tester: room contract tests + failure scenarios.

**Human input points:**
- How much configuration happens in the room vs. server flags?
  **Locked recommendation (per owner instruction 2026-11-11):** Keep server `--mode` and `--arena` as defaults for early online (Gate D). Full room-level configuration (matching local lobby) is deferred to Gate F. This keeps the contract simpler and derives directly from "local lobby first" principle.

**Risk mitigation:** Room logic must never touch deterministic simulation bytes.

---

## Gate E – Validate real eight-player network conditions

**Objective:** We have real data (or honest `NOT_MEASURED` labels) about eight-player network behaviour before promising production online play.

**Entry criteria:** Gate D (stable room contract).

**Must be ready at exit:**
- Two-machine (or owner-provided) measurement harness.
- Documented procedure for owner to run the test.
- Measurements recorded for: bandwidth, RTT, jitter, loss, snapshot size, CPU, with 4/8 players.
- All values explicitly marked `NOT_MEASURED` if not actually measured.
- No invented numbers.

**Acceptance evidence:**
- Measurement manifest or report exists.
- Unknowns are honestly labelled.
- Harness can be re-run by owner.

**Agent work packages:**
- Networking: measurement harness (already partially exists).
- Documentation: clear run instructions.

**Human input points:**
- Owner must run the two-machine test (currently blocked).
  **Recommendation:** Prepare the harness and instructions. When owner is ready, run Gate E. Do not proceed to F with invented performance claims.

**Derivation from vision:** We cannot claim "eight players online" without evidence. Honest `NOT_MEASURED` is acceptable until measured.

---

## Gate F – Productize the browser multiplayer loop

**Objective:** The full online experience is polished enough for real use (LAN/VPN first, later internet).

**Entry criteria:** Gate E (real measurements or honest gaps documented).

**Must be ready at exit:**
- TLS / wss support.
- Room codes or simple discovery.
- Rate limiting and abuse protection.
- Clear user flow: create room → join → play → results → rematch or leave.
- Reconnect and rejoin handled gracefully.
- Eight-player sessions tested end-to-end (with real or simulated network conditions).
- Hosting documentation for LAN and simple internet.

**Acceptance evidence:**
- End-to-end browser + server tests for full flow.
- Eight-player online session works without crashes.
- Security basics (TLS, rate limits) in place.
- Documentation allows a non-developer to host.

**Agent work packages:**
- Networking + server: security, flow, documentation.
- Tester: full online flow tests.
- Graphics: any remaining lobby polish for online.

**Human input points:**
- Security model (accounts? no).
  **Recommendation:** Keep it simple (room codes + TLS). No accounts or progression until the game is past Gate G. Derive from "LAN/VPN first" and "no matchmaking" in vision.

- Exact rate limits and connection caps.
  **Locked recommendation (per owner instruction 2026-11-11):** 
- Security model: TLS + room codes + basic rate limiting and connection caps.
- No accounts, progression or matchmaking until after Gate G.
- Conservative defaults: max 8–12 concurrent rooms, max 8 players per room. Tune only after real measurements in Gate E.

**Gate F technical progress (2026-11-11; not owner-accepted):**
- Existing M14 slices provide optional TLS/WSS, room-code admission, room connection caps, per-client message size/rate/invalid-message limits, non-host 30 s rejoin, authoritative results and opt-in rematch.
- Added a non-developer-oriented [`docs/GATE_F_HOSTING_GUIDE.md`](GATE_F_HOSTING_GUIDE.md) covering LAN/VPN, public WSS prerequisites, setup, security caveats and troubleshooting; corrected stale README security claims.
- Expanded online browser slot selection to P1–P8 and added a real browser + authoritative server test with seven additional clients; it asserts all eight authoritative fighters render and session enters running.
- Added a server-authored lobby roster/readiness state, participant READY action and host-only HOST START. For this flow, operators use `--start=manual`; tests prove the server rejects a forged guest start and the host cannot start until every required player has readied.
- Added an explicit browser CREATE ROOM / JOIN ROOM setup. The first host join carries typed room settings (mode, arena, player count and the owner-approved 1/2/3-minute timer) in the canonical join envelope; the authoritative server validates host eligibility/capacity and publishes settings and required roster to lobby peers. Room size may not exceed the process `--players` capacity.
- A browser+server E2E test creates a two-player Deathmatch on Mesku with a one-minute timer, confirms authoritative settings, joins P2, readies both players, host-starts, runs the real timer and renders server-authored results.
- Existing browser coverage also exercises results, rematch, join UI and server input/snapshot flow; existing server tests cover TLS, abuse limits and rejoin.
- **Not claimed:** no real internet/LAN performance, operational TLS certificate renewal verification, or owner playtest. Online arena backdrop now switches from authoritative room state and the E2E asserts both lobby metadata and the selected Phaser texture. Full M14 regression/CI evidence and owner review remain required. A single room per process was retained per owner answer 2026-11-11; multi-room hosting remains out of scope.
- No Gate F milestone acceptance is asserted here; automated results and owner approval remain distinct.
- **Technical verification (2026-11-11):** online/results browser suite 14/14; M14 TLS/room-code, rate-limit and rejoin tests 39/39; full unit suite 72 files/630 tests; `npm run build` passed. These are loopback/software checks, not real network performance evidence. PR #197 remains open and owner review/approval is pending.
- **Owner decision (2026-11-11):** Online room duration choices are 1, 2 and 3 minutes; retain the existing 2-minute timer as the default. This resolves the prior open duration-option question. The simulation now has a typed duration selection foundation; end-to-end room configuration wiring remains outstanding.

### Gate F work package: browser access and operator hosting (F1)

- **Objective:** Make all eight server slots selectable in the browser, prove an eight-player browser/server session reaches play, and publish accurate LAN/VPN/public-WSS setup instructions.
- **Rationale:** The earlier browser form exposed only P1–P4 despite an eight-slot server; README security statements were stale and did not give a WSS deployment path.
- **Dependencies:** Gate D room contract; Gate E BASE-8 correctness harness; existing M14 TLS/room-code/rate-limit/rejoin implementations.
- **Files/ownership:** `online.html`, `src/online.ts`, `tests/browser/online.spec.ts` (online UI/gameplay integration); `docs/GATE_F_HOSTING_GUIDE.md`, `README.md`, `docs/M14_ONLINE_SECURITY.md`, `docs/GATE_PLANS.md`, `.github/AGENT_TASKS.yaml` (designer docs/task state).
- **Out of scope:** Accounts, matchmaking, multi-room hosting, host migration, progression; actual LAN/internet measurements; changes to simulation rules or M1/M1.5 baseline.
- **Acceptance tests:** Browser form exposes P1–P8; an 8-slot authoritative server plus seven additional clients and browser P8 reaches running and renders every authoritative fighter; online browser flows and results/rematch tests pass; TLS/rate/rejoin unit/integration tests pass; full unit suite/build pass; network metrics remain `NOT_MEASURED`.
- **Risk:** 8-slot selection is only an admission UI, not a full configurable lobby; online arena/mode/duration still use server/operator defaults. A loopback test cannot validate firewall, certificate hostname, router or internet behavior.
- **Branch/PR plan:** `designer/gate-f-online`; one reviewable `DESIGNER: ` PR with `Task: GATE-F-ONLINE-BASELINE`; no merge without owner approval.
- **User decision gate:** None for this narrow slice; existing approved security choices apply. Owner review/merge is still required. Overall Gate F remains open until remaining product-boundary/configuration gaps are resolved and evidence is consolidated.

### Gate F work package: participant readiness and host start (F2)

- **Objective:** Replace the operator-only start step with a browser-visible roster, per-player READY, and host-authorized manual start.
- **Rationale:** The owner-approved room design says every participant readies and the host starts manually; the Gate D `ready-request` existed but had no browser API/feedback and start was stdin-only.
- **Dependencies:** F1, Gate D typed envelope, M14 authoritative WS session.
- **Files/ownership:** `src/game/session/sessionEnvelope.ts`, `src/game/session/sessionEnvelopeGateway.ts`, `src/game/networking/wsMessages.ts`, `src/game/networking/wsSessionClient.ts`, `src/game/networking/onlineMatchController.ts`, `server/ws/authoritativeWsSession.ts`, `server/ws/wsServer.ts`, `online.html`, `src/online.ts`, `src/style.css`, `tests/browser/online.spec.ts`, and corresponding unit tests.
- **Out of scope:** room setting mutation, multiple rooms per process, auth/accounts/matchmaking, simulation changes, network performance claims.
- **Acceptance tests:** Host sees its role; all joined users can ready; host start is disabled until all required slots (or all claimed human slots in wave mode) are ready; server rejects guest-forged start; accepted host start sends both clients into running; manual and legacy auto server modes remain covered.
- **Risk:** protocol expands; old clients may ignore new server messages, but new client depends on the matching server version. Manual start must be enabled for this flow.
- **Branch/PR plan:** continue `designer/gate-f-online` PR #197 as same Gate F package; body primary task must be updated to `Task: GATE-F-ONLINE-PRODUCTIZATION` before adding this slice to PR.
- **User decision gate:** resolved for this flow: owner selected one room per process. No multi-room implementation or capacity claim.

### Gate F work package: browser room creation and authoritative settings (F3)

- **Objective:** Let the first browser participant create the process's single room and set mode, arena, player count and duration; later browsers join that configured room.
- **Rationale:** Existing server flags were not a browser room-creation flow; user explicitly requested settings be browser-controlled and reach the authoritative server.
- **Dependencies:** F1/F2, canonical session envelope, typed one/two/three-minute duration options.
- **Files/ownership:** `online.html`, `src/online.ts`, `src/style.css`, `src/game/presentation/OnlineScene.ts` (explicitly requested), `src/game/session/sessionEnvelope.ts`, `src/game/networking/wsSessionClient.ts`, `src/game/networking/onlineMatchController.ts`, `src/game/networking/wsMessages.ts`, `server/ws/authoritativeWsSession.ts`, `tests/browser/online.spec.ts`, `src/game/session/sessionEnvelope.test.ts`, `docs/GATE_F_HOSTING_GUIDE.md`.
- **Out of scope:** multi-room per process, accounts, matchmaking, changing local lobby or simulation rules beyond deterministic timer configuration, real network performance claims.
- **Acceptance tests:** reject malformed configuration before slot mutation; reject creation by a non-first host or configuration above server capacity; authoritative lobby broadcasts chosen settings; room state uses selected mode/arena/duration/roster; browser E2E covers creation, P2 join, readiness, host start, real play timer and results.
- **Risk:** Server process capacity remains an operator ceiling (`--players`); browser can select a room size up to that capacity. The online scene preloads arena backdrops to allow authoritative switching; verify missing-asset and query-preview behavior in browser QA.
- **Branch/PR plan:** continue `designer/gate-f-online`, same Gate F PR #197 with primary task `GATE-F-ONLINE-PRODUCTIZATION`; no merge without owner approval.
- **User decision gate:** duration choices approved as 1/2/3 minutes; single-room-per-process already selected. No unresolved rules decision for this slice.

---

## Gate G – Owner playtest and iterate

**Objective:** The owner has played the full experience (local + online) and accepts the current state as "good enough to continue" or gives clear direction.

**Entry criteria:** Gates A–F complete (or explicit gaps documented).

**Owner direction (2026-11-12):** Before the playtest, make entry clearer with
a retro title/start screen, a LOCAL FIGHT / CREATE ROOM / JOIN ROOM main menu,
per-slot display names and character looks, and READY-before-host-start for
both local and online participants. A new splash image is an approved,
narrow pre-Gate-G art exception; reuse existing chiptune only, with playback
beginning after the first user gesture. The full task breakdown and unapproved
implementation details are in [Gate G onboarding flow](GATE_G_ONBOARDING_FLOW.md).
This is playtest preparation, not Gate G acceptance.

**Must be ready at exit:**
- Owner has run multiple local 4-human and 8-player matches.
- Owner has run at least one real online session (if measurement allows).
- Known limitations are documented.
- Owner has given explicit feedback on feel, readability, fun and priorities.

**Acceptance evidence:**
- Written owner acceptance (or list of required changes).
- Updated LONG_TERM_PLAN.md with next priorities.

**Agent work packages:**
- All roles: prepare clean builds, test harnesses, visual evidence.
- Designer: summarize feedback into actionable tasks.

**Human input points:**
- Almost everything at this gate is human (owner).
  **Recommendation:** Prepare a "playtest kit" (build + instructions + known gaps list) so the owner session is efficient. Derive questions from vision (e.g. "Does 80/20 chaos/skill feel right?").

---

## Cross-cutting rules for all gates

- Every gate must produce:
  - Reproducible build
  - Test evidence
  - Updated documentation
  - Known limitations list
- Never invent measurements.
- Never change deterministic simulation for presentation or room concerns.
- Graphics updates (including photo references) are tied to readability gates (especially C).
- All plans are living – update this document when owner direction changes.

## How to use this document for agentic work

1. Pick the next unfinished gate (start with the earliest incomplete one).
2. Read the full gate section + cross-cutting rules.
3. Derive concrete tasks from "Must be ready at exit", "Acceptance evidence", and "Agent work packages".
4. For any decision point, first apply the **Locked recommendation** in the document.
5. Reference this document in every task and PR description.
6. Produce: updated code, tests (unit + browser + visual), documentation updates, and a short "Gate X Readiness Report" (build green, tests pass, limitations listed).
7. Only escalate to human if something cannot be derived from vision + this doc.

**Agent guidelines:**
- Always preserve deterministic simulation.
- Use existing patterns from previous gates (e.g. LOBBY_*.md plans as templates).
- For graphics: follow `docs/ART_PHOTO_REFERENCE_WORKFLOW.md`.
- For readability (Gate C+): follow locked G2 + semantic rules below.
- Document everything so the next agent can continue without context loss.

This structure is designed so that future designer + gameplay + graphics + tester agents can execute with minimal real-time human intervention until Gate G.

## Preparing Agent Task Lists from this Document (once documentation is considered ready)

When creating tasks in `.github/AGENT_TASKS.yaml` or per-gate plans:
- Reference this document and the specific Gate section.
- Break "Must be ready at exit" into small, independently testable slices (prefer 2–5 related tasks per PR).
- Each task must specify: objective, acceptance criteria (tied to this doc), files/ownership, tests, risks.
- For graphics tasks: always reference `docs/ART_PHOTO_REFERENCE_WORKFLOW.md`.
- For readability: reference the locked Gate C criteria above.
- Example task title pattern: "GATE-C-01: 8-player marker and arena visual updates (station photo reference)" 

Task lists are created only after the gate documentation is stable. Example tasks have been added to .github/AGENT_TASKS.yaml referencing this document (Gate B technical completion first, graphics deferred).

## Locked Decisions for Ambiguous Areas (agents must follow these; this reduces the need for owner approval on every design decision)

- **Priority order:** Complete Gate B fully before moving to Gate C or later gates.
- **Graphics and audio (including photo-to-retro for arenas and music generation):** Broad visual changes and new music remain deferred until after Gate G, except the owner-approved start-screen splash art in `GATE_G_ONBOARDING_FLOW.md`. Reuse existing chiptune before then. Real photo references are preserved in docs for later use.
- **Character selection (Gate B and later):** Strictly presentation-only. No effect on simulation, bots, scoring or hashes. (Heavy visual work deferred post-Gate G.)
- **Readability for 8 players (Gate C and later):** Use existing G2 markers + semantic checks. Major visual updates (photo references) deferred post-Gate G. Pre-G acceptance via tests + agent reports.
- **Online configuration (Gate D):** Server flags as defaults. Full configuration in Gate F.
- **Pre-G acceptance:** No owner playtesting. Use automated tests, visual matrix, semantic checks, and agent reports. Owner acceptance only at Gate G.
- **Measurements:** Never invent numbers. Use `NOT_MEASURED` until real data.
- **Documentation style:** High-level enough to give agents flexibility, but every section explicitly instructs to follow locked recommendations so the owner does not need to approve every design decision.

Agents: When in doubt, follow the locked recommendations above. Document your choice and the reasoning from this plan + vision. Evaluation happens after implementation in Gate G.

---

**Status of this plan:** 2026-11-11 – Gate C technical complete (tests pass per evidence); now advancing to Gate D per user directive "Git commit ja push kaikki... Sen jälkeen Gate D maaliksi ja toteutukseen" and untrusted_objective "kehitä Gate D sisältö ja testaa toimivaksi. Valmista on, kun testit menee läpi".

**Current Focused Goal (per user objective 2026-11-11):**
Complete Gate E's technical preparation and automated verification; do not claim any real network measurements that have not occurred. Existing owner-run steps and network fields remain explicitly `NOT_MEASURED` until actually executed.

**Gate B completion evidence (required before Gate C per locked):**
- All relevant browser tests: lobby*.spec.ts + bot-lobby.spec.ts + all-bot-match.spec.ts + m8-eight-player-ui.spec.ts : 10/10 passed.
- Full unit tests: 72 files, 621 tests passed.
- State hash / character isolation test added and passes (presentation only, no sim impact).
- Reset/pause/rematch, 8p HUD/results, gamepad+bot+keyboard, summary, validation all covered and green.
- No simulation changes, used existing assets.
- Updated AGENT_TASKS and docs.

**Progress on current goal (Gate D):**
- Gate D technical slice COMPLETE: typed `ready-request` was added to the v1 client envelope, canonicalized, ownership-checked and handled by the authoritative WS session.
- Join/leave/rejoin, room-code admission, typed failure outcomes, rematch gating and authoritative session behavior remain covered by existing tests.
- Ready handling is room intent only: it does not mutate deterministic simulation state; disconnect clears readiness.
- Evidence: focused Gate D run = 13 test files / 108 tests passed; full unit suite = 72 files / 624 tests passed; production build passed.
- Git changes are committed and pushed after verification.
- Locked recommendation followed: mode/arena remain server defaults; full room configuration is deferred to Gate F.
- No owner playtest or network performance claim; pre-G acceptance is automated tests and code evidence only.

## Gate E execution status (2026-11-11)

- Added `docs/GATE_E_READINESS_REPORT.md` with evidence inventory, run procedure and 4/8 player measurement ledger.
- Existing M14 report contains actual eight-player single-machine snapshot/tick/CPU/RSS measurements; its network fields are strictly `NOT_MEASURED`.
- Extended split-role WS harness to BASE-8 (coordinator plus eight one-slot client roles); deterministic fixture fingerprints checked against in-memory reference. BASE-4 defaults/fingerprints remain unchanged.
- Added a regression test that reads the committed M14 JSON and asserts loopback scope plus every network field remains `NOT_MEASURED` (including `measuredNetworks: 0`).
- **Known gap:** no owner-run LAN/internet test has occurred. All 4/8-player real-network conditions remain `NOT_MEASURED`; the BASE-8 automated split test runs over loopback and is correctness-only.
- Verification determines the technical prep is ready; this does not represent owner acceptance or real network validation.

Key principles locked (agents must follow):
- Complete Gate B fully before advancing to later gates.
- Major graphics (photo-to-retro arena updates, new assets) and audio generation deferred until after Gate G. Pre-G focus is purely technical implementation using existing retro assets.
- High-level documentation leaves room for agent decisions, but explicitly requires following locked recommendations to minimize owner approvals for design choices.
- All pre-G acceptance via automated tests, visual matrix, semantic checks, and agent reports.
- Documentation must be maintained as the project evolves.

**My long-term goal as designer (set per owner instruction to decide and act on recommendations):**
Drive the project gate-by-gate per LONG_TERM_PLAN.md and this document. Current active: full technical completion of Gate C (comfortable 8-player local play per definition), after confirming Gate B complete. Maintain documentation, follow locked recommendations (B first but now met; graphics/audio post-Gate G; pre-G via tests/reports; use existing retro assets), enable agentic progress. Progress one gate at a time, updating docs as the project evolves.

Key principles locked:
- Complete Gate B fully before advancing.
- Major graphics (photo-to-retro, new assets) and audio deferred until after Gate G. Focus on technical implementation.
- High-level documentation with explicit "follow locked recommendations" instruction.
- Agents derive work from this doc; owner approval not required for every design choice within locked recommendations.
- Evaluation of results (including graphics choices) in Gate G.

The documentation in this file + related specs is now ready as base for agent task lists.

## Example Agent Task List (to be moved to .github/AGENT_TASKS.yaml when approved)

These are derived directly from the gate plans above. Each task references this document.

**For completing Gate B (priority - complete fully before advancing):**
Focus on technical lobby implementation. Use existing retro assets. Heavy graphics/polish deferred post-Gate G.

- id: GATE-B-01
  title: Complete arena selector and player count in local lobby (technical)
  assigned_role: graphics-session
  specification: docs/GATE_PLANS.md#gate-b
  depends_on: [existing LOBBY-L1, LOBBY-L2]
  acceptance:
    - Arena selector works in lobby and correctly passes to simulation
    - Player count 1-8, inactive slots not created in state
    - Tests pass (no major new graphics)

- id: GATE-B-02
  title: Character selection as presentation-only (minimal, using existing assets)
  assigned_role: graphics-session
  specification: docs/GATE_PLANS.md#gate-b
  depends_on: [GATE-B-01]
  acceptance:
    - Basic assignment of appearances to slots
    - State hash invariance proven
    - Full photo-based art deferred post-Gate G

- id: GATE-B-03
  title: Live summary, validation, persistence and start (L4)
  assigned_role: gameplay-session
  specification: docs/GATE_PLANS.md#gate-b
  depends_on: [GATE-B-02]
  acceptance:
    - Summary exactly reflects state
    - Validations enforced
    - Persistence and flow complete

**Gate C and later:** Planning only at this stage. Major graphics (photo-to-retro) and 8-player visual work deferred until after Gate G per locked decisions. Technical core (bots, controllers, lobby flow) can be prepared.

These tasks are examples. Full list will be added to AGENT_TASKS.yaml referencing this document once confirmed.

**Locked execution order & principles (2026-11-11 per owner instruction):**
- Complete Gate B fully before heavy Gate C work.
- Gate C includes application of photo-to-retro workflow.
- No owner playtesting before Gate G. All pre-G acceptance uses automated tests, visual matrix, semantic checks and agent reports.
- All human decision points use the locked recommendations above.
- Focus on documentation and clear agent task definitions so future work can proceed with minimal live clarification.
