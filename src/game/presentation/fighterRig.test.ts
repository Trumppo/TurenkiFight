import { describe, expect, it } from 'vitest';
import { fighterRig, isValidRig, KICK_PHASES } from './fighterRig';

describe('reusable fighter anatomy', () => {
  it('has exactly two named legs in every phase', () => {
    for (let frame = 0; frame < 4; frame++) {
      const rig = fighterRig('kick', frame);
      expect(Object.keys(rig).sort()).toEqual(['leftLeg', 'rightLeg']);
      expect(rig.leftLeg.ankle).toEqual([8, 43]);
      expect(rig.rightLeg.hip).toEqual([21, 32]);
    }
  });
  it('has four separate kick configurations', () => {
    expect(KICK_PHASES).toHaveLength(4);
    const ankles = Array.from({ length: 4 }, (_, i) => fighterRig('kick', i).rightLeg.ankle.join(','));
    expect(new Set(ankles).size).toBe(4);
  });
  it('reuses four-limb anatomy across all fighter poses', () => {
    for (const pose of ['idle', 'kick', 'punch'] as const) for (let frame = 0; frame < 4; frame++) {
      const rig = fighterRig(pose, frame);
      expect(isValidRig(rig)).toBe(true);
      expect(Object.keys(rig).sort()).toEqual(['head','leftArm','leftLeg','neck','pelvis','rightArm','rightLeg']);
      expect(Object.keys(rig.leftArm)).toEqual(['shoulder','elbow','wrist']);
      expect(Object.keys(rig.rightArm)).toEqual(['shoulder','elbow','wrist']);
    }
  });
  it('moves punch wrist across keyframes while retaining shoulder anchor', () => {
    expect(fighterRig('punch', 0).rightArm.wrist).not.toEqual(fighterRig('punch', 2).rightArm.wrist);
    expect(fighterRig('punch', 0).rightArm.shoulder).toEqual(fighterRig('punch', 2).rightArm.shoulder);
  });
  it('rejects invalid frames', () => {
    expect(() => fighterRig('kick', 4)).toThrow(RangeError);
    expect(() => fighterRig('kick', -1)).toThrow(RangeError);
  });
});
