# Character roster and selection design (M2 proposal)

Status: proposed, not part of M1 gameplay scope.

## Design decision

Nine initial **fictional placeholder** characters: Juhis, Make, Sasu, Pete, Rontti, Peksi, Sami, Rami and Tommo. They share the same base fighter rig, moves, timing, hitboxes, health, movement and score rules. Distinguish them by **shirt and trousers colors**; no stat advantages. Character art may later be modeled on real or historical people, subject to appropriate permissions and respectful depiction. Do not assume current placeholders depict specific people.

| id | name | shirt | trousers |
|---|---|---|---|
| juhis | Juhis | #C73D35 | #263A59 |
| make | Make | #3376C5 | #363636 |
| sasu | Sasu | #429455 | #AD9A72 |
| pete | Pete | #D3A33A | #414B59 |
| rontti | Rontti | #744CA6 | #222C38 |
| peksi | Peksi | #CB7938 | #426B83 |
| sami | Sami | #459F9D | #654C3F |
| rami | Rami | #A2A7B0 | #4D6D39 |
| tommo | Tommo | #9C4B61 | #B5A88E |

Color choices are provisional and must be tested at the game's 384×216 internal resolution, including crowded scenes and common color-vision deficiencies. Retain player number/name labels as redundant identification cues.

## Data model

A `CharacterDefinition` is static data: `id`, `displayName`, `palette: { shirt, trousers }`, `spriteSet` (initially shared), optional future `portrait` and cosmetic metadata. IDs are stable ASCII slugs; names are display text. Character data does not carry a `playerId`.

A lobby selection is a mapping `playerId -> characterId`, kept separately from the simulation's stable player identity. On match start, presentation resolves the selected character's sprite/palette. Game rules must not derive physics or scoring from character colors.

## Future selection screen

Lobby → character selection → 3-second countdown → fight → results. Each joined local player selects a character; controls show their player number. Default behavior allows duplicate character selections, with clear P1/P2/etc. identifiers, until playtesting establishes a reason to enforce uniqueness. Selections persist through rematches; return to lobby allows changes.

## Compatibility and migration

M1 gameplay implementation remains unchanged. In a later milestone, provide a deterministic fallback mapping for players without selections. Preserve existing `idle/walk/depth/punch/kick/jump/jumpkick/hit/ko/respawn` pose keys and sprite API. Keep sprite rendering independent from gameplay hitboxes and deterministic simulation. No new assets are required to prototype the data model.

## Acceptance criteria for later implementation

1. All nine names and palettes are selectable from data without changes to simulation combat rules.
2. Player IDs remain distinct from character IDs; duplicate selection works.
3. Four simultaneous fighters remain distinguishable in 384×216 with labels and palettes.
4. Selection works with keyboard and gamepads, including disconnect/reconnect.
5. Match/rematch preserves correct selections; fallback works when selection is missing.
6. Unit/build/browser tests pass; GitHub Pages asset paths remain valid.

## Deferred

Real-person likenesses, custom portraits, unique animation rigs, special moves, stats, unlocks, biographies, audio, online synchronization of selections and character balancing.
