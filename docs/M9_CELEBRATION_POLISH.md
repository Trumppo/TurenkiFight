# M9 celebration polish: victory cue and short-viewport layout

**Status:** Design spec, 2026-11-03. Not implemented.
**Origin:** owner asked for further small polish after the celebration and readability packages merged. Two
contained improvements, both presentation-only.

## 1. Victory cue

Today the match end plays the generic `match-end` cue from `CueBridge`, and the podium reveal is silent. The
owner asked for a celebration; a short, distinct victory flourish makes it read as one.

Requirements:

1. A new `victory` audio cue, procedural like the existing placeholder cues (`src/game/presentation/audio/**`);
   no new binary assets.
2. It plays once when the podium reveal starts, and only for a win or a draw - not for a match that ended without
   a result state, and not twice for the same match end.
3. It respects the existing mute, volume and gesture rules: muted means silent, and a cue must never resume a
   suspended `AudioContext` on its own.
4. Skip, RESET and a new match must not retrigger it; the reveal timer and the cue stay independent, so skipping
   the animation does not cut the cue mid-flight beyond what the existing audio teardown already does.
5. The existing `match-end` cue keeps its current behaviour; do not silently repurpose it.

## 2. Short-viewport layout

At 640x360 the celebration panel covers the fighters, so the result and the arena cannot be read at the same
time. The panel is already compact at short heights; it is not compact enough.

Requirements:

1. At viewport heights of 420 px or less, the panel must leave at least one third of the arena's height visible
   - measured as the canvas height minus the panel's covered height - while still containing the kicker, winner,
   2nd/3rd, the extra-places line, the skip prompt and no clipping.
2. Text stays at least 14 CSS px, no ellipsis, and the existing four-viewport screenshots keep working
   (640x360, 1280x720, 1920x1080, 390x844).
3. Do not shrink the text to gain space, and do not hide information. If the content cannot fit, prefer a
   two-column arrangement or a tighter gap scale over truncation.
4. The 1280x720 and larger layouts must not regress; the celebration and readability specs stay green.

## 3. Out of scope

- Online results celebration (needs a protocol decision).
- Real audio samples or mixing; this stays procedural.
- New characters, poses or simulation changes.

## 4. Accept criteria

1. A victory cue exists, is distinct from `match-end`, plays once per match end, and is silent when muted.
2. At 640x360 the panel leaves at least a third of the canvas height visible and every required line is present.
3. `npm test`, `npm run build`, the full browser suite in both the default and retro builds, and
   `git diff --check` pass.
4. No simulation, protocol, server or bot change; pinned fingerprints unchanged.

## 5. Risks

- Audio timing is environment-sensitive; tests must assert the cue path deterministically (cue bridge/director
  unit test) rather than depending on wall-clock playback.
- Compacting the panel can make 640x360 cramped; verify by screenshot, not by arithmetic alone.
