# M2 transport evidence review: WebSocket authority vs WebRTC browser host

**Status:** Design evidence review. Not a decision. The selection is made by the owner in
[adr/0001-network-topology.md](adr/0001-network-topology.md) after the single-machine measurements
(`M2-SINGLE-MACHINE-MEASUREMENTS`) exist.
**Date:** 2026-11-02
**Owner weighting (2026-11-02):** low latency and smooth motion are the criteria that matter. Cost,
operability and anti-cheat are recorded as risks, not as decision criteria.

> **Scope limit.** No LAN, internet or TURN measurement was performed for this review. Everything
> below comes from published specifications and documentation plus the architecture we already built.
> Nothing here is a measurement of TurenkiFight on a real network, and it must not be cited as one.

## 1. What the sources establish

| ID | Source | Date / version | What it establishes for us |
| --- | --- | --- | --- |
| S1 | RFC 6455, *The WebSocket Protocol*, IETF Standards Track | December 2011 | WebSocket is "layered over TCP" and "an independent TCP-based protocol" (§Abstract, §1.7). Its only framing is message segmentation; there is no per-message ordering or reliability control to tune. |
| S2 | RFC 4960, *Stream Control Transmission Protocol*, IETF Standards Track, §1.1 | September 2007 | Names the exact weakness we care about: "the head-of-line blocking offered by TCP causes unnecessary delay" for applications that need reliable transfer without strict sequence maintenance, or only partial ordering. |
| S3 | RFC 8831, *WebRTC Data Channels*, IETF Standards Track | January 2021 | Data channels run SCTP over DTLS over ICE/UDP (§1, §5). Messages can be sent ordered or unordered, reliable or partially reliable (§6.1, §6.3). Setting retransmissions to zero with unordered delivery gives "a UDP-like service where each user message is sent exactly once and delivered in the order received" (§6.1). Section 3.1 explicitly lists "a real-time game where position and object state information are sent via one or more unreliable data channels" as a use case. The sender SHOULD disable Nagle "to minimize the latency" (§6.6). |
| S4 | RFC 8656, *TURN*, IETF Standards Track | February 2020 | TURN is the fallback when hole punching fails (§1). Relaying "comes at a high cost to the provider of the TURN server since the server typically needs a high-bandwidth connection to the Internet", so it should be used "only when a direct communication path cannot be found" (§1). Per-message overhead is 36 bytes for Send/Data indications, or a 4-byte header for ChannelData (§3.5). |
| S5 | RFC 6888, *Common Requirements for Carrier-Grade NATs*, IETF BCP 127 | April 2013 | CGNAT shares one public IPv4 address among subscribers and "introduce[s] substantial limitations"; "some [applications] may not function at all in such an environment" (§1). It notes that "some games and peer-to-peer applications require [endpoint-independent filtering] for the NAT traversal to work" (§3, REQ-7). |
| S6 | Chrome for Developers, *Page Lifecycle API* (Philip Walton) | Published 2023-12-01, updated 2026-10-16, accessed 2026-11-02 | "Modern browsers today will sometimes suspend pages or discard them entirely when system resources are constrained." In the frozen state "the browser suspends execution of … task queues … This means things like JavaScript timers and fetch callbacks don't run." |
| S7 | MDN, *RTCDataChannel* | Last modified 2026-02-13, accessed 2026-11-02 | Browser support: listed as Baseline, "widely available" (the page shows the precise introduction date in its compatibility table, which can change; the review therefore cites only the stable statement). `ordered` defaults to `true`; `maxRetransmits` and `maxPacketLifeTime` exist, so partial reliability is a per-channel choice. Wire format is "UDP/DTLS/SCTP" or "TCP/DTLS/SCTP". |

## 2. What follows for our two architectures

### 2.1 Latency behaviour when a packet is lost

- **Architecture A (central WebSocket).** Input and snapshots share one TCP stream per client (S1).
  A lost segment is retransmitted and everything behind it waits (S2). For a 60 Hz input stream with
  20 Hz snapshots this means a stall equal to at least one RTT plus retransmission time, and it
  affects *both* directions independently. On a clean LAN this rarely triggers; on Wi-Fi, mobile or
  congested links it is the dominant jitter source.
- **Architecture B (WebRTC DataChannel).** The transport is UDP-based with SCTP on top (S3). If we
  configure the channel as unordered with zero retransmissions, a lost message is simply lost and
  later messages do not queue behind it (S3 §6.1). That removes transport-level head-of-line blocking.
- **Critical nuance.** WebRTC is not automatically lower-latency. A *reliable, ordered* DataChannel
  gives TCP-like ordering within a stream, and all streams in one SCTP association share a
  congestion window (S3 §5). Choosing WebRTC without changing the input policy would buy little for
  latency. The latency benefit requires an unreliable/unordered channel.

### 2.2 What that implies for our session semantics

Our current envelope contract requires each input to be accepted at most once and rejects late or
replayed ticks; a missing input falls back to neutral. On an unreliable channel that fallback becomes
common under loss, which shows up as stutter rather than as a stall. To get the latency benefit
without visible stutter, inputs would need redundancy (for example sending the last N inputs per
message, or repeating each input twice), and snapshots would need to be self-contained and
loss-tolerant. Full snapshots already are; the input side is not. **This is a real design cost of
architecture B and belongs in the ADR.**

### 2.3 Connectivity, cost and operations

- **A:** outbound TCP to one server; works through most proxies and firewalls; one process to run,
  monitor and secure; one authority, so no per-match trust problem.
- **B:** ICE with STUN, and TURN relay when hole punching fails (S4). TURN is the only reliable
  fallback for symmetric NAT and CGNAT, and it carries all match traffic for those pairs at the
  provider's bandwidth cost (S4). CGNAT is common enough that the failure mode must be assumed, not
  treated as exotic (S5). Signaling is small and cheap; the relay is not.

### 2.4 Browser-host authority risks

These are independent of transport performance and are not measured by anything we did:

- One player's browser is the authority, so that player can tamper with the simulation.
- If the host closes the tab, the match ends; our prototype documents exactly that, with no
  migration.
- If the host tab is backgrounded and the browser freezes it, timers stop (S6), so the authoritative
  tick loop stops while clients keep sending. On mobile this is a realistic event, not a corner case.

### 2.5 Browser support

DataChannel is widely available (S7), so availability alone does not rule out architecture B. Mixed
support quality for partial reliability and for mobile backgrounding remains a real risk; we did not
test it.

## 3. Where the evidence points, and where it does not

Read strictly against the owner's weighting (latency and smooth motion first), the sources support
one structural statement:

> A WebRTC DataChannel configured as unordered and unreliable avoids the TCP head-of-line blocking
> that architecture A cannot avoid, and that is the mechanism most directly connected to smooth
> motion under loss. A central WebSocket server has no equivalent mechanism; its latency floor is
> the TCP retransmission behaviour described in S2.

They do **not** support these claims, and the ADR must not make them:

- That WebRTC is faster for TurenkiFight in absolute terms — we measured no network.
- That player experience will be better — that needs playtesting on real links.
- That TURN cost, CGNAT behaviour or mobile backgrounding are acceptable — we measured none of them.

Two further caveats matter for an honest ADR:

1. If we keep a reliable ordered channel, the main latency argument for B largely disappears.
2. Choosing B moves a trust and availability problem (host authority, host departure, host freeze)
   from the server we control to a player we do not.

## 4. What the ADR still needs

- The single-machine measurements: bytes per input and snapshot, tick duration, snapshot cost, CPU.
  These do not settle latency, but they bound bandwidth and host CPU for both designs.
- An explicit statement that no network measurement exists.
- A recorded decision on the input redundancy policy if B is chosen; without it the choice is empty.
- Reconsideration triggers, for example: measured p95 input-to-render latency in a real playtest
  exceeding a stated budget, TURN relay share above a stated threshold, or host-freeze incidents
  during playtests.

## 5. Sources

1. Fette, I., Melnikov, A. *The WebSocket Protocol*. RFC 6455, IETF, December 2011.
   <https://www.rfc-editor.org/rfc/rfc6455>
2. Stewart, R. (ed.). *Stream Control Transmission Protocol*. RFC 4960, IETF, September 2007.
   <https://www.rfc-editor.org/rfc/rfc4960>
3. Jesup, R., Loreto, S., Tüxen, M. *WebRTC Data Channels*. RFC 8831, IETF, January 2021.
   <https://www.rfc-editor.org/rfc/rfc8831>
4. Reddy, T. (ed.), Johnston, A. (ed.), Matthews, P., Rosenberg, J. *Traversal Using Relays around
   NAT (TURN)*. RFC 8656, IETF, February 2020. <https://www.rfc-editor.org/rfc/rfc8656>
5. Perreault, S. (ed.), Yamagata, I., Miyakawa, S., Nakagawa, A., Ashida, H. *Common Requirements
   for Carrier-Grade NATs (CGNs)*. RFC 6888 / BCP 127, IETF, April 2013.
   <https://www.rfc-editor.org/rfc/rfc6888>
6. Walton, P. *Page Lifecycle API*. Chrome for Developers, published 2023-12-01, updated
   2026-10-16, accessed 2026-11-02. <https://developer.chrome.com/docs/web-platform/page-lifecycle-api>
7. MDN contributors. *RTCDataChannel*. Last modified 2026-02-13, accessed 2026-11-02.
   <https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel>
