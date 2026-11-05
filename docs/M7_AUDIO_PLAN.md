# M7 audio: background music and combat effects

**Status:** Implemented at the placeholder level in PR #117 (`graphics/m7-audio-core`): procedural chiptune, twelve cues including the victory flourish, and the asset-agnostic cue interface. Real recorded samples and mixing remain deferred by the owner (`M7-AUDIO-MIX`).
**Owner request:** the game must have background music and proper effects for hits, kicks, jumps and the like.
**Scope:** presentation only. Audio must never feed the simulation, change timing or affect determinism.

## 1. Why procedural first

There is no recorded audio in the repository and no reliable way for agents to produce or license a
soundtrack. Two options:

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Procedural audio in the browser (recommended)** | No binary assets, no licensing questions, no download cost, fits the 1990s chiptune aesthetic, deterministic code that can be unit-tested | Must be composed in code; "good sound" is a taste judgement only the owner can make |
| B. Recorded asset pack | Rich, easy to swap | Needs a licensed source or original recordings, adds bandwidth and asset pipeline work, and agents cannot audition it |

Recommendation: build the **engine and the interface** around procedural synthesis now, so the sounds
exist and can be tuned, and keep the cue interface asset-agnostic so recorded samples can replace
individual voices later without touching gameplay code.

## 2. Architecture

```
simulation events ──▶ presentation event bridge ──▶ AudioDirector ──▶ Web Audio graph
                            (read-only)                │
                                                       ├── music bus (gain, looped chiptune)
                                                       └── sfx bus (gain, one-shot voices)
```

- **`AudioDirector`** owns the `AudioContext`, two gain buses (music, sfx), master mute and volume,
  and a lookahead scheduler for music. It is created lazily and unlocked by the first user gesture,
  because browsers block audio before interaction. The game already requires a key press to join, so
  the unlock is natural and must not add a new blocking modal.
- **Synthesis** uses oscillators and noise with short envelopes: square/pulse for the lead, triangle
  for bass, filtered noise for percussion and impacts. Kick and punch need different pitch envelopes
  and noise ratios so they are distinguishable, not just louder.
- **Event bridge** maps existing simulation and presentation events to cues:
  `hit`, `kick`, `jump`, `land`, `ko`, `respawn`, `join`, `match-start`, `time-warning`,
  `match-end`, and UI confirm. The bridge is read-only and must not be able to change game state.
- **Music** is a looping chiptune arrangement scheduled ahead of time; tempo and key are constants in
  one module. Variants for lobby, fight and results are optional and belong to the mix task.
- **Controls**: master volume slider, music and effects balance, and a mute toggle. Persist the
  settings locally. No audio may start before the player's first gesture.

## 2b. Owner clarification, 2026-11-02

For now only **generic placeholder sounds** are required, together with the technology that plays them.
Real samples, sound design and mixing come later. Consequences:

- `M7-AUDIO-CORE` ships the engine, the unlock path, the buses, the complete cue list and simple
  placeholder voices; it must not chase polish.
- Placeholder cues are defined in one clearly named table so they can be replaced without touching
  callers.
- `M7-AUDIO-MIX` (real samples and balance) and `M7-AUDIO-ACCEPTANCE` (owner listening) stay in the
  backlog until the owner asks for them.

## 3. Acceptance criteria

1. Music starts after the first user gesture and loops without gaps or clicks; it stops or ducks when
   the match ends.
2. Punch, kick, jump, landing, KO, respawn, join and match start each have a distinct cue. A listener
   can tell kick from punch without seeing the screen.
3. Mute and volume changes take effect immediately, persist across reloads, and never throw when the
   audio context is unavailable.
4. Simulation output is byte-identical with audio enabled and disabled: the deterministic fingerprints
   (`7fddf007…`, `de544fcd…`, `5bb44bd6…`) do not change.
5. No console errors or warnings from audio in the browser suite; no unhandled promise rejections from
   `AudioContext.resume()`.
6. Audio works in both the local game and the online client, driven by the same event bridge.
7. Object URLs, buffers and nodes are released on scene shutdown; repeated matches do not leak nodes.

## 4. What agents can and cannot verify

Agents can verify wiring, scheduling, gain values, mute persistence, absence of errors, node cleanup
and that gameplay is unchanged. **Agents cannot judge whether it sounds good.** The owner must listen
and decide; the Tester report must say explicitly that audibility and taste were not evaluated.

## 5. Risks

- Autoplay policies differ between browsers; the unlock path must be tested in Chromium and described
  for the owner's browser.
- Procedural chiptune can sound cheap; the mix task exists to tune it, and the cue interface allows
  replacing voices with samples later.
- Loud, repeated effects become annoying; defaults should be conservative and the effects bus
  noticeably quieter than full scale.
- Headless CI has no audio device; tests must use a fake `AudioContext` for unit coverage and only
  assert browser-level state, never loudness.

## 6. Suggested work order

1. `M7-AUDIO-CORE` — engine, unlock, buses, mute/volume persistence, cue bridge, music loop, unit tests.
2. `M7-AUDIO-MIX` — distinguish punch/kick/jump/land/KO, lobby/fight/results music variants, balance.
3. `M7-AUDIO-ACCEPTANCE` — Tester wiring verification plus an owner listening checklist; owner decides.
