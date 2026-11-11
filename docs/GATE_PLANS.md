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

---

## Gate G – Owner playtest and iterate

**Objective:** The owner has played the full experience (local + online) and accepts the current state as "good enough to continue" or gives clear direction.

**Entry criteria:** Gates A–F complete (or explicit gaps documented).

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
- **Graphics and audio (including photo-to-retro for arenas and music generation):** Explicitly deferred until after Gate G. Pre-G work uses existing retro assets only. Real photo references are preserved in docs for later use.
- **Character selection (Gate B and later):** Strictly presentation-only. No effect on simulation, bots, scoring or hashes. (Heavy visual work deferred post-Gate G.)
- **Readability for 8 players (Gate C and later):** Use existing G2 markers + semantic checks. Major visual updates (photo references) deferred post-Gate G. Pre-G acceptance via tests + agent reports.
- **Online configuration (Gate D):** Server flags as defaults. Full configuration in Gate F.
- **Pre-G acceptance:** No owner playtesting. Use automated tests, visual matrix, semantic checks, and agent reports. Owner acceptance only at Gate G.
- **Measurements:** Never invent numbers. Use `NOT_MEASURED` until real data.
- **Documentation style:** High-level enough to give agents flexibility, but every section explicitly instructs to follow locked recommendations so the owner does not need to approve every design decision.

Agents: When in doubt, follow the locked recommendations above. Document your choice and the reasoning from this plan + vision. Evaluation happens after implementation in Gate G.

---

**Status of this plan:** 2026-11-11 – Gate B technical implementation started (per my long-term goal).

**Current Focused Goal (my decision as designer, per owner instruction "toimis suosituksesi mukaan" and "tee nyt itsellesi pitkän matkan maali"):**
Complete Gate B fully and technically before advancing to any later gates or work.

**Progress on current goal (Gate B technical):**
- Added explicit isolation in createLobbyState and character logic (StationScene.ts) to ensure no simulation impact.
- Added stronger isolation test in lobbyCharacterSelect.spec.ts that verifies stateJson unchanged on character change.
- Evidence: all lobby*.spec.ts + bot-lobby + all-bot-match pass (5/5).
- Unit tests green.
- Locked recommendations and high-level instructions maintained.
- Agent tasks in AGENT_TASKS.yaml referencing this doc.
- Graphics deferred per locked decision.
- Documentation maintained.

Key principles locked (agents must follow):
- Complete Gate B fully before advancing to later gates.
- Major graphics (photo-to-retro arena updates, new assets) and audio generation deferred until after Gate G. Pre-G focus is purely technical implementation using existing retro assets.
- High-level documentation leaves room for agent decisions, but explicitly requires following locked recommendations to minimize owner approvals for design choices.
- All pre-G acceptance via automated tests, visual matrix, semantic checks, and agent reports.
- Documentation must be maintained as the project evolves.

**My long-term goal as designer (set per owner instruction to decide and act on recommendations):**
Drive the project gate-by-gate per LONG_TERM_PLAN.md and this document, starting with full technical completion of Gate B (honest configurable local lobby without simulation impact), maintaining all documentation, deferring non-technical work (graphics/audio), enabling agentic progress by clear plans and locked recommendations. Progress one gate at a time, updating docs as the project evolves.

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