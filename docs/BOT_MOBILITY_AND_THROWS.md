# Bot mobility and throwing: what is possible now

**Status:** Design note, 2026-11-06. Owner report: bots do not jump much and never throw.
**Related:** `src/game/input/botPolicy.ts`, `docs/GAME_DESIGN.md` (object system), [LONG_TERM_PLAN.md](LONG_TERM_PLAN.md) M11/M12.

## 1. Why bots rarely jump

`botPolicy.ts` allows a jump only when all of these hold:

- the bot is grounded, can act and is not attacking;
- the target is **farther than kick reach** (`distance > MOVES.kick.reach`);
- a seeded noise draw is below `jumpChance` (currently **0.02 per tick**).

Two consequences:

- The jump window is the approach phase only. Once in reach, the bot never jumps, so there is no jump-in attack.
- The +20 % speed change made the approach shorter, so the window is now even smaller. Jumps became rarer without
  anyone touching the policy.

`jumpkick` exists, but a bot only uses it when it is **already airborne and in range**, which almost never happens
because it does not jump into range.

## 2. Why bots never throw

**There is no throw in the game.** The simulation has punch, kick, jumpkick and jump. No grab, no throw, no carried
objects. The object system that would allow throwing bottles and chairs is described in `GAME_DESIGN.md` as a
future system for all modes, and is planned as M12. Bots cannot do something the rules do not have.

## 3. Slice A - bot mobility (small, no protocol change)

Tune the existing policy so bots look alive and use the moves that exist:

1. **More jumps while approaching:** raise `jumpChance` so a bot jumps roughly a few times per match rather than
   almost never. Exact value to be tuned against a measured jumps-per-minute count, not guessed.
2. **Jump-in attacks:** allow a jump when the target is within about 1.5x kick reach, so the bot can jump and then
   use the existing `jumpkick` on the way down.
3. **Occasional evasive jump:** a small chance to jump when the bot just took damage or is cornered, so the
   movement does not look purely linear.
4. **Keep determinism:** still only seeded `noise`, still a pure function of state and tick. Same seed, same match.

**Acceptance:** a measured jump count per match before/after on a fixed fixture; at least a few jumps per bot per
match; jump-in jumpkicks appear in the event stream; determinism preserved; bot fixture pins updated deliberately
with old and new values.

**Risk:** jumping reduces combat uptime. The tuning must be measured, not just "more chaotic".

## 4. Slice B - grab and throw (bigger, needs a decision)

The beat-em-up heritage (Target Renegade, Streets of Rage) has grabbing and throwing. A minimal version:

- A new **grab** action: when close and facing the opponent, grab them (short hold, target can mash out).
- A **throw**: while holding, a direction plus attack throws the opponent in that direction for damage and a
  knockdown.
- Bots use it: grab when very close and the target is not attacking, throw toward the nearest wall or crowd.

Cost: a new input action (protocol), new simulation states (holding, held, throw arc), new sprites for grab/hold/
throw, balance and bot logic. It is a real feature, not a tweak.

Alternative: **item throwing** through the M12 object system, which the owner already wants for all modes. That
gives "throwing" without a new body-to-body mechanic, but it arrives with M12 and needs an ADR for objects in the
snapshot.

## 5. Recommendation

Do **Slice A now**: it is small, deterministic, needs no protocol change, and directly fixes "bots don't jump".

Then decide separately between **Slice B (grab/throw)** and **M12 items**. My recommendation is to build the object
system first, because it serves every mode and gives both humans and bots something to throw, and it matches the
80 % chaos goal better than a single grab move.
