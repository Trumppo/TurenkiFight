# TurenkiFight – Technical Architecture v0.4

**Date:** 2026-10-24  
**Status:** Proposed architecture, not yet implemented. **Network topology and authority placement are undecided pending comparative tests.** See [NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md).

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
    protocol/        # versioned messages, serialization
    networking/      # local, WebRTC, WebSocket adapters
    input/           # keyboard/gamepad → player input frame
    presentation/    # Phaser scenes, camera, animation, HUD
    assets/          # stage art, sprites, audio
server/
  signaling/         # rooms, lobby, WebRTC offer/answer/ICE
  session/           # optional dedicated authoritative simulation
tests/
```

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

- Target 384 × 216 logical pixels at 16:9, nearest-neighbor scaling.
- Fixed world-to-screen transform; no following individual players.
- Ground X/Y and jump Z; sort fighters by Y (feet) each frame.
- Render/update frequencies are decoupled from simulation ticks. Visual effects cannot mutate authoritative state.

## Suggested wire messages

```text
JoinRoom / RoomState / Ready / StartMatch
InputFrame(playerId, tick, buttons, movement)
StateSnapshot(tick, fighters, score, matchClock)
HitEvent / KnockoutEvent / MatchEnded
Ping / Pong / Error
```

Use versioned schemas, message-size limits and explicit disconnect handling. Avoid sending large full snapshots at 60 Hz without measuring bandwidth; choose an appropriate snapshot rate after profiling.

## Deployment and security

- Public GitHub repository; GitHub Pages publishing via Actions when a playable client exists.
- No API secrets or private keys in browser bundles or repository.
- HTTPS for web content, WSS for signaling, appropriate origin checks, room-token validation and rate limits.
- Backend initially can keep ephemeral room state in memory; no database required for prototype.
- Add TURN only if connection testing demonstrates need; document its operational cost.
- Public repository does not imply open-source licensing; select code and art licenses separately.

## Non-goals for initial slice

Accounts, rankings, matchmaking, persistent profiles, microservices, database, anti-cheat beyond basic host validation, production-scale hosting, automatic host migration and generalized rollback for many peers.
