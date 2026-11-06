# M11: arcade feel - hit stop, knockback and impact feedback

**Status:** Design spec, 2026-11-06. Movement +20 % is already implemented (PR #157). The rest of M11 is being
implemented under the active long-term goal.
**Related:** [LONG_TERM_PLAN.md](LONG_TERM_PLAN.md) M11.

## 1. Goal

Make hits feel like hits. The owner's target is a chaotic brawler with beat-em-up punch: fast movement (already
done), short rounds, immediate feedback. M11 adds impact without changing the rules of who wins.

## 2. Hit stop (simulation)

- On a clean hit, freeze the fight for **3 ticks**: no movement, no attack progress, no new hits.
- Implement as a simulation counter (`hitStopTicks`) so it is deterministic and replayable; it advances with the
  tick and never reads wall time.
- During hit stop the tick still advances (timers keep running) but fighters do not move and attack frames are
  frozen. The hit that caused it has already been applied.
- Consecutive hits do not stack beyond the maximum: a new hit during hit stop refreshes the counter but never
  exceeds 3.
- Applies to punch, kick and jumpkick; a KO can extend it (proposal: KO uses 5 ticks) so the knockout reads.
- No hit stop outside the `fighting` phase.

**Acceptance:** identical inputs produce identical results; hit stop never leaves a fighter stuck; timers still
expire correctly; the counter is visible to tests; every pinned fingerprint is updated with old and new values.

## 3. Knockback and hitstun (simulation)

- Add a small deterministic push on hit: punch pushes the target 2 px, kick 4 px, jumpkick 6 px, applied over the
  hitstun frames in the attacker's facing direction.
- Knockback never moves a fighter outside the arena bounds and never through another fighter's position (clamping
  is enough; no collision solver).
- Hitstun stays close to today's values; the point is that the target visibly slides, not that they are helpless
  longer.
- A knockout keeps the existing KO handling.

**Acceptance:** measured displacement per move; bounds respected at the arena edges; no fighter ends up inside a
wall or below the floor; determinism preserved.

## 4. Camera and audio punch (presentation)

- Short camera shake on a clean hit that becomes a KO; no shake on ordinary hits beyond a small kick.
- Sharper, higher-pitched hit cue; the existing placeholder audio stays procedural.
- Reduced motion preference disables shake.
- No simulation change; driven by the existing `HitLanded` / `Knockout` events.

## 5. Match pacing (tuning, after playtest)

Keep the 2:00 timer and the 20-frag limit for now. After the owner plays with the faster movement and hit stop,
re-tune both if rounds feel long or short. This is a tuning task, not a code design.

## 6. Risks

- Hit stop changes the timing of every trade; combo windows and bot behaviour must be re-verified.
- Knockback can push a fighter out of reach mid-combo, which may feel worse; measure before tuning further.
- Every simulation change invalidates pinned fingerprints; they must be reported, not hidden.
