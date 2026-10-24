# M1 Score Brawl – local controls and verification

The game opens in the lobby with keyboard host P1. Keyboard P2 explicitly joins by pressing **Shift**. The host presses **Enter** to start the 3-second countdown. During the lobby, press **Select/Back (button 8)** on a previously unassigned gamepad to join the next free P2–P4 slot. Joining does not start the match and a gamepad cannot occupy two slots. Only the keyboard host starts/rematches in this version. Disconnected pads provide neutral input while keeping their player slot.

| Action | P1 keyboard | P2 keyboard | Joined gamepad |
| --- | --- | --- | --- |
| Move | W A S D | Arrow keys | Left stick |
| Jump | Space | K | A / button 0 |
| Punch | F | L | X / button 2 |
| Kick | G | J | B / button 1 |
| Jump kick (airborne) | H | U | Y / button 3 |
| Join | host already joined | Shift | Select / button 8 |
| Start / rematch | Enter | host only | host only |

Gamepad buttons follow the standard browser Gamepad API mapping; physical labels vary by controller. Jump kicks require pressing the attack button after takeoff. Each attack uses an edge-triggered button press.

The match clock runs for exactly 7,200 active simulation ticks at 60 Hz (120 seconds), preceded by 180 countdown ticks. Results rank by score, KOs and then fewer hits received. Exact ties share rank.

## Automated validation

GitHub Actions runs `npm test`, `npm run build`, and `npm run test:browser`. The browser test emulates two controllers joining the two keyboard slots, starts the match with Enter and accelerates the full simulation to results. CI success does not replace hands-on four-controller gameplay, visual QA, or GitHub Pages production verification.

No networking is implemented in M1.
