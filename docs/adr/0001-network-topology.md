# ADR 0001: Network topology for online play

- **Status:** Accepted — owner approved architecture A on 2026-11-02. Architecture B stays in the repository as an evaluated alternative.
- **Date:** 2026-11-02
- **Decision basis (owner-approved 2026-11-02):** documented sources plus single-machine measurements, weighted toward low latency and smooth motion. **No LAN, internet or TURN measurement was performed.**
- **Supersedes:** nothing. **Related:** [M2 transport evidence review](../M2_TRANSPORT_EVIDENCE_REVIEW.md), [local measurement results](../../benchmarks/results/README.md), [session envelope](../M2_SESSION_ENVELOPE_V1.md).

## Context

TurenkiFight is a 4-player, 60 Hz authoritative simulation with full-state snapshots and a
transport-neutral session envelope. Two prototypes exist and are independently tested:

- **Architecture A** — central authoritative WebSocket server (`server/ws/**`), browser or Node clients,
  server-allocated connection identity, envelope gateway, 10/20/30 Hz snapshots.
- **Architecture B** — browser-host authority over WebRTC DataChannels (`src/game/networking/**`,
  `server/signaling/**`), signaling relay that carries only offer/answer/ICE, same simulation and
  gateway inside the host page.

Both run the same 7200-tick fixture and produce identical final-state and ordered-event fingerprints
(`de544fcd…` / `5bb44bd6…`, 47 events). That is correctness evidence, not performance evidence.

## Measured facts (single machine, no network)

From `npm run measure:local`, fixture `7fddf007…`, seed `12345`, 7200 ticks, 600 warm-up ticks
discarded. Full manifests and summaries are committed under `benchmarks/results/`.

| Quantity | Value |
| --- | --- |
| Upstream, per client (canonical + envelope) | `202.0 B/tick` → `12 122 B/s` |
| Upstream, 4 clients aggregated | `48 489 B/s` |
| Snapshot, 20 Hz, canonical / server message | `1 221.7 B` / `1 264.7 B` |
| Downstream per client at 20 Hz | `24 434 B/s` |
| Downstream server total at 20 Hz (4 clients) | `97 735 B/s` |
| Simulation tick duration (run 1 / run 2) | p50 `1.7` / `1.9 µs`, p95 `4.4` / `4.5 µs`, p99 `6.8` / `8.4 µs` |
| Snapshot codec at 20 Hz (run 1 / run 2) | encode p50 `17.7` / `17.7 µs`, p95 `29.3` / `28.5 µs`; decode p50 `9.2` / `8.9 µs`, p95 `17.9` / `17.1 µs` |
| Process (run 1 / run 2) | wall `29.6` / `32.0 ms` for 7200 ticks; peak RSS `118.2` / `118.8 MiB` (process lifetime) |

Interpretation: the simulation and codecs are not the constraint at this scale. Bandwidth is small:
about 0.2 Mbit/s downstream per client at 20 Hz (`24 434 B/s`), about 0.8 Mbit/s for a four-client
server (`97 735 B/s`). Nothing here distinguishes the transports; everything distinguishing happens
on the network, which we did not measure.

## What the sources say

Full citations and exact scope are in [M2_TRANSPORT_EVIDENCE_REVIEW.md](../M2_TRANSPORT_EVIDENCE_REVIEW.md).

- WebSocket is TCP-based; TCP's head-of-line blocking "causes unnecessary delay" for traffic that
  needs reliability without strict ordering (RFC 6455; RFC 4960 §1.1).
- WebRTC DataChannels are SCTP over DTLS over UDP and can be configured unordered with zero
  retransmissions, giving a UDP-like service (RFC 8831 §6.1). A **reliable ordered** channel keeps
  TCP-like behaviour and would largely cancel the advantage.
- That advantage requires an input policy that tolerates loss (redundant input), otherwise lost input
  becomes neutral frames — visible stutter rather than a stall.
- NAT traversal needs ICE and, when hole punching fails, TURN, which is the expensive fallback
  (RFC 8656). CGNAT makes those failures a realistic case, not an exotic one (RFC 6888).
- A browser-host architecture moves authority to a player's page. Backgrounded tabs are frozen and
  their timers stop (Chrome Page Lifecycle API), so a host that switches tabs ends the authoritative
  loop while clients keep sending. Host departure already ends the match in our prototype, with no
  migration.
- Browser support is not a blocker for DataChannels: MDN lists the interface as Baseline, widely
  available (accessed 2026-11-02).

## Decision

**Adopt architecture A — a central authoritative WebSocket server — for the first online milestone,
and keep architecture B as an evaluated alternative rather than the default.**

Rationale, in order:

1. **Smoothness risk dominates under the chosen weighting.** Architecture B's failure modes —
   the authority page being frozen or closed, an unauthenticated peer authority, and cheatability —
   produce hard stalls or a dead match, which is a worse outcome for "smooth motion" than TCP
   head-of-line blocking at our payload sizes. A at least degrades gradually.
2. **The measured workload leaves little room for TCP to hurt.** ~12 kB/s upstream per client and
   ~24 kB/s downstream at 20 Hz is a trivial load. A retransmit costs at least one RTT plus the
   retransmission itself on that stream; with 1.2 kB snapshots that is a short delay, not congestion
   collapse.
3. **B's latency advantage is not free or currently realised.** It needs an unreliable, unordered
   channel *and* redundant input transmission, and neither is implemented or measured. Choosing B
   now would mean adopting an unbuilt, unmeasured input policy on the strength of an unmeasured
   network benefit.
4. **A is the simpler system to harden.** One authority, one process to monitor, no TURN bill, no
   host-departure policy, and the existing envelope gateway already validates every input.

## Consequences

- Inputs stay reliable and ordered; the envelope contract, gateway and current input policy remain
  valid without change.
- Snapshot delivery is reliable; under loss the client will see brief stalls rather than gaps. Client
  interpolation can hide most of this and is the natural next performance step.
- We accept a known latency ceiling under lossy links (TCP head-of-line blocking) and record it as an
  open risk rather than as a measured result.
- Architecture B stays in the repository as tested code. It is not deprecated; it is the fallback if
  playtests show the TCP ceiling is real.
- No TURN infrastructure, TLS termination, authentication or rate limiting is implied by this ADR;
  those are separate hardening tasks.

## Alternatives considered

1. **Architecture B now.** Structurally better for lossy networks, but its authority model adds
   failure modes that hurt smoothness more than TCP does at our scale, and its benefit requires
   unbuilt work. Rejected for the first milestone, retained as an option.
2. **Hybrid: central authority with an unreliable browser transport (WebTransport/QUIC datagrams).**
   This is the technically most attractive answer to the latency criterion: it keeps one authority and
   still avoids TCP head-of-line blocking for snapshots. It is **out of scope** for this ADR because
   no prototype exists, browser support is newer than DataChannels, and it would need its own
   correctness and delivery-policy work. Recorded as the leading candidate if A's latency ceiling is
   observed in practice.
3. **Do nothing / stay local-only.** Rejected: it does not advance the milestone.

## Reconsideration criteria

Reopen this decision if any of the following occurs:

- A playtest measures input-to-photon p95 above the agreed budget (to be set before the first online
  playtest; not yet defined), or players report recurring stalls correlated with packet loss.
- Host-freeze or host-departure incidents are rare enough in architecture B trials that its authority
  risk no longer dominates (requires the deferred `M2-NETWORK-ADDRESSABLE-WEBRTC-HARNESS`).
- A WebTransport prototype demonstrates central authority with unreliable snapshots without breaking
  the envelope contract.
- Snapshot payloads grow enough (for example by moving to delta or event streams) that TCP
  retransmission cost becomes material at our tick rate.

## Explicit non-claims

- No network latency, jitter, loss, join reliability or TURN cost was measured for either
  architecture. Every such field is `NOT_MEASURED` in the manifests.
- This ADR does not state that WebSocket is faster than WebRTC. It states that, on the available
  evidence and the chosen weighting, the central WebSocket authority has the better risk profile for
  a first online milestone.
- The single-machine numbers are one machine on Windows with Node v26.5.1; timings vary by machine.

## Approval

Approved by the project owner on **2026-11-02**: architecture A (central authoritative WebSocket
server) for the first online milestone, with architecture B retained as an evaluated alternative and
the hybrid WebTransport path recorded as the leading reconsideration candidate.

The owner's decision basis was the one recorded at the top of this ADR: documented sources plus
single-machine measurements, weighted toward low latency and smooth motion, with no network
measurement performed. Milestone 5 acceptance as a whole remains a separate owner action; this ADR
records the transport decision only.
