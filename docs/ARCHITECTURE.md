# TurenkiFight – Technical Architecture v0.5

**Updated:** 2026-11-03 (player limit, modes, bots, audio, online prototype).

**Date:** 2026-11-01
**Status:** Partially implemented. The client, deterministic simulation, transport-neutral protocol v1 and in-memory authorized session ingress exist; **network transport and authority placement are undecided pending comparative tests**. See [NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md), [M2_INPUT_PROTOCOL.md](M2_INPUT_PROTOCOL.md) and [M2_SESSION_ENVELOPE_V1.md](M2_SESSION_ENVELOPE_V1.md).

## High-level model

```text
GitHub repository
  └─ GitHub Actions build → GitHub Pages (static HTML/CSS/JS/assets)
                                ↓
                         Browser clients
                       ↙       ↓       ↘
                 local input  rendering  network adapter
                                ↓
                      deterministic simulation
                                ↕
                      authoritative match host
                                ↑
                small external Linux backend
                lobby / rooms / signaling
```

GitHub Pages serves static files only; it **cannot** host a persistent WebSocket server, run server-side game sessions, or act as a TURN server.

## Candidate stack

- **Client:** TypeScript + Vite + Phaser 3 for rendering/input/scene management.
- **Simulation:** framework-independent TypeScript module with fixed 60 Hz update, seeded randomness, explicit input frames and serializable state.
- **Tests:** Vitest for deterministic simulation and rules; Playwright for browser smoke tests.
- **Lobby/signaling or central authority:** small WebSocket service on a separately hosted Linux machine, exposed via HTTPS/WSS (Caddy or Nginx), depending on benchmark results.
- **Transport candidates:** central WebSocket/WSS and browser-host WebRTC DataChannel, with STUN and TURN fallback (coturn if required) for WebRTC.
- **Dedicated server mode:** optional later; WebSocket or WebRTC transports can share the same simulation/protocol.
- These choices are candidates to validate, not immutable commitments.

## Module boundaries

```text
src/
  game/
    simulation/      # pure fixed-step rules, collision, combat
    modes/           # ScoreBrawlMode, future modes
    protocol/        # versioned InputFrame, StateSnapshot, EventBatch, replay
    session/         # trusted-identity ingress, roster, bounded input staging
    networking/      # transport adapters (future: local, WebSocket, WebRTC)
    input/           # keyboard/gamepad → player input frame
    presentation/    # Phaser scenes, camera, animation, HUD
    assets/          # stage art, sprites, audio
benchmarks/          # deterministic fixtures, in-memory transport adapter, manifests
server/
  signaling/         # rooms, lobby, WebRTC offer/answer/ICE (future)
  session/           # optional dedicated authoritative simulation (future)
tests/
```

`src/game/protocol/` and `src/game/session/` are transport-neutral: they must not import Phaser, DOM or any socket library. A transport adapter supplies trusted connection identity and bytes; it never lets a payload assert its own player slot.

Simulation owns the truth of positions, health, scores and match state. Presentation never determines combat outcomes from sprite overlap. Use foot-Y depth sorting, with Z affecting the sprite's screen offset but not its ground position.

## Networking approach

**Authoritative** topology, with authority placement **not yet selected**. Candidate A runs the authoritative simulation on a central WebSocket server; candidate B runs it in one player's browser with WebRTC DataChannel star connections. Clients send timestamped/sequence-numbered input frames, predict their own movement, interpolate other fighters, and reconcile corrections from the host.

- Prefer star topology for many players; avoid full peer-to-peer mesh because connection count grows quadratically.
- WebRTC requires signaling to establish peer connections. TURN relaying may be necessary when direct connections fail; this adds bandwidth and hosting cost.
- Full multiplayer rollback is **not required for the first prototype**. Start with prediction, interpolation and reconciliation; benchmark feel and consistency.
- A browser host disconnecting ends the session unless host migration is implemented later.
- Server-side checks and protocol limits should prevent malformed messages and unbounded rooms.

## LAN and remote play

- **Online:** clients download from GitHub Pages, then either connect directly to an authoritative WSS server (candidate A), or use WSS signaling to establish WebRTC connections to a browser host (candidate B).
- **LAN with internet access:** the same flow may work; peers can negotiate local network paths.
- **Fully offline LAN:** static client and signaling service must be served locally; GitHub Pages cannot be depended on during offline operation. Browsers may require a secure context for some APIs, so local deployment needs testing.
- Multiple players on one browser can send separate logical player inputs through one transport connection.

## Rendering and fixed camera

- Target **640 × 360** logical pixels at 16:9, nearest-neighbor scaling; art is authored on a provisional 320 × 180 grid.
- Fixed world-to-screen transform; no following individual players.
- Ground X/Y and jump Z; sort fighters by Y (feet) each frame.
- Render/update frequencies are decoupled from simulation ticks. Visual effects cannot mutate authoritative state.

## Implemented wire contracts

Gameplay payloads use the canonical v1 codecs in `src/game/protocol/` and are documented in [M2_INPUT_PROTOCOL.md](M2_INPUT_PROTOCOL.md): versioned `InputFrame`, `StateSnapshot` and `EventBatch`, with strict validation, byte caps, diagnostic FNV fingerprints and bounded replay verification. Transport-level concerns (session/envelope identity, sequence, target tick, room binding) live in `src/game/session/**`; the contract is owner-approved and implemented, including a trusted gateway that binds connection identity outside the payload. Snapshot mode fields are optional and canonically omitted for Score Brawl ([ADR 0002](adr/0002-mode-fields.md)); do not add a competing gameplay codec. Versioned schemas, message-size limits and explicit disconnect handling remain mandatory, and large full snapshots at 60 Hz must be measured before being adopted.

## Deployment and security

- Public GitHub repository; GitHub Pages publishing via Actions when a playable client exists.
- No API secrets or private keys in browser bundles or repository.
- HTTPS for web content, WSS for signaling, appropriate origin checks, room-token validation and rate limits.
- Backend initially can keep ephemeral room state in memory; no database required for prototype.
- Add TURN only if connection testing demonstrates need; document its operational cost.
- Public repository does not imply open-source licensing; select code and art licenses separately.

## Non-goals for initial slice

Accounts, rankings, matchmaking, persistent profiles, microservices, database, anti-cheat beyond basic host validation, production-scale hosting, automatic host migration and generalized rollback for many peers.

## Game modes, bots and player count

- Modes are a typed rules object passed at match creation (`src/game/simulation/modes.ts`): `score-brawl`,
  `last-man-standing`, `deathmatch`. The simulation loop reads the rules; there is no per-tick mode branching
  scattered through the code. Score Brawl omits mode fields entirely so its snapshots stay byte-identical.
- A full tie (HP, KOs and damage equal) ends as a draw by owner decision (2026-11-03).
- The supported maximum is **eight players**, defined once as `MAX_PLAYERS` in
  `src/game/protocol/players.ts`; codecs, session, server and WS client derive from it and reject nine or more.
  A schema-valid eight-fighter snapshot is 83,373 bytes, so the snapshot byte cap is 131,072; measured
  eight-player snapshots are about 2.3 kB in normal play.
- Local bots are a pure, seeded input policy (`src/game/input/botPolicy.ts`) that reads only state, player id and
  seed. Bots are ordinary input producers, so scoring, KOs, respawns and elimination go through unchanged rules.
- Audio is presentation-only: procedural placeholder cues and a looping chiptune driven by an event cue bridge
  (`src/game/presentation/audio/`), with a gesture unlock and persisted mute/volume. No audio path may call
  `step()`.

## Online prototype

`server/ws/**` serves authoritative matches; `online.html` / `src/online.ts` render interpolated snapshots with no
prediction and show connection state, RTT and a snapshot counter. The WebRTC browser-host prototype
(`src/game/networking/webrtcHostSession.ts`, `server/signaling/**`) remains in the repository as an evaluated
alternative. None of this is production-hardened: no TLS, authentication, rate limiting, reconnect token or host
migration, and real network behaviour is unmeasured.
