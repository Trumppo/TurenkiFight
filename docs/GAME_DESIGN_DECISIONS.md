# TurenkiFight — approved future game design decisions

**Status:** Design specification / future backlog, NOT a claim that these mechanics are implemented. Recorded 2026-10-30. Numeric timings and tuning values below are provisional until playtesting.

## Design intent
Four-player-or-more accessible 2.5D arena brawler: controlled chaos, readable hits, timing and spacing. 80% Smash-like party feel + 20% Street Fighter-like skill; not a randomness ratio. Three action buttons: punch, kick, jump; free planar/depth movement. Multiple players may choose the same character; differentiate player identity and palette. Character archetypes balanced/fast/heavy/reach; character-specific special moves postponed beyond initial M2.

## Core controls and tactical triangle
- Punch: normal punch; with held item, item attack.
- Kick: normal kick.
- Jump: jump.
- Punch + kick: throw a nearby fighter if hands free; if carrying an item, throw the item instead. Item takes priority; carrying an item disables all fighter throws.
- Punch + jump: short all-direction guard; guard is independent of movement/facing direction in the 2.5D arena.
- Attack interrupts vulnerable throw startup; guard defeats normal strikes; throw defeats guard. Guard is brief and cannot be held indefinitely. Guarding an item strike prevents HP damage but may allow small pushback.
- Simultaneous-button recognition/buffering and accidental-input prevention require prototype tests. No new action button.

## Combat reactions
- Punch: light stagger; kick: heavier stagger/knockback.
- Strong impacts, throws or collisions can knock a fighter down.
- **Knockdown != KO**. A knocked-down fighter remains briefly on the ground and stands automatically if not picked up; provisional grounded duration ~1.2 s.
- **Grounded fighters cannot take any damage** from punches, kicks, items or collisions, but can be picked up and thrown by another fighter with free hands.
- Ground pickup is slower and interruptible; a lifted fighter cannot recover mid-throw.
- A fighter thrown from the ground takes **no HP damage** from pickup, flight, landing or impact.
- The grounded fighter thrown as a projectile can knock down other standing fighters; these secondary collisions also do **no HP damage**. One throw may knock down multiple players, but secondary victims do not automatically become new flying projectiles.
- Prevent infinite regrab chains via brief grab immunity or other tested recovery protection. Normal stagger should not be infinitely extended by repeated hits.
- Actual KO at zero HP and respawn remain separate. Whether a KO body can be thrown was not approved; default is **no** until owner decides.
- Standing-fighter throws prioritize displacement, knockdown and crowd control, not large direct damage; precise damage and protection need playtests.

## Pick-up items
- Hybrid spawning: stage-specific fixed items plus items spawned during a match. Spawn logic must be deterministic, seedable and data-driven.
- Automatic pickup when a standing, empty-handed fighter walks over/near an item. No pickup button.
- Carry exactly one item. While carrying, no fighter throws and no pickup of another item.
- Item in hand: punch uses it, kick remains normal, punch+kick throws the item, jump and punch+jump remain jump and guard.
- Dropped item remains eligible for pickup by other fighters; no immediate re-pickup loop by the dropper. Knockdown drops held item. Grounded/airborne fighters cannot pick up items.
- Bat strike causes **strong stagger**, not automatic knockdown. Only a specially strong, predictable hit knocks down; avoid random critical hits. Bat guard prevents HP damage, with possible pushback.
- Items use **time-based lifecycle** rather than a hit-count durability system. Provisional **15 s active lifetime from first pickup**, continuing through drops/ownership changes. Picking up again does not reset timer.
- During the final **3 s** item visibly blinks, increasingly fast, before disappearing. Disappearance must not interrupt an attack already committed.
- Uncollected items have a separate ground despawn timer to avoid clutter.
- Thrown item disappears after collision. Flight direction, velocity, collision count and exact effects remain OPEN.
- Cap loose items (provisional three), configure spawn times/locations and item types per arena. All timers use simulation ticks, not wall time.
- A grounded player cannot be damaged by item attacks.

## Room/lobby (future online multiplayer)
- LOCAL FIGHT distinct from CREATE FIGHT and JOIN FIGHT.
- First entrant hosts room, configures arena, mode, max players, duration and optional code; public/discoverable or private.
- At least two participants, all READY, host starts manually; changes to character reset individual READY, changes to room settings reset all READY.
- Countdown, match, results and return to same room for rematch.
- Separate network connections, player slots and fighter identities; multiple local players may share one network client.
- Room state machine independent of deterministic simulation. Transport decision: central authoritative WebSocket server ([ADR 0001](adr/0001-network-topology.md), owner-approved 2026-11-02); no network measurement exists, and the WebRTC prototype remains an evaluated alternative.

## Design questions still open
1. Exact guard duration, cooldown and throw input buffer; whether guard fully protects against every item projectile.
2. Standing throw damage and grounded regrab protection timing.
3. Strong bat-hit knockdown trigger.
4. Thrown item trajectory, multiple-target collision, damage and recovery.
5. Exact ground despawn time, spawn rates and item type list.
6. Knockdown duration, recovery invulnerability and KO body handling.

## Implementation strategy
Do not bundle all of this into one PR. First define input/state transitions and headless tests for guard/throw/knockdown; then introduce typed items and deterministic spawn/lifetime; finally integrate visuals, effects and balance tests. Each slice needs owner-approved scope.

## Decisions made in November 2026

- **Player limit: eight.** Approved by the owner on 2026-11-03 after establishing that four was never a product
  decision. Implemented as one `MAX_PLAYERS` constant; slots 5-8 are gamepad or bot slots.
- **Three modes:** Score Brawl, Last Man Standing, Deathmatch, with mode chosen at match creation. A full tie
  ends as a draw (owner, 2026-11-03).
- **Local bots:** a deterministic, seeded input policy can fill empty slots so one player can test a full match.
- **Arena:** Ravintola Mesku, selected and visually accepted by the owner on 2026-11-02; the station remains the
  default.
- **Audio:** procedural placeholder cues and chiptune only for now; real samples and mixing are deferred by the
  owner.

## Owner direction 2026-11-07: shrinking field belongs to the mode

- The shrinking-field hazard is a **Deathmatch mode rule**, not an arena property. The Deathmatch zone (`zone.ts`, `modes.ts`) stays a mode rule.
- Arena hazards are fixed, arena-bound data (for example the K-kauppa shelf band, ADR 0006). They do not shrink the playing field.
- Consequence: a shrinking field in another mode is a mode rule change that needs its own decision; it is not added to arena data.
- Status: owner-stated direction. Not an implementation claim.

## Owner decision 2026-11-11: retro-only visual style

- Owner chose: retro is the only supported visual style. The former classic build-time path, fallback art and classic test matrix are removed.
- `VITE_FIGHTER_CANVAS=expanded` remains an optional retro rendering experiment.
- Status: owner decision recorded. The default change itself is not implemented and needs its own PR after the two approvals.

## Owner decision 2026-11-07: desktop only

- The game is not meant to be played on mobile. Touch controls and mobile browser support are out of scope.
- Visual review uses desktop sizes (640x360 logical canvas, 1280x720). Phone-sized captures are not required.
- Status: owner-stated decision.

## Owner direction 2026-11-12: start-to-lobby onboarding

- On browser load, show a retro title/start screen; any user button press leads
  to a main menu with LOCAL FIGHT, CREATE ROOM and JOIN ROOM.
- A new retro splash image is approved as a narrow pre-Gate-G exception to the
  earlier deferral of new graphics. This does not reopen arena art updates or
  authorize broad visual rework.
- Reuse the existing procedural chiptune; no new soundtrack is approved. Since
  browsers block reliable audio autoplay, audio starts after the first user
  activation.
- Local and online participating humans must READY before the host starts.
  Character appearance and display name are per-slot presentation metadata;
  stable P1-P8 identities remain unchanged in simulation/protocol scoring and
  replay.
- The post-start main menu includes LOCAL FIGHT, CREATE ROOM and JOIN ROOM.
- Status: owner direction for implementation. Gate G remains pending until the
  owner playtests and explicitly accepts or gives follow-up direction.
