# M1 Score Brawl – local controls and verification

The game opens in the lobby with keyboard host P1. Keyboard P2 explicitly joins by pressing **Shift**. The host presses **Enter** to start the 3-second countdown. During the lobby, press **Select/Back (button 8)** on a previously unassigned gamepad to join the next free P2–P4 slot. Joining does not start the match and a gamepad cannot occupy two slots. Only the keyboard host starts/rematches in this version. Disconnected pads provide neutral input while keeping their player slot.

| Action | P1 keyboard default | P2 keyboard default | P3 keyboard | P4 keyboard | Gamepad |
| --- | --- | --- | --- | --- | --- |
| Move (up/left/down/right) | W / A / S / D | Up / Left / Down / Right | Unassigned | Unassigned | Left stick |
| Jump | Space | K | Unassigned | Unassigned | A / button 0 |
| Punch | F | L | Unassigned | Unassigned | X / button 2 |
| Kick | G | J | Unassigned | Unassigned | B / button 1 |
| Jump kick (airborne) | H | U | Unassigned | Unassigned | Y / button 3 |
| Pick up / throw (grab) | T | I | Unassigned | Unassigned | LB / button 4 |
| Join | host already joined | Shift | Assign a key in KEYS | Assign a key in KEYS | Select / button 8 |
| Start / rematch | Enter | host only | host only | host only | host only |

**Live bindings:** P1/P2 start with the defaults above; all four keyboard slots can be remapped in the lobby's **KEYS** panel. P3/P4 are gamepad slots until at least one key is assigned, at which point that keyboard player joins the local roster. P3/P4 bindings are initially empty. The in-game keyboard guide lists the current values after overrides; it is the source of truth when local remaps differ from these defaults. Overrides persist in browser `localStorage`. **RESET SLOT** restores the selected slot's default (P3/P4 become unassigned); **RESET ALL** removes every keyboard override. Keys are exclusive across all keyboard actions and slots. Escape cancels key capture.

Gamepad buttons follow the standard browser Gamepad API mapping; physical labels vary by controller. Jump kicks require pressing the attack button after takeoff. Each attack uses an edge-triggered button press. `grab` picks up a bottle within reach in front of the fighter, and throws a held bottle on the next press; the same edge is never both a pickup and a throw. Button 4 (LB) is the grab button because buttons 0–3 already carry jump and the three attacks and 8–9 handle join/start; the left shoulder is unused and reachable without moving the thumb off the attack buttons.

The match clock runs for exactly 7,200 active simulation ticks at 60 Hz (120 seconds), preceded by 180 countdown ticks. Results rank by score, KOs and then fewer hits received. Exact ties share rank.

## Automated validation

GitHub Actions runs `npm test`, `npm run build`, and `npm run test:browser`. The browser test emulates two controllers joining the two keyboard slots, starts the match with Enter and accelerates the full simulation to results. CI success does not replace hands-on four-controller gameplay, visual QA, or GitHub Pages production verification.

No networking is implemented in M1.
