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
export type RigPose = 'idle' | 'kick' | 'punch' | 'jump' | 'walk' | 'hit';
export const KICK_PHASES = ['chamber', 'raise', 'extend', 'recover'] as const;
const kickKnees: readonly Joint[] = [[23,38],[26,32],[26,28],[24,34]];
const kickAnkles: readonly Joint[] = [[25,43],[27,34],[27,25],[27,41]];
const jumpKnees: readonly Joint[] = [[11,34],[10,31],[9,29],[11,32]];
const jumpAnkles: readonly Joint[] = [[8,39],[6,33],[5,31],[7,36]];
const walkKnees: readonly Joint[] = [[10,38],[8,36],[10,38],[13,36]];
const walkAnkles: readonly Joint[] = [[8,43],[5,42],[8,43],[15,42]];
const walkRightKnees: readonly Joint[] = [[23,38],[20,36],[23,38],[26,36]];
const walkRightAnkles: readonly Joint[] = [[25,43],[19,42],[25,43],[29,42]];
const hitElbows: readonly Joint[] = [[6,25],[5,23],[6,24],[7,26]];
const punchElbows: readonly Joint[] = [[27,27],[28,22],[29,18],[27,25]];
const punchWrists: readonly Joint[] = [[24,19],[29,19],[31,17],[25,19]];
/** Every pose contains exactly two arms and two legs. Poses replace joint positions. */
export function fighterRig(pose: RigPose, frame: number): FighterRig {
  if (!Number.isInteger(frame) || frame < 0 || frame > 3) throw new RangeError('frame must be 0..3');
  return {
    head: [17,11], neck: [17,19], pelvis: [17,32],
    leftArm: { shoulder: [11,21], elbow: pose === 'hit' ? hitElbows[frame] : [7,27],
      wrist: pose === 'hit' ? [4,20] : [10,19] },
    rightArm: { shoulder: [23,21], elbow: pose === 'punch' ? punchElbows[frame] : pose === 'hit' ? [29,24] : [27,27],
      wrist: pose === 'punch' ? punchWrists[frame] : pose === 'hit' ? [31,18] : [24,19] },
    leftLeg: { hip: [13,32], knee: pose === 'jump' ? jumpKnees[frame] : pose === 'walk' ? walkKnees[frame] : [10,38],
      ankle: pose === 'jump' ? jumpAnkles[frame] : pose === 'walk' ? walkAnkles[frame] : [8,43] },
    rightLeg: { hip: [21,32], knee: pose === 'kick' ? kickKnees[frame] : pose === 'jump' ? [22,35] : pose === 'walk' ? walkRightKnees[frame] : [23,38],
      ankle: pose === 'kick' ? kickAnkles[frame] : pose === 'jump' ? [27,38] : pose === 'walk' ? walkRightAnkles[frame] : [25,43] },
  };
}
export interface FighterProportions { readonly scaleX: number; readonly scaleY: number; readonly offsetX: number; readonly offsetY: number }
/** Transform the complete skeleton, allowing distinct fighters without duplicating animations. */
export function transformRig(rig: FighterRig, proportions: FighterProportions): FighterRig {
  const { scaleX, scaleY, offsetX, offsetY } = proportions;
  if (![scaleX, scaleY, offsetX, offsetY].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0) {
    throw new RangeError('fighter proportions must use positive finite scales and finite offsets');
  }
  const move = ([x,y]: Joint): Joint => [17 + (x - 17) * scaleX + offsetX, 32 + (y - 32) * scaleY + offsetY];
  const arm = (a: Arm): Arm => ({ shoulder: move(a.shoulder), elbow: move(a.elbow), wrist: move(a.wrist) });
  const leg = (l: Leg): Leg => ({ hip: move(l.hip), knee: move(l.knee), ankle: move(l.ankle) });
  return { head: move(rig.head), neck: move(rig.neck), pelvis: move(rig.pelvis),
    leftArm: arm(rig.leftArm), rightArm: arm(rig.rightArm),
    leftLeg: leg(rig.leftLeg), rightLeg: leg(rig.rightLeg) };
}
export function isValidRig(rig: FighterRig): boolean {
  return Object.values(rig).every(v => Array.isArray(v) ? v.length === 2 &&
    v.every(n => typeof n === 'number' && Number.isFinite(n)) :
    Object.values(v).every(j => Array.isArray(j) && j.length === 2 &&
      j.every(n => typeof n === 'number' && Number.isFinite(n))));
}
