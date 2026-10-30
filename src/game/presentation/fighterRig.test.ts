import { describe, expect, it } from 'vitest';
import { fighterRig, isValidRig, transformRig, KICK_PHASES } from './fighterRig';

describe('reusable fighter anatomy', () => {
  it('has exactly two named legs in every phase', () => {
    for (let frame = 0; frame < 4; frame++) {
      const rig = fighterRig('kick', frame);
      expect(Object.keys(rig).filter(k => k.endsWith('Leg')).sort()).toEqual(['leftLeg', 'rightLeg']);
      expect(rig.leftLeg.ankle).toEqual([8, 43]);
      expect(rig.rightLeg.hip).toEqual([21, 32]);
    }
  });
  it('keeps the kick boot fully inside the 32-pixel-wide source sprite', () => {
    for (let frame = 0; frame < 4; frame++) {
      const ankleX = fighterRig('kick', frame).rightLeg.ankle[0];
      expect(ankleX - 4).toBeGreaterThanOrEqual(0);
      expect(ankleX + 3).toBeLessThanOrEqual(32);
    }
  });
  it('has four separate kick configurations', () => {
    expect(KICK_PHASES).toHaveLength(4);
    const ankles = Array.from({ length: 4 }, (_, i) => fighterRig('kick', i).rightLeg.ankle.join(','));
    expect(new Set(ankles).size).toBe(4);
  });
  it('reuses four-limb anatomy across all fighter poses', () => {
    for (const pose of ['idle', 'kick', 'punch', 'jump', 'walk', 'hit'] as const) for (let frame = 0; frame < 4; frame++) {
      const rig = fighterRig(pose, frame);
      expect(isValidRig(rig)).toBe(true);
      expect(Object.keys(rig).sort()).toEqual(['head','leftArm','leftLeg','neck','pelvis','rightArm','rightLeg']);
      expect(Object.keys(rig.leftArm)).toEqual(['shoulder','elbow','wrist']);
      expect(Object.keys(rig.rightArm)).toEqual(['shoulder','elbow','wrist']);
    }
  });
  it('replaces the standing leg positions during jumps', () => {
    const standing = fighterRig('idle', 2);
    const jumping = fighterRig('jump', 2);
    expect(jumping.leftLeg.ankle).not.toEqual(standing.leftLeg.ankle);
    expect(jumping.rightLeg.ankle).not.toEqual(standing.rightLeg.ankle);
  });
  it('articulates both legs in the walk cycle and both arms in hit recoil', () => {
    expect(fighterRig('walk', 1).leftLeg.ankle).not.toEqual(fighterRig('walk', 3).leftLeg.ankle);
    expect(fighterRig('walk', 1).rightLeg.ankle).not.toEqual(fighterRig('walk', 3).rightLeg.ankle);
    expect(fighterRig('hit', 1).leftArm.wrist).not.toEqual(fighterRig('idle', 1).leftArm.wrist);
    expect(fighterRig('hit', 1).rightArm.wrist).not.toEqual(fighterRig('idle', 1).rightArm.wrist);
  });
  it('moves punch wrist across keyframes while retaining shoulder anchor', () => {
    expect(fighterRig('punch', 0).rightArm.wrist).not.toEqual(fighterRig('punch', 2).rightArm.wrist);
    expect(fighterRig('punch', 0).rightArm.shoulder).toEqual(fighterRig('punch', 2).rightArm.shoulder);
  });
  it('supports independent character proportions without changing pose anatomy', () => {
    const base = fighterRig('kick', 2);
    const taller = transformRig(base, { scaleX: 1, scaleY: 1.25, offsetX: 0, offsetY: 0 });
    expect(isValidRig(taller)).toBe(true);
    expect(taller.head[1]).toBeLessThan(base.head[1]);
    expect(taller.rightLeg.ankle[0]).toBe(base.rightLeg.ankle[0]);
    expect(base.head).toEqual([17,11]);
    expect(Object.keys(taller).sort()).toEqual(Object.keys(base).sort());
  });
  it('rejects invalid proportions', () => {
    expect(() => transformRig(fighterRig('idle', 0), { scaleX: 0, scaleY: 1, offsetX: 0, offsetY: 0 })).toThrow(RangeError);
    expect(() => transformRig(fighterRig('idle', 0), { scaleX: 1, scaleY: NaN, offsetX: 0, offsetY: 0 })).toThrow(RangeError);
  });
  it('rejects invalid frames', () => {
    expect(() => fighterRig('kick', 4)).toThrow(RangeError);
    expect(() => fighterRig('kick', -1)).toThrow(RangeError);
  });
});
