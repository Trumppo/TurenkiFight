# M13 Wave UI slice

Task: `M13-WAVE-UI`

The local mode selector offers **Wave (Asemahalli)**. Starting a wave match requires at least one human-controlled
fighter and at least one bot. Human slots are assigned to `players`; slots driven by the lobby's bot policy are
assigned to `enemies`. The lobby does not silently convert empty or human slots: use a slot's `BOT` control (or the
`B` shortcut) to add the opposing side. `START MATCH` remains disabled until both sides exist. The all-bots shortcut
is disabled in Wave because this first slice needs a human player.

Wave HUD fields are read directly from the simulation `state.wave`: cleared-wave index, enemy count and the
between-wave countdown. It does not advance or infer simulation state. Wave results retain Score Brawl score ranking;
`waves-cleared` is presented as “WAVES CLEARED”.

Wave is local-only in this slice. The online HUD can label a received wave snapshot as `ONLINE MODE · WAVE`, but the
server's existing mode validation list is intentionally unchanged and does not allow creating a wave match online.

The existing 640 × 360 logical canvas and nearest-neighbor pixel scaling are unchanged. The external HUD uses a
14 px minimum type size, wrapping rather than truncating Wave/lobby text at narrow sizes.
