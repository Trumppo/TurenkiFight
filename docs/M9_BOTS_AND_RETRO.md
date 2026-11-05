# M9 bots and retro: P5–P8 retro textures and an all-bot match

**Status:** Implemented in PR #148 (merged `e431cff`), independently gated by Tester. Retro art now covers P1-P8 and the ALL BOTS match runs unattended.
**Owner report 2026-11-04:** four bots still carry old graphics, and the game should support a match where only
bots play, so testing is easier.

## 1. Defect: retro mode only redraws P1–P4

Diagnosis from the code, not a guess:

- `createFighterTextures` draws P1–P8 in the classic style and creates the texture keys `fighter-P<id>-<pose>-<frame>`.
- A retro build (`VITE_VISUAL_STYLE=retro`) then overwrites the same keys for **P1** (`retroPrototype.ts`), **P2**
  (`retroP2.ts`) and **P3/P4** (`retroExtras.ts`). There is no retro set for P5–P8.
- Slots 5–8 are the gamepad/bot slots, so in practice the four bots the owner sees with old art are P5–P8 rendered
  with the classic textures inside a retro build.

That is a real inconsistency: one scene mixes two art styles. It is not a simulation or input issue.

### Fix

1. Add a retro texture set for P5–P8 with the same key contract, size (32×48) and pose/frame grid as P1–P4, using
   the retro palette conventions. The four silhouettes must stay distinguishable: station master (peaked cap, long
   coat), kiosk vendor (visor, apron), hooded student (hood, backpack), commuter (knit cap, scarf).
2. Keep the classic path and its texture hashes untouched. The fix must not change P1–P4 retro hashes either.
3. Cover all ten poses × four frames for each new character, with feet inside the cell and the existing
   bottom-centre anchor.
4. Tests: a retro contract test that every P1–P8 texture exists, is 32×48, and is **not** identical to the classic
   texture for P5–P8; a monochrome-mask distinctness check; screenshots of an eight-fighter retro lineup inspected.
5. Update the known-limitation notes: after this, "retro covers P1–P4 only" is no longer true.

**Status note (designer, 2026-11-04):** this slice extends the retro texture set to cover P1–P8. P1–P4 classic and
retro hashes are unchanged, and the M1.5 acceptance (2026-11-01) is not revised by this follow-up. The known
eight-fighter crowding limitation remains: one consistent art style does not guarantee that every fighter is
readable while overlapping.

Out of scope: new poses, new characters beyond P5–P8, changes to P1–P4 art.

## 2. All-bot match

Today P1 is always human: the lobby adds bots only to non-host slots, and the match cannot start without a human
present. For deterministic testing and for watching eight bots fight, the game should support a match where every
slot is a bot.

### Behaviour

1. An explicit **ALL BOTS** action in the lobby fills every slot (including P1) with bots and starts the match. It
   must be discoverable (button plus a stated keyboard shortcut) and must say that P1 is bot-driven in this mode.
2. Bot inputs for P1 come from the same deterministic `botInput` policy as the other slots, with the same seed
   rules, so an all-bot match is reproducible.
3. The HUD marks every bot slot, including P1, so a spectator cannot mistake it for a human player.
4. RESET returns to a lobby with a human P1 and no bots, as today. Starting an all-bot match again requires the
   explicit action.
5. A URL flag `?bots=all` may exist for tests and QA so a headless run can start an all-bot match without clicking,
   but the visible action is the primary path.
6. No simulation, protocol or server change. The roster is still ordinary player ids; only the input source changes.

### Accept criteria

1. In lobby, ALL BOTS produces a full eight-slot roster, starts the match, and the match ends on its own without any
   keyboard or pointer input beyond the initial action.
2. The same seed and roster produce the same match twice (deterministic bot inputs).
3. HUD labels P1 as a bot in this mode; RESET restores the human P1 lobby.
4. Local play, the local celebration and reset controls keep working in an all-bot match.
5. Existing tests stay green; a new browser test covers start, HUD labels, determinism and reset.

## 3. Why this matters

- The owner's testing loop gets shorter: no human needed to exercise eight-player mode, modes and the results screen.
- It removes an art-style inconsistency that only shows up in retro with bots, which is exactly the configuration
  the owner uses for QA.

## 4. Risks

- Retro P5–P8 art is new drawing work; it must not drift into a different visual language from the P1–P4 retro set.
- An all-bot match must not become an accidental default: a human must always be able to get their P1 back with RESET.
- Bot-only matches run unattended; if the match never terminates, a test would hang. Use bounded runs in tests.
