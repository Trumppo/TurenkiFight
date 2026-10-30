export type Joint = readonly [number, number];
export interface Leg { hip: Joint; knee: Joint; ankle: Joint }
export interface FighterRig { leftLeg: Leg; rightLeg: Leg }
export const KICK_PHASES = ['chamber', 'raise', 'extend', 'recover'] as const;
export function fighterRig(pose: 'idle' | 'kick', frame: number): FighterRig {
  if (!Number.isInteger(frame) || frame < 0 || frame > 3) throw new RangeError('frame must be 0..3');
  const leftLeg: Leg = { hip: [13,32], knee: [10,38], ankle: [8,43] };
  const knees: Joint[] = [[23,38],[25,30],[25,27],[24,32]];
  const ankles: Joint[] = [[25,43],[27,34],[31,27],[27,40]];
  const rightLeg: Leg = { hip: [21,32], knee: pose === 'kick' ? knees[frame] : [23,38], ankle: pose === 'kick' ? ankles[frame] : [25,43] };
  return { leftLeg, rightLeg };
}
