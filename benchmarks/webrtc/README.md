# M2 WebRTC architecture-B prototype (loopback only)

Task: `M2-WEBRTC-PROTOTYPE`.

This slice prototypes **architecture B: browser-host authority with WebRTC DataChannels and a
room-scoped WebSocket signaling relay**. It is not a transport selection, is not deployed, and makes
no production security, NAT or TURN claims. The WebSocket prototype under `server/ws` and
`benchmarks/ws` is unchanged.

## What runs

- `server/signaling/signalingRelay.ts` — transport-neutral room relay for SDP offer/answer and ICE
  candidates only. It imports neither `SessionEnvelopeGateway` nor simulation code, so a signaling
  message can never authorize input, claim a slot or advance a tick.
- `server/signaling/signalingServer.ts` — Node `ws` transport. Each socket gets a trusted `sig-N`
  identity; payloads cannot set it. `GET /health` exists for readiness probes.
- `server/signaling/devSignalingServer.ts` — manual development entry (`npm run signaling:dev`).
- `src/game/networking/signalingMessages.ts` — strict prototype signaling codec (version, kinds,
  exact fields, SDP/candidate size caps).
- `src/game/networking/signalingClient.ts` — browser-safe signaling client using the global
  `WebSocket` API.
- `src/game/networking/webrtcHostSession.ts` — browser-host authority. It reuses the existing
  `AuthoritativeWsSession` (deterministic `step()` + `SessionEnvelopeGateway`) and allocates a
  trusted `rtc-N` connection ID per accepted DataChannel.
- `src/game/networking/dataChannelSession.ts` — attaches the shared `SessionClientCore` to one
  DataChannel; this is the WebRTC counterpart of `browserWsAdapter`.
- `src/game/networking/browserWebrtcAdapter.ts` — client `RTCPeerConnection`/DataChannel adapter.
- `src/game/networking/browserWebrtcHost.ts` — host signaling + `RTCPeerConnection` shell that
  answers offers and hands incoming channels to `WebrtcHostSession`.
- `benchmarks/webrtc/runWebrtcBenchmark.ts` — bounded correctness runner (`npm run bench:webrtc`).

## Behaviour

- Clients send the existing canonical `sessionEnvelope` v1 over the DataChannel. Ownership,
  duplicate, late/future tick, replay and sequence rules are unchanged because the same gateway
  handles them.
- The host replies with the prototype server-message codec (`welcome`, `join-result`, `roster`,
  `match-start`, `snapshot`, `error`, `pong`, `match-end`, `run-complete`, `session-closed`).
- The match starts through the existing host-role `beginMatch()` path once the configured roster is
  full. The prototype does not add a host-only start envelope.
- A client DataChannel close revokes that connection's slots, queued input and sequence domain; the
  match continues with neutral input for the vacated slot.
- A host DataChannel close terminates the session with `session-closed: host-lost`. Host authority
  is never migrated, and a late peer can only join in the lobby.
- Signaling is control-plane only: it relays one addressed offer/answer and individual ICE
  candidates to one peer in the same room. It has no gameplay path.

## Commands

```bash
npm run bench:webrtc                 # 300 bounded ticks, 20 Hz snapshots, emulated DataChannel
npm run bench:webrtc -- --ticks=60 --snapshot-hz=10
npm run signaling:dev -- --port 4174 --host 127.0.0.1
npx vitest run tests/webrtc-prototype.test.ts
npx playwright test tests/browser/webrtc.spec.ts
```

The runner writes `benchmarks/out/<runId>.json` (git-ignored). It compares bounded-tick state and
ordered-event fingerprints with the in-memory BASE-4 reference and records:

- `result: "NOT_MEASURED"`;
- `measurements.latency|bandwidth|cpu|tickPacing: "NOT_MEASURED"`;
- `environment.signaling: "in-memory"`, `turn: false`, `natTraversal: "not-attempted"`,
  `browser: "NOT_MEASURED"`.

No wall-clock, RTT, throughput, jitter, loss, CPU or tick-pacing value is invented. The runner uses
an ordered in-memory DataChannel pair; it does not open ICE, DTLS, TURN, signaling sockets or a real
network path. A `matchesInMemoryReference: true` result means the host consumed the same canonical
inputs and produced identical fingerprints for the bounded range. It is a correctness observation,
not a network measurement.

## Tests

`tests/webrtc-prototype.test.ts` is deterministic and needs no socket or browser. It injects an
in-memory DataChannel pair and covers trusted host-allocated identity, payload spoofing, roster
freeze, premature and unauthorized input, snapshot codec emission, non-host disconnect, host-channel
loss without authority migration, signaling room scoping and rejection paths, the manifest, and
source-level browser/server import boundaries.

`tests/browser/webrtc.spec.ts` is ONE real-Chromium test. It starts a signaling relay on an ephemeral
loopback port, has two pages negotiate a loopback DataChannel with host candidates only, then
asserts a joined P1 slot, one accepted input, and an authoritative snapshot. If the Chromium build
has no `RTCPeerConnection`, the test skips with an explicit reason. It does not provision TURN.

## Dependencies and bundle boundary

Client code uses browser APIs only (`WebSocket`, `RTCPeerConnection`, `RTCDataChannel`). No native
WebRTC npm package is added. `ws` remains **dev-only** and is imported only by `server/ws/`,
`server/signaling/` and benchmark/test tooling. `src/game/networking` contains no `ws` or `node:`
imports, and the app entry (Phaser scene) does not import this prototype.

## Limitations

- No authentication, TLS, origin checks, authorization provider, rate limiting or production
  hardening. Trusted identity here means a host- or relay-allocated transport ID only.
- No STUN/TURN, NAT traversal, deployment, reconnect token or host migration. The browser test uses
  loopback host candidates, not a real network path.
- No client prediction, rollback, interpolation or jitter buffer.
- Signaling is a single-room prototype relay; one host and up to four clients (`maxPeers` 5).
- No latency, bandwidth, CPU, tick-pacing or real-network measurement. No architecture decision is
  implied by this prototype.
