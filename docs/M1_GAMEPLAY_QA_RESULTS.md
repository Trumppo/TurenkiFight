# M1-GAMEPLAY-QA results

Task: M1-GAMEPLAY-QA
Branch: `feature/m1-gameplay-qa`
Implementation PR: #15

## Findings and fixes

- **Fixed:** combat hit candidates were collected before resolution, but application discarded a hit if an earlier sorted hit had already KO'd its target. This prevented a valid mutual KO. Eligibility is now fixed at the pre-resolution snapshot; only the first lethal hit receives KO credit. Regression: `tests/gameplay-qa.test.ts`.
- **Confirmed architectural boundary:** `src/game/simulation/step.ts` imports only simulation types and uses fixed ticks, logical world positions and no Phaser, DOM, renderer resolution, stage asset, wall clock or random source. Eight-fighter replay is exercised.
- **Resolved presentation/input defect:** `StationScene.ts` only assigns controllers to P2–P4 but requires a P1 controller assignment to accept gamepad Start. A narrowly scoped input-adapter fix now allows an unassigned pad to bind P1 via Start when at least two players have joined. Assigned P2–P4 pads cannot start. Keyboard Enter remains supported. Automated browser regression covers join, four slots, disconnect/reconnect, rematch. Coordination: https://github.com/Trumppo/TurenkiFight/issues/14. No HUD, sprite or asset changes.

## Automated test matrix

| Scenario | Evidence | Status |
| --- | --- | --- |
| Deterministic 60 Hz replay and immutable state, 8 fighters | `tests/gameplay-qa.test.ts`; 500 scripted ticks repeated | PASS — CI #109 |
| Countdown 180 ticks and fight exactly 7200 ticks | `tests/gameplay-qa.test.ts` | PASS — CI #109 |
| Mutual simultaneous KO and ordered hit events | `tests/gameplay-qa.test.ts` | PASS — CI #109 |
| Competing finishers: exactly one KO credit | `tests/gameplay-qa.test.ts` | PASS — CI #109 |
| KO delay 180 ticks, protection 90 ticks, attack cancels protection | `tests/gameplay-qa.test.ts` | PASS — CI #109 |
| Held punch does not auto-repeat; fresh press works | `tests/gameplay-qa.test.ts` | PASS — CI #109 |
| Ranking by score, KOs, fewer received hits, shared rank | `tests/gameplay-qa.test.ts` | PASS — CI #109 |
| Keyboard join, simulated gamepad join and four-player smoke | Existing `tests/browser/` | PASS — CI #109 |
| P1 gamepad Start and physical controller disconnect/reconnect | Simulated gamepads: `tests/browser/p1-gamepad-start.spec.ts`, CI #109 PASS; physical hardware | PASS automated / NOT VERIFIED physical |
| Actual 960×540 rendering / real controller hardware | Presentation/manual QA | NOT VERIFIED |

Commands in GitHub Actions `CI and browser smoke tests`: `npm test`, `npm run build`, `npm run test:browser`. CI #109 PASSED both quality (25 unit tests and production build) and browser-smoke (Playwright): https://github.com/Trumppo/TurenkiFight/actions/runs/40526080472. Do not equate simulated-browser success with physical gamepad verification.

## Remaining decision

The narrowly scoped P1 Start input adapter change is implemented and covered by green Playwright CI. Physical gamepad hardware and real-world visual acceptance remain unverified. PR #15 is ready for review; do not merge without user approval.
