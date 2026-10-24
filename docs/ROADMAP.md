# TurenkiFight – Prototype Roadmap v0.3

**Date:** 2026-10-24. Milestones, not calendar commitments.

## Milestone 0 – Project foundations

- [x] Initial vision and architecture documents
- [ ] Decide code and art licenses
- [ ] Initialize Vite + TypeScript + Phaser client
- [ ] Add Vitest and a simple CI workflow
- [ ] Publish first static page via GitHub Pages

## Milestone 1 – Local playable slice

- [ ] Fixed 384 × 216 arena camera and pixel-perfect scaling
- [ ] Turenki railway station placeholder stage
- [ ] X/Y movement, jump Z and foot-Y sprite sorting
- [ ] Punch, kick, hitboxes, hurtboxes and knockouts
- [ ] Four local player inputs, keyboard/gamepad as available
- [ ] Score Brawl rules, match timer, HUD and results
- [ ] Deterministic fixed-step simulation unit tests

**Exit:** four players can complete a fun local match.

## Milestone 2 – LAN multiplayer

- [ ] Separate input, protocol, simulation and transport
- [ ] Room creation/join and host selection
- [ ] Small signaling backend
- [ ] WebRTC DataChannel star connections
- [ ] Host-authoritative input processing and scorekeeping
- [ ] Prediction, interpolation and reconciliation
- [ ] Test multiple browsers on the same LAN

**Exit:** stable LAN match with consistent authoritative outcomes.

## Milestone 3 – Remote multiplayer

- [ ] Public HTTPS/WSS endpoint for signaling
- [ ] STUN and connection-failure handling
- [ ] TURN fallback where needed
- [ ] Invite links, disconnect/rejoin behavior
- [ ] Test latency, packet loss, jitter and NAT scenarios

**Exit:** players on different networks can complete a match.

## Milestone 4 – Scaling and polish

- [ ] Benchmark eight concurrent players; explore 12–16 without promising support
- [ ] Profile CPU, network bandwidth and HUD readability
- [ ] Refine pixel art, audio and hit feedback
- [ ] Tune combat frame data and scoring
- [ ] Decide whether optional dedicated authoritative servers are needed

## Future modes

Last Man Standing and Deathmatch are planned, but Score Brawl is the sole initial implementation. Keep mode rules pluggable.

## Definition of done for each milestone

A playable build, reproducible automated tests where appropriate, short documentation of known limitations, and no unsupported performance claims.
