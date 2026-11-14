# TurenkiFight: short- and medium-term development plan

**Updated:** 2026-11-14
**Status:** Planning document; it does not itself approve new product scope or accept a milestone.

## Direction and current baseline

The immediate goal is to finish the owner-requested Gate G onboarding prerequisite, have the owner playtest it, and then continue the identity/READY slices in dependency order. Keep M1 and M1.5 accepted baselines intact. Do not build a Hetzner test platform now: GitHub Actions already runs remote CI, and the owner chose not to use the VM unless there is a concrete need for remote multiplayer/performance testing. Keep external-network performance claims out of scope; unmeasured values remain `NOT_MEASURED`.

### Decisions and status (not interchangeable)

- **Owner-approved direction:** retro title/start screen; LOCAL FIGHT / CREATE ROOM / JOIN ROOM; existing chiptune after a user gesture; presentation-only player names/looks with stable P1–P8 IDs; READY before host start for local and online play. See [Gate G onboarding specification](GATE_G_ONBOARDING_FLOW.md).
- **Owner-approved visual direction:** retro-only style; see [retro-only plan](RETRO_ONLY_MODE_PLAN.md).
- **Designer proposals, not separately approved:** local P1 host rule and automatic READY for bot slots. Keep these visibly marked as proposals until confirmed.
- **Implemented code:** tracked by merged PRs and the live task queue, not by this plan. Gate G remains pending owner playtest and acceptance.
- **Network architecture:** do not change or claim a benchmark-based selection in this plan. Existing network documents contain conflicting status statements; reconcile them before any future transport comparison or decision.

## Short term — finish onboarding and playtest

### S1. Integrate title flow, regression tests and presentation fixes

- **Objective:** ship the title/menu route without regressing the existing game, browser harnesses, audio, or visual layout.
- **Rationale:** PR #199 deferred Phaser startup until LOCAL FIGHT, which invalidated legacy browser-test assumptions; testing also exposed duplicate audio controls and HUD/scale issues.
- **Dependencies:** owner-approved Gate G scope; current open PRs #199, #204 and #206. PR #205 (test-task scope update) is merged.
- **Files / ownership:** Graphics: `index.html`, `src/main.ts`, `src/style.css`, `src/game/presentation/**`, `public/assets/**`; Tester: `tests/browser/**/*.spec.ts`, `tests/browser/**/*.ts`; Designer coordinates integration and task docs. Preserve these boundaries when resolving the PR chain.
- **Out of scope:** local/online identity protocol, combat or simulation changes, new music, arena redesign, Gate G acceptance.
- **Acceptance:** fresh load is title-only with no match canvas; gesture opens the menu and unlocks existing music; LOCAL FIGHT enters the old local flow; CREATE/JOIN use existing routes; only one audio-control set exists; 640×360 and 1280×720 checks pass; full required unit/build/browser/game-harness/retro-visual CI passes on the final integrated SHA; no gameplay assertions are skipped or weakened.
- **Risk:** separate PRs currently depend on each other's code/tests, and overlapping `main.ts`/presentation changes from PR #196 may complicate later integration.
- **Branch / PR:** current dependency order is `GRAPHICS: #206` (targets the Tester branch) → `TESTER: #204` (targets the title feature branch) → `GRAPHICS: #199` (main). Recheck live PR bases before merging; if required checks cannot run green on the chain, prepare one explicitly reviewed integration PR instead. Merge only after all required checks and review pass. Preserve worker-specific title prefixes and `Task: <ID>` markers.
- **Owner decision gate:** implementation scope is already approved. Owner performs the local playtest after integration; that playtest is not delegated to CI.

### S2. Owner playtest and short defect-fix loop

- **Objective:** verify the merged onboarding experience in the intended desktop browser and record reproducible defects.
- **Rationale:** automated browser checks cannot replace the requested Gate G owner playtest.
- **Dependencies:** S1 merged with green required checks.
- **Files / ownership:** initial report in `docs/visual/GATE_G_TITLE_SCREEN_QA.md` or a focused follow-up QA note; fixes remain with Graphics, Gameplay or Tester according to file ownership.
- **Out of scope:** declaring Gate G accepted, identity/READY completion, or changing approved design from an unrecorded observation.
- **Acceptance:** owner checks fresh load, keyboard/pointer activation, title → menu, LOCAL FIGHT, CREATE/JOIN routing, audio after gesture, and desktop layouts; any defect has steps, expected/actual result and browser details. Follow-up code receives the relevant CI and independent review.
- **Risk:** environment-specific audio/input behavior or confusing route transitions may not reproduce in CI.
- **Branch / PR:** defects get small scoped worker PRs with `GRAPHICS:`, `LOGIC:` or `TESTER:` prefix and task marker; no code change if no defect is observed.
- **Owner decision gate:** owner decides whether to accept this onboarding slice or request changes. Acceptance of the slice does not by itself accept Gate G.

### S3. Integrate the retro-only PR against current main and title flow

- **Objective:** bring PR #196 onto the current baseline without losing title/onboarding behavior or retro-only intent.
- **Rationale:** its green checks are from a stale base; the PR has broad presentation/test changes and semantic conflicts are likely.
- **Dependencies:** S1 integrated first, so both changes are reviewed together against current behavior.
- **Files / ownership:** Graphics owns PR #196's presentation/assets/visual tests; Designer reviews `README.md`, `docs/GAME_DESIGN_DECISIONS.md`, `docs/GRAPHICS_ROADMAP.md`, `docs/RETRO_ONLY_MODE_PLAN.md`, `src/game/presentation/OnlineScene.ts` and `.github/AGENT_TASKS.yaml` integration; Tester independently validates.
- **Out of scope:** simulation/protocol changes, new visual style, broad art direction changes, Gate G acceptance.
- **Acceptance:** resolve conflicts semantically; preserve title flow and current user-approved design; remove only active classic-style paths; `npm test`, build, full browser suite, game harness and retro visual QA pass on final candidate SHA; no check bypass.
- **Risk:** stale branch plus shared files, deletion of current docs/tasks during conflict resolution, and large regression surface.
- **Branch / PR:** update `graphics/retro-only-mode` from current main on a dedicated integration branch; retain `GRAPHICS:` PR #196 or replace it with a reviewed successor PR. Re-run all relevant checks; do not rely on the old green run.
- **Owner decision gate:** retro-only direction is approved, but the owner reviews the integrated visual result. Merging does not mark M1.5 or another milestone newly accepted.

## Medium term — finish Gate G readiness and identity

### M1. Local identity and READY barrier (`GATE-G-LOCAL-IDENTITY-READY`)

- **Objective:** give local slots per-slot display names and existing character looks, then require each active human seat to READY before host start.
- **Rationale:** stable slot IDs remain useful internally, while names/looks improve player recognition and an explicit barrier confirms local setup.
- **Dependencies:** S1; existing local setup/lobby and character-look infrastructure.
- **Files / ownership:** Graphics: `index.html`, `src/game/presentation/StationScene.ts`, `src/style.css`, `tests/browser/lobbyIdentity.spec.ts`; Gameplay reviews any normalized-input/simulation boundary change.
- **Out of scope:** modifying P1–P8 IDs, simulation state/hashes, scoring, online protocol, accounts, new characters/modes.
- **Acceptance:** names/looks are editable and safe text; identity persists per slot; active humans READY; clear start-block reason; lobby/HUD/results show alias plus slot marker; identical inputs produce identical simulation snapshots/hashes regardless of presentation metadata; keyboard access and layout tested.
- **Risk:** screen density, keyboard focus conflicts, unsafe text, and an incomplete roster becoming a dead end.
- **Branch / PR:** `graphics/gate-g-local-identity`; `GRAPHICS:` PR with `Task: GATE-G-LOCAL-IDENTITY-READY`; Tester independently covers behavior.
- **Owner decision gate:** local human READY is approved. Bot auto-ready and P1 host behavior remain proposals; confirm or explicitly accept the proposed behavior before implementation relies on it.

### M2. Online identity contract (`GATE-G-ONLINE-IDENTITY-CONTRACT`)

- **Objective:** synchronize room-scoped name/look metadata through server authority and clear only the changed participant's READY state.
- **Rationale:** client-controlled identity must not change stable slots or leak into deterministic simulation, and READY must remain authoritative.
- **Dependencies:** S1; verify Gate F room/READY contract is merged and current before claiming this task; M1 local UI is not a protocol dependency unless the owner chooses to sequence it that way.
- **Files / ownership:** Gameplay: `src/game/session/sessionEnvelope.ts`, `src/game/networking/wsMessages.ts`, `src/game/networking/wsSessionClient.ts`, `src/game/networking/onlineMatchController.ts`, `server/ws/authoritativeWsSession.ts`, related session/server tests.
- **Out of scope:** accounts, persistent profiles, matchmaking, multi-room, simulation changes and network performance claims.
- **Acceptance:** only the connection's claimed slot may update; server validates bounds/allowed looks; authoritative metadata is broadcast and supported reconnects retain it; changing identity clears only that participant's READY; host start remains blocked correctly; hashes/replay/snapshots remain unchanged; malformed data is rejected.
- **Risk:** untrusted text, stale-client compatibility, reconnect identity mismatch and accidental protocol-to-simulation coupling.
- **Branch / PR:** `gameplay/gate-g-online-identity`; `LOGIC:` PR with `Task: GATE-G-ONLINE-IDENTITY-CONTRACT`; Tester independent protocol and determinism review.
- **Owner decision gate:** identity/READY behavior is approved. Maximum name length and duplicate-name policy remain implementation details for review, not decisions already made.

### M3. Online identity UI (`GATE-G-ONLINE-IDENTITY-UI`)

- **Objective:** expose identity controls in create/join flows and display server-authored identity in lobby, match HUD and results.
- **Rationale:** the contract is only usable when every participant can set and recognize their own identity.
- **Dependencies:** M2 contract merged; agree field/interface ownership before parallel UI work.
- **Files / ownership:** Graphics: `online.html`, `src/online.ts`, `src/game/presentation/OnlineScene.ts`, `src/style.css`, browser E2E additions. Gameplay owns contract fields and server/client semantics.
- **Out of scope:** simulation IDs, account profiles, matchmaking, unrelated lobby redesign or new modes.
- **Acceptance:** host and guest configure their own slot; both browsers show the same authoritative name/look/READY; edits visibly clear READY and block host start; match/results show alias plus stable slot; malformed/overlong text cannot become markup; determinism remains unchanged.
- **Risk:** UI/contract mismatch, duplicate-name ambiguity and desktop layout density.
- **Branch / PR:** `graphics/gate-g-online-identity`; `GRAPHICS:` PR with `Task: GATE-G-ONLINE-IDENTITY-UI`; independent two-client browser E2E.
- **Owner decision gate:** approved identity/READY behavior; visual treatment and final label fit are reviewed in owner playtest.

### M4. Gate G playtest and acceptance

- **Objective:** test the integrated start, local setup, online room, identity and READY flows and record the owner's verdict.
- **Rationale:** only an owner playtest can establish whether the requested product flow is understandable and acceptable; CI cannot make that product decision.
- **Dependencies:** S1–S3 as applicable and M1–M3 implementation/checks complete.
- **Files / ownership:** Designer prepares a dated report in `docs/` with exact build/commit and owner findings; no implementation file changes by default.
- **Out of scope:** inferring acceptance from merged PRs, green CI, or automated tests.
- **Acceptance:** owner explicitly accepts Gate G or records concrete follow-up direction; preserve any documented limitations.
- **Risk:** test environment and network behavior may differ from CI; do not turn a local browser observation into a general performance claim.
- **Branch / PR:** documentation-only `DESIGNER:` PR with the primary Gate G task ID if a report is committed.
- **Owner decision gate:** explicit owner verdict is required. Gate G remains pending until then.

## Deferred / explicitly not planned now

- No Hetzner runner/test platform: GitHub Actions already offloads full CI; revisit only for a concrete multiplayer-network test need, a demonstrated CI bottleneck/cost issue, and an isolation plan for the Telegram-bot VM.
- No new music, matchmaking/accounts, arena overhaul or changes to the accepted M1/M1.5 baselines.
- No new transport measurement or WebSocket/WebRTC selection work in this plan. Before any such task, reconcile the contradictory status in `docs/OPENCODE_HANDOFF.md`, `docs/ROADMAP.md`, `docs/GAME_DESIGN_DECISIONS.md`, `docs/NETWORK_BENCHMARK_PLAN.md` and `docs/adr/0001-network-topology.md`; do not report network metrics that were not measured.

## Current PR checkpoint

Checkpoint 2026-11-14 (live PR metadata checked; latest completed CI runs are from 2026-11-13): PR #205 is merged. PRs #199 (title/menu), #204 (browser regressions) and #206 (audio/HUD integration) remain open. PR #206 targets the Tester branch; its latest reported run has `game-harness` failed, `retro-visual-qa` failed, and `browser-smoke` cancelled after its 20-minute limit, while `quality` and task validation passed. PR #204's latest completed checks are not green. These results are not acceptance evidence for the fully integrated final SHA; investigate and rerun after fixing the failures. PR #196 remains open and based on stale main. Recheck live PR state before acting; this paragraph is a checkpoint, not a status guarantee.
