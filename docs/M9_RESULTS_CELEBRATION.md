# M9 results celebration: winner reveal and podium

**Status:** Design spec, owner-requested 2026-11-03. Not implemented.
**Owner request:** at the end of a match there should be an animation or similar honouring the victory: the
winner's name large, then the next two places when more than three players took part.

## 1. What the player sees

1. Match ends; the arena freezes (already true since results no longer step).
2. A short reveal sequence (about 1.5–2 s, skippable):
   - the winner's name large, with their player colour and a short celebratory flourish (confetti pixels,
     starburst or a raised-arm pose — procedural, consistent with the retro style);
   - second and third place below, smaller, with their names and the deciding metric;
   - if more than three players took part, remaining places in one compact line (4th–8th).
3. The existing results text (winner, reason, score/frag table, rematch hint) stays available underneath or
   after the animation — the animation must not remove information.
4. A draw shows **DRAW** prominently with the tied players, not a false winner.

## 2. Ranking rules (must match the modes)

| Mode | Order |
| --- | --- |
| Score Brawl | score desc, KOs desc, hits received asc, id |
| Deathmatch | frags desc, deaths asc, damage dealt desc, id |
| Last Man Standing | survivor first, then reverse elimination order; remaining places by KOs dealt, damage dealt, id |

Last Man Standing has no stored elimination order in the simulation. The presentation derives it from observed
`Knockout` events (`target` is eliminated), which arrive in the state event stream, so no simulation change is
needed and pinned hashes stay untouched.

A draw is a valid result: the spec already says a full tie ends as a draw (owner decision 2026-11-03).

## 3. Accessibility and performance

- The reveal must be skippable: any key press or click skips to the final results state.
- `prefers-reduced-motion: reduce` disables the flourish and shows the static podium immediately.
- Text must stay at least 14 CSS px, contrast must remain readable, and the layout must work at 640×360,
  1280×720, 1920×1080 and 390×844.
- Names up to "P8" plus optional short character names must fit without ellipsis; overflow falls back to a
  compact list.
- The animation is DOM/CSS where possible so it is testable and readable by assistive technology.

## 4. Accept criteria

1. Winner name is displayed large and is the actual winner from the simulation, never derived from a client guess.
2. Second and third places follow the ranking rules above; 4th–8th appear when present.
3. Draw is displayed as a draw.
4. The animation is skippable and honours reduced-motion.
5. No simulation, protocol, server or bot changes; pinned fingerprints unchanged.
6. Browser tests cover ranking order per mode, the podium content, skip behaviour and reduced motion; screenshots
   at all four viewports are inspected.

## 5. Out of scope

- Online results celebration (the online client has no results screen yet; snapshots do not carry elimination
  order, so this needs a separate decision).
- Persistent stats, replays or shareable results.
- New audio composition; the existing match-end cue may be reused.
