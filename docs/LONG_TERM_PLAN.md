# TurenkiFight long-term plan: chaotic co-op arena brawler

**Status:** Living product roadmap, refreshed 2026-11-11. Owner direction is recorded below; implementation
claims are tied to the repository and test evidence, while future gates still require owner approval.

## 1. Product vision (owner, 2026-11-06)

> A Turenki-themed fighting game: **eight players online** and **up to four players locally**, where **80 % is
> chaos and 20 % is skill**. Spiritual ancestors: *Target Renegade* and *Streets of Rage*.

Translation into design rules:

- **Local focus first.** The living-room case is four humans on one machine, with bots filling the rest. Online is
  the same game with eight humans.
- **Chaos is a feature, not a bug.** Many fighters, moving hazards, throwable objects, noise. But chaos must be
  *legible*: every hazard is telegraphed, every hit has a visible cause, and nothing kills without warning.
- **Skill is spacing and timing.** The 20 % is expressed in positioning, reach, timing and reads. Chaos may decide
  a scramble, but a skilled player must be able to win consistently over several rounds.
- **Beat-em-up feel.** Punchy hits, fast movement, short rounds, immediate rematch. Camera and presentation support
  that feel; simulation stays deterministic.

## 2. Product target and stepping stones

The long-term target is an eight-player browser game played over the network, with a strong local path for up to
four human players and bots filling the remaining slots. The safest route is a sequence of independently testable
gates:

| Gate | Interim objective | Exit evidence |
| --- | --- | --- |
| A | Keep the local match loop deterministic and replayable | headless simulation fingerprints and unit tests remain green |
| B | Make the local lobby honest and configurable | arena, mode and player-count choices produce the exact roster shown in HUD/results |
| C | Make eight-player local play comfortable | controllers, bots, reset, results and retro presentation are readable and browser-tested |
| D | Stabilize the online room contract | typed room/join state, mode, player identity, rejoin and failure paths are tested |
| E | Validate real eight-player network conditions | two-machine RTT, jitter, loss, bandwidth and load measurements are recorded; unknowns stay `NOT_MEASURED` |
| F | Productize the browser multiplayer loop | secure hosting, clear room flow, reconnect/rematch and tested eight-player sessions |
| G | Owner playtest and iterate | owner accepts the feel, readability and fun; unresolved limitations stay documented |

The current work package is Gate B: `LOBBY-L4-SUMMARY`, closing the local lobby selection chain. It must not change
the deterministic simulation or the selected network architecture.

The local browser-to-results path is documented as a numbered flow in
[`LOBBY_FLOW.md`](LOBBY_FLOW.md). It is the shared vocabulary for completing
the local lobby gates before online room work.

## 3. Where the project is now (2026-11-11)

M1, M1.5, M5, M7, M8 and M9 are accepted. The game has three modes, eight players, bots, an ALL BOTS match, a
results celebration, a shrinking-platform Deathmatch (M10, in progress), an authoritative WebSocket prototype and
MIT/CC0 licensing. Known gaps: no measured network, no production security, crowded-fight readability, one arena,
placeholder audio, movement that the owner considers too slow.

## 4. Phase plan

| Phase | Theme | Status (2026-11-07) | Owner gate |
| --- | --- | --- | --- |
| **M10** | Deathmatch identity: shrinking platform | ✅ implemented (#156) | awaiting playtest |
| **M11** | Arcade feel: +20 % movement, hit stop, knockback, camera/audio punch | ✅ implemented (#157, #160, #161) | awaiting playtest |
| **M12** | Chaos layer: throwable bottles, station ambience, damaging arena hazard | ✅ implemented (#162-#165, #173, #177, #180) | part implemented |
| **M13** | Co-op wave mode "Asemahalli" | ✅ implemented locally (#166, #169) and online (#179) | awaiting playtest |
| **M14** | Eight-player online productisation | ✅ TLS, room codes, rate limits, rejoin (#167, #168, #170) and single-machine eight-player numbers (#175); ❌ two-machine measurement owner-blocked | part implemented |
| **M15** | Content and local comfort | ✅ pad pairing, pause, remapping (#178), K-kauppa and its hazard (#172, #180); ❌ characters not needed; ❌ real audio samples owner-blocked | part implemented |

Each phase ends with an owner playtest. A phase is not accepted because it merged; it is accepted because the owner
played it and said so.

## 5. M11 - Arcade feel (next)

**Owner-approved part:** movement speed **+20 %**, implemented: the original `1.3` px/tick baseline became
**`FIGHTER_SPEED = 1.56`** px/tick (**93.6 px/s** at 60 Hz), with diagonal normalisation kept and the arena bounds
unchanged. Every pinned simulation fingerprint moved and is updated deliberately in the M11 PR.

**Proposed additions, in order of value per risk:**

1. **Hit stop.** 2-3 ticks of frozen animation on a clean hit. Improves feel more than any other single change and
   is deterministic if implemented as a state counter. Needs careful testing because it changes timing.
2. **Knockback and hitstun tuning.** Slightly more pushback on kick and jumpkick so hits read at a distance.
3. **Camera and audio punch.** Short shake on KO, sharper hit cue, without changing simulation.
4. **Match pacing.** Re-tune round length and frag limit after the speed change; faster movement shortens chases.

**Accept criteria for the speed slice:** identical inputs produce identical results, all pinned fingerprints are
updated deliberately with old and new values reported, diagonal movement is not faster than axis movement, the
arena bounds still contain every fighter, bots remain competitive (they share the same speed), and the owner
confirms the game *feels* faster.

**Risk:** a 20 % speed change invalidates every pinned simulation fingerprint and every balance assumption. That is
acceptable once, and must be documented, not smuggled in.

## 6. M12 - Chaos layer

- **Throwable objects** (bottle, chair, sign): pickup, hold, throw, break. This is the object system already
  described in `GAME_DESIGN.md`: data-driven entities with stable ids, deterministic ownership and event ordering,
  carried in the snapshot and synchronized over the network.
- **Station events:** the train warning becomes a shared hazard in more modes; platform lights, announcements.
- **Chaos budget:** every mode gets a small number of telegraphed chaos sources rather than random damage. No
  unannounced instant deaths.

**Dependency:** needs a snapshot/protocol extension for objects, which is the largest protocol change since ADR
0002. It needs its own ADR before implementation.

## 7. M13 - Co-op wave mode

A mode where one to four local players (or up to eight online) survive waves of AI brawlers in the station, with
throwables, a boss wave and a score at the end. This is the closest thing to the stated spiritual ancestors that
fits the existing fixed-camera arena, and it reuses the bot policy, the mode rules and the results screen.

**Open design questions:** wave composition, whether players share a life pool, how scoring works, whether bots
can fill player slots.

## 8. M14 - Eight-player online productisation

1. **Two-machine measurement** (owner-run): bandwidth, RTT, jitter, loss, server load, snapshot gaps.
2. **Security and ops:** `wss`/TLS, room codes, minimal authentication, rate limiting, connection caps.
3. **Session quality:** rejoin after a drop, rematch (already done), clear host-less flow for a central server.
4. **Eight-player load:** verify snapshot budgets and readability at eight humans.

Everything here stays `NOT_MEASURED` until the owner runs the measurement; agents must not invent numbers.

## 9. M15 - Content and local comfort

- More arenas from the existing candidates (K-kauppa, yläaste, keskustan kävelykatu), each with its own hazard.
- More characters beyond P1-P8 if the roster needs it.
- Local input comfort for four humans: gamepad pairing flow, per-slot remapping, pause.
- Audio: real samples and mixing once the owner asks.

## 10. What we deliberately do not do

- No side-scrolling camera or scrolling stages: the fixed arena is the identity and keeps netcode simple.
- No matchmaking service, accounts or progression while the game is a local/LAN product.
- No physics engine, no rollback netcode. Deterministic fixed-step plus interpolation is enough at this scale.
- No procedurally generated levels. Turenki locations are hand-made.

## 11. How this plan is kept honest

- Every phase lists what it does **not** include.
- Every claim about performance or networks is either measured and linked, or marked `NOT_MEASURED`.
- Every phase ends with an owner playtest; merging is not acceptance.
- The plan is updated when the owner's direction changes, not silently reinterpreted.
