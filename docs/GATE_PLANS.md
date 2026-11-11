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
- Arena selector: station, K-kauppa, Mesku (real photos used as reference for future updates).
- Mode selector: all four modes.
- Player count selector: 1–8 active slots.
- Character selection per active slot (presentation mapping only – simulation IDs P1–P8 unchanged).
- Live summary line that exactly reflects the current lobby state.
- Start validation rules (e.g. Wave requires ≥1 human + ≥1 bot enemy).
- Preferences persist (localStorage) and survive reload.
- RESET returns to clean lobby while preserving chosen preferences.
- All choices are local only (online keeps server flags until later gates).

**Acceptance evidence:**
- A player can configure a full match without touching the URL.
- Starting a match produces exactly the roster, arena and mode shown in the summary.
- Results and HUD use the same identities.
- Simulation state hash is unchanged by presentation choices (character mapping is presentation-only).
- Browser tests cover all combinations + persistence.

**Agent work packages (already partially done):**
- L1 Arena select
- L2 Player count
- L3 Character per slot (presentation mapping)
- L4 Summary + start validation

**Human input points:**
- Exact start validation rules for Wave (already specified in LOBBY_SELECTION.md).
- Whether character choice affects bot AI (recommendation: no – bots stay pure policy regardless of visual).

**Locked recommendation (per owner instruction 2026-11-11):** Character selection is strictly visual/presentation only. Simulation IDs (P1–P8), bot behavior, scoring, and state hashes remain completely unaffected. A regression test must prove that identical inputs produce identical state hashes regardless of chosen appearance.

**Current status (2026-11-11):** L1–L4 largely implemented locally; this gate is close to completion.

---

## Gate C – Eight-player local play comfortable

**Objective:** A full 8-player local match (humans + bots) is playable and readable on one machine without frustration.

**Entry criteria:** Gate B complete (honest lobby that can produce 1–8 player setups).

**Must be ready at exit:**
- Up to 4 physical controllers + keyboard for remaining slots.
- Bots can reliably fill any unclaimed slots with good behaviour.
- 8-player presentation is readable (updated markers, HUD, results).
- Retro visuals updated for all arenas using real photo references where possible (photo-to-retro workflow).
- Reset, pause, rematch all work cleanly with 8 slots.
- Results screen handles 1–8 players gracefully.
- Performance is acceptable on typical desktop hardware.

**Acceptance evidence:**
- 8-player ALL BOTS match runs without issues.
- 4-human + 4-bot match is controllable and results are correct.
- Visual QA at 640×360 and 1280×720 shows no clipping and acceptable fighter distinction.
- Browser tests + manual owner playtest pass for crowded fights.

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

1. Pick the next unfinished gate.
2. Read the plan.
3. Derive tasks from the "Must be ready" and "Acceptance evidence" sections.
4. If a decision point is reached, check the "Recommendation" column first.
5. If still ambiguous, surface it with the recommendation and context from vision.

This structure is designed so that future designer + gameplay + graphics + tester agents can execute with minimal real-time human intervention until Gate G.

---

**Status of this plan:** 2026-11-11 – initial detailed expansion based on LONG_TERM_PLAN.md and current implementation state.

**Locked execution order & principles (2026-11-11 per owner instruction):**
- Complete Gate B fully before heavy Gate C work.
- Gate C includes application of photo-to-retro workflow.
- No owner playtesting before Gate G. All pre-G acceptance uses automated tests, visual matrix, semantic checks and agent reports.
- All human decision points use the locked recommendations above.
- Focus on documentation and clear agent task definitions so future work can proceed with minimal live clarification.