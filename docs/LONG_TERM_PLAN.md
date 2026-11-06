# TurenkiFight long-term plan: chaotic co-op arena brawler

**Status:** Designer plan, 2026-11-06. Owner direction recorded below; the phases after M11 are proposals and
need their own approval before implementation.

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

## 2. Where the project is now (2026-11-06)

M1, M1.5, M5, M7, M8 and M9 are accepted. The game has three modes, eight players, bots, an ALL BOTS match, a
results celebration, a shrinking-platform Deathmatch (M10, in progress), an authoritative WebSocket prototype and
MIT/CC0 licensing. Known gaps: no measured network, no production security, crowded-fight readability, one arena,
placeholder audio, movement that the owner considers too slow.

## 3. Phase plan

| Phase | Theme | Why it comes here | Owner gate |
| --- | --- | --- | --- |
| **M10** | Deathmatch identity: shrinking platform | Fixes the "Deathmatch is Score Brawl" finding first, because it changes mode rules | direction approved |
| **M11** | Arcade feel: +20 % movement and impact | Cheapest change with the largest perceived effect; owner asked for it explicitly | speed approved; the rest proposed |
| **M12** | Chaos layer: throwable objects and station events | The object system is already specified in `GAME_DESIGN.md` for all modes; it is what makes the game feel like a brawl | proposal |
| **M13** | Co-op wave mode ("Asemahalli") | The Target Renegade / Streets of Rage heritage needs a mode where the point is surviving a crowd together | proposal |
| **M14** | Eight-player online productisation | Measurement first, then security and room flow; relies on M11-M13 being stable | proposal |
| **M15** | Content and local comfort | More arenas and characters once the systems are fun | proposal |

Each phase ends with an owner playtest. A phase is not accepted because it merged; it is accepted because the owner
played it and said so.

## 4. M11 - Arcade feel (next)

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

## 5. M12 - Chaos layer

- **Throwable objects** (bottle, chair, sign): pickup, hold, throw, break. This is the object system already
  described in `GAME_DESIGN.md`: data-driven entities with stable ids, deterministic ownership and event ordering,
  carried in the snapshot and synchronized over the network.
- **Station events:** the train warning becomes a shared hazard in more modes; platform lights, announcements.
- **Chaos budget:** every mode gets a small number of telegraphed chaos sources rather than random damage. No
  unannounced instant deaths.

**Dependency:** needs a snapshot/protocol extension for objects, which is the largest protocol change since ADR
0002. It needs its own ADR before implementation.

## 6. M13 - Co-op wave mode

A mode where one to four local players (or up to eight online) survive waves of AI brawlers in the station, with
throwables, a boss wave and a score at the end. This is the closest thing to the stated spiritual ancestors that
fits the existing fixed-camera arena, and it reuses the bot policy, the mode rules and the results screen.

**Open design questions:** wave composition, whether players share a life pool, how scoring works, whether bots
can fill player slots.

## 7. M14 - Eight-player online productisation

1. **Two-machine measurement** (owner-run): bandwidth, RTT, jitter, loss, server load, snapshot gaps.
2. **Security and ops:** `wss`/TLS, room codes, minimal authentication, rate limiting, connection caps.
3. **Session quality:** rejoin after a drop, rematch (already done), clear host-less flow for a central server.
4. **Eight-player load:** verify snapshot budgets and readability at eight humans.

Everything here stays `NOT_MEASURED` until the owner runs the measurement; agents must not invent numbers.

## 8. M15 - Content and local comfort

- More arenas from the existing candidates (K-kauppa, yläaste, keskustan kävelykatu), each with its own hazard.
- More characters beyond P1-P8 if the roster needs it.
- Local input comfort for four humans: gamepad pairing flow, per-slot remapping, pause.
- Audio: real samples and mixing once the owner asks.

## 9. What we deliberately do not do

- No side-scrolling camera or scrolling stages: the fixed arena is the identity and keeps netcode simple.
- No matchmaking service, accounts or progression while the game is a local/LAN product.
- No physics engine, no rollback netcode. Deterministic fixed-step plus interpolation is enough at this scale.
- No procedurally generated levels. Turenki locations are hand-made.

## 10. How this plan is kept honest

- Every phase lists what it does **not** include.
- Every claim about performance or networks is either measured and linked, or marked `NOT_MEASURED`.
- Every phase ends with an owner playtest; merging is not acceptance.
- The plan is updated when the owner's direction changes, not silently reinterpreted.
