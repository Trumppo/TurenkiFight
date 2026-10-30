# M1.5 — Expanded fighter sprite experiment (design gate)

## Baseline

Current opt-in retro P1 sprite is 32 × 48 pixels with a shared anatomical rig. The 640 × 360 logical camera, fighter origin (0.5, 1), gameplay hitboxes and P2–P4 are unchanged. The forward kick currently approaches the right sprite boundary, limiting readable horizontal extension.

## Proposed isolated experiment

- Introduce an explicit **experimental** P1-only 48 × 64 pixel canvas, without changing the default 32 × 48 variant.
- Keep world-space feet aligned: origin remains (0.5, 1), and any art coordinate conversion must preserve the floor contact point. Do not enlarge the gameplay collider or attack reach.
- Keep the supporting leg under the pelvis; draw the kicking leg in front of the jacket, with exactly two legs and two arms. Place the extension toe visibly ahead of the knee and torso, with at least 2 pixels of transparent canvas margin.
- Drive both variants from the same anatomical rig, with a distinct render transform and character-specific proportions rather than duplicating pose definitions.
- Compare four kick frames, all ten poses, native 640 × 360, 2×, 3× and mobile screenshots against the existing version. Check sprite origin, collisions, animation keys, 4-player gameplay and retro/classic toggle.
- Keep the experiment opt-in and reversible. Do not switch P1 default art or merge the PR without visual approval.

## Acceptance criteria

1. Four-phase kick reads as chamber → raise → forward extension → recover without a third limb.
2. Extension is visibly horizontal, toe fully inside the canvas, and the boot overlaps the front of the torso.
3. Standing feet and respawn placement do not jump when switching render sizes.
4. CI, unit tests, Playwright smoke, deterministic gameplay and visual screenshot capture pass.
5. The user approves the side-by-side visual comparison before enabling the new size.

## Current state

This document defines the design gate only. The expanded sprite has **not** yet been implemented or approved.
