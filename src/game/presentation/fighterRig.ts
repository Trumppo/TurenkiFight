/** Reusable 2D anatomical skeleton. Character appearance and game simulation are separate. */
export type Joint = readonly [number, number];
export interface Leg { hip: Joint; knee: Joint; ankle: Joint }
export interface Arm { shoulder: Joint; elbow: Joint; wrist: Joint }
export interface FighterRig {
  head: Joint;
  neck: Joint;
  pelvis: Joint;
  leftArm: Arm;
  rightArm: Arm;
  leftLeg: Leg;
  rightLeg: Leg;
}
export type RigPose = 'idle' | 'kick' | 'punch' | 'jump';
export const KICK_PHASES = ['chamber', 'raise', 'extend', 'recover'] as const;
const kickKnees: readonly Joint[] = [[23,38],[25,30],[25,27],[24,32]];
const kickAnkles: readonly Joint[] = [[25,43],[27,34],[31,27],[27,40]];
const jumpKnees: readonly Joint[] = [[11,34],[10,31],[9,29],[11,32]];
const jumpAnkles: readonly Joint[] = [[8,39],[6,33],[5,31],[7,36]];
const punchElbows: readonly Joint[] = [[27,27],[28,22],[29,18],[27,25]];
const punchWrists: readonly Joint[] = [[24,19],[29,19],[31,17],[25,19]];
/** Every pose contains exactly two arms and two legs. Poses replace joint positions. */
export function fighterRig(pose: RigPose, frame: number): FighterRig {
  if (!Number.isInteger(frame) || frame < 0 || frame > 3) throw new RangeError('frame must be 0..3');
  return {
    head: [17,11], neck: [17,19], pelvis: [17,32],
    leftArm: { shoulder: [11,21], elbow: [7,27], wrist: [10,19] },
    rightArm: { shoulder: [23,21], elbow: pose === 'punch' ? punchElbows[frame] : [27,27],
      wrist: pose === 'punch' ? punchWrists[frame] : [24,19] },
    leftLeg: { hip: [13,32], knee: pose === 'jump' ? jumpKnees[frame] : [10,38],
      ankle: pose === 'jump' ? jumpAnkles[frame] : [8,43] },
    rightLeg: { hip: [21,32], knee: pose === 'kick' ? kickKnees[frame] : pose === 'jump' ? [22,35] : [23,38],
      ankle: pose === 'kick' ? kickAnkles[frame] : pose === 'jump' ? [27,38] : [25,43] },
  };
}
export function isValidRig(rig: FighterRig): boolean {
  return Object.values(rig).every(v => Array.isArray(v) ? v.length === 2 &&
    v.every(n => typeof n === 'number' && Number.isFinite(n)) :
    Object.values(v).every(j => Array.isArray(j) && j.length === 2 &&
      j.every(n => typeof n === 'number' && Number.isFinite(n))));
}
