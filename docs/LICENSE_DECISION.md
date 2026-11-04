# License decision brief (M0 follow-up)

**Status:** **Decided 2026-11-04 by the owner: code MIT, art and audio CC0 1.0.** Implemented in `LICENSE`,
`LICENSE-ASSETS`, `README.md` and `package.json`. The options below are kept as the record of what was considered.

## Where things stand

- Before this decision, `package.json` had `"private": true` and no `license` field. A public GitHub repository
  without a license means default copyright: others may view and fork on GitHub, but have no permission to reuse,
  modify or redistribute.
- The repository contains two categories that should be licensed **separately**:
  1. **Code** - TypeScript, Vite/Phaser game, server, tests, benchmarks.
  2. **Art and audio** - the pixel-art characters, the arena, and the procedurally generated chiptune and effects.
- Third-party dependencies are permissive and compatible with any of the options below: Phaser, Vite, Vitest and
  `ws` are MIT; TypeScript and Playwright are Apache-2.0. No dependency forces a copyleft choice.
- All game art and audio in the repository is original or procedurally generated in code. There are no licensed
  third-party assets to reconcile, which keeps this decision simple.

## Options for the code

| Option | What it allows | Consequence for this project |
| --- | --- | --- |
| MIT | Anyone may use, modify, redistribute, including commercially, with attribution and no warranty | Simplest and most common for small games; maximum reuse; no protection if someone ships a closed fork |
| Apache-2.0 | Like MIT plus an explicit patent grant and a change notice | Slightly heavier paperwork; good if a company might contribute |
| AGPL-3.0 | Anyone who runs a modified version as a network service must publish their source | Strong copyleft; discourages closed hosting of the server, may deter contributors and is awkward for a hobby project |
| All rights reserved | Nobody may reuse without permission | Default today; safest legally, but the repository offers nothing to the community and contributors cannot reuse it |

## Options for art and audio

| Option | What it allows | Consequence |
| --- | --- | --- |
| CC BY 4.0 | Reuse and modification with attribution | Familiar and readable; recommended if the art should be usable by others |
| CC0 | Reuse with no conditions | Maximum goodwill; no attribution requirement, so credit can disappear |
| Same license as code | One license file for everything | Simplest to explain, but a code license is a poor fit for creative assets |
| All rights reserved | Art stays with the author | Consistent with a portfolio project that wants to keep its look |

## Recommendation (not a decision)

1. **Code: MIT.** The project is small, the dependencies are permissive, and MIT is what a reader expects from a
   Phaser/Vite prototype.
2. **Art and audio: CC BY 4.0.** Original pixel art and procedural music are exactly the material CC BY is written
   for, and attribution keeps the Turenki setting credited.
3. Add `LICENSE` (code) and `LICENSE-ASSETS` (art and audio) plus a short section in `README.md` that says which
   files fall under which license, and set `"license": "MIT"` in `package.json`.

## What this brief does not decide

- Whether the project wants to stay non-commercial or prevent closed forks. MIT and CC BY allow commercial use.
- Whether the name "TurenkiFight" and the station setting should be trademarked. That is a separate question and
  out of scope for a repository license.
- Any future recorded audio samples: if real samples are added later, their license must be recorded at that time.

## Decision needed

One line is enough, for example: "Code MIT, assets CC BY 4.0", or "keep all rights reserved". After that the license
files and README section can be added in a single small PR.
