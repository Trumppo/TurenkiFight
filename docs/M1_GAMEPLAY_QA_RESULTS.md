# M1-GAMEPLAY-QA results

Task: M1-GAMEPLAY-QA
Branch: `feature/m1-gameplay-qa`
Implementation PR: #15

## Findings and fixes

- **Fixed:** combat hit candidates were collected before resolution, but application discarded a hit if an earlier sorted hit had already KO'd its target. This prevented a valid mutual KO. Eligibility is now fixed at the pre-resolution snapshot; only the first lethal hit receives KO credit. Regression: `tests/gameplay-qa.test.ts`.
- **Confirmed architectural boundary:** `src/game/simulation/step.ts` imports only simulation types and uses fixed ticks, logical world positions and no Phaser, DOM, renderer resolution, stage asset, wall clock or random source. Eight-fighter replay is exercised.
- **Unresolved presentation/input defect:** `StationScene.ts` only assigns controllers to P2–P4 but requires a P1 controller assignment to accept gamepad Start. A simulation-only change cannot repair this. Coordination request: https://github.com/Trumppo/TurenkiFight/issues/14. Do not edit presentation without owner approval.

## Automated test matrix

| Scenario | Evidence | Status |
| --- | --- | --- |
| Deterministic 60 Hz replay and immutable state, 8 fighters | `tests/gameplay-qa.test.ts`; 500 scripted ticks repeated | Pending CI |
| Countdown 180 ticks and fight exactly 7200 ticks | `tests/gameplay-qa.test.ts` | Pending CI |
| Mutual simultaneous KO and ordered hit events | `tests/gameplay-qa.test.ts` | Pending CI |
| Competing finishers: exactly one KO credit | `tests/gameplay-qa.test.ts` | Pending CI |
| KO delay 180 ticks, protection 90 ticks, attack cancels protection | `tests/gameplay-qa.test.ts` | Pending CI |
| Held punch does not auto-repeat; fresh press works | `tests/gameplay-qa.test.ts` | Pending CI |
| Ranking by score, KOs, fewer received hits, shared rank | `tests/gameplay-qa.test.ts` | Pending CI |
| Keyboard join, simulated gamepad join and four-player smoke | Existing `tests/browser/` | Pending CI |
| P1 gamepad Start and physical controller disconnect/reconnect | Presentation change required; issue #14 | NOT VERIFIED |
| Actual 960×540 rendering / real controller hardware | Presentation/manual QA | NOT VERIFIED |

Commands in GitHub Actions `CI and browser smoke tests`: `npm test`, `npm run build`, `npm run test:browser`. Record the successful workflow URL after it completes; do not equate a passing simulated-browser test with physical gamepad verification.

## Remaining decision

Approve a narrow presentation-layer input adapter change for P1 gamepad binding and Start, or ask the presentation owner to implement issue #14. M1-GAMEPLAY-QA cannot claim this acceptance item PASS until a corresponding Playwright test is green. No PR merge without user approval.
