# Next engineering gates — current main, 2026-10-31
> **Superseded 2026-11-03.** This forward-looking gate list predates the M2 transport decision and the M7/M8 work. Current state lives in [GOALS.md](GOALS.md), [ROADMAP.md](ROADMAP.md) and [ADR 0001](adr/0001-network-topology.md); keep this file only as history.


This is a **forward-looking design proposal**, not a release acceptance or permission to merge. Baseline main at creation: `bb6058a` (PR #43). Avoid restoring the stale PR #40 task queue; main already has a newer, validated queue.

## Verified foundations
- M1 local four-player 120-second Score Brawl accepted with limitations.
- M1.5 P1–P4 retro fighters, station refinement, initial HUD and hit feedback merged (#21, #30, #36, #39, #44, #47); viewport fixes #76/#83 and retro Pages build #85 merged. **Owner accepted M1.5 with documented limitations on 2026-11-01**; VIS05-02/VIS05-03 remain follow-ups.
- M2 v1 canonical protocol integrated with authorized session ingress (#41), hardening (#43). Neither PR establishes a network transport, authenticated room service or completed security audit.
- `docs/GOALS.md`, `docs/AGENT_HANDOFF_2026-10-31.md` and `docs/M2_INTEGRATION_GATE.md` include historical PR #25 statements; preserve them as evidence, but prefer current main and this document for next decisions.
- PR #40 was green on its updated head but cannot merge cleanly into current main; supersede it rather than overwriting newer task state.

## Designer decisions to settle before transport prototypes
1. **Session envelope v1:** distinguish trusted connection identity from untrusted payload; define `sessionId`, `connectionId`, `sequence`, `targetTick`, one owned `playerId`, maximum byte size, protocol version and canonical codec boundary. Never let clients self-assert ownership or host rights.
2. **Authority and lifecycle:** define lobby join, multiple local slots per connection, host-only start, ready/not-ready policy (M1 has no ready state), host loss, disconnect, grace period and reconnect tokens. Distinguish reconnect from a new join. Define whether a host can migrate; do not silently change authority.
3. **Tick semantics:** 60 Hz authoritative simulation, bounded future input window, explicit late/drop/duplicate policy, neutral input for missing players, snapshot/event ordering, no wrap to unsafe integer ticks.
4. **Security:** limit packet bytes and rate before JSON parse; enforce room isolation, roster authorization, replay/sequence checks, bounded memory, denial-of-service budgets and server-owned timestamps. Include negative tests.
5. **Compatibility:** preserve M2 `InputFrame` v1 as canonical simulation payload. Session envelope is a separate layer, not a competing InputFrame shape.

## Two parallel sprints (do not collide on files)

| Agent | Sprint A: immediate | Sprint B: next gate |
| --- | --- | --- |
| Designer | Write `docs/M2_SESSION_ENVELOPE_V1.md` proposal, session lifecycle state diagram, byte/rate/tick bounds and acceptance examples; update benchmark plan to canonical protocol | Define WS/WebRTC benchmark harness interface, scenario IDs and decision thresholds, without choosing winner |
| Gameplay | Review merged #41/#43, implement transport-agnostic session envelope parser/validator with trusted identity injection; no network sockets | Integrate room lifecycle and scripted synthetic client harness; expose identical adapter boundary for WS and WebRTC |
| Graphics | Finish VIS-03 station clarity and VIS-04 hit/KO feedback in independent scoped branches | Address Tester screenshot findings and prepare final visual acceptance candidate |
| Tester | Independently test #41/#43, four-player replay, malformed/oversized input, cross-room spoofing, replay, disconnect and rejoin | Verify M1.5 four-fighter/HUD/station retro vs classic at 640x360, 2x, 3x, mobile, plus production Pages and physical gamepad gaps |

## Required artifacts and gates
- Designer: protocol contract, message examples, lifecycle table, ADR-style trade-offs and measurable acceptance.
- Gameplay: PR with exact commit SHA, tests, build, browser CI, fuzz/negative cases and no premature transport choice.
- Tester: independent PASS / PASS WITH LIMITATIONS / FAIL report for exact SHA, plus reproducible defects and remaining risk.
- Graphics: desktop/mobile retro/classic screenshot artifacts and owner-visible visual comparisons.
- Owner: explicit approval for merges and milestone acceptance. A green PR is not automatically an accepted milestone.

## Benchmark preparation
Use the existing `docs/NETWORK_BENCHMARK_PLAN.md` matrix (2/4/8/12/16 players, 60 Hz sim, 30/60 Hz input, 10/20/30 Hz snapshots, >=5 runs of 120 s). Prioritize 4/8 players, synthetic load before browser comparisons. Record p50/p95/p99 latency, tick duration, bytes/s, CPU/RAM, join success, NAT/TURN fallback and operational cost. Separate authority topology differences from transport differences. Do not claim measured outcomes without runs.

## Remaining documentation debt
- `docs/GOALS.md` no longer carries the historical draft PR #21/#25 wording; the 2026-10-31 goal is archived with its outcomes and a new active goal is recorded (reconciled 2026-11-01).
- `docs/NETWORK_BENCHMARK_PLAN.md` retains an obsolete illustrative InputFrame shape; replace it with a link to canonical codec and the forthcoming envelope, not another wire contract.
- `docs/AGENT_WORKFLOW.md` M1-specific role examples are historical; current queue in `.github/AGENT_TASKS.yaml` is authoritative.
- M1.5 owner acceptance is recorded (2026-11-01) with VIS05-02 and VIS05-03 retained as follow-ups; do not reopen the milestone for those items alone.
