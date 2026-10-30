import { describe, expect, it } from 'vitest';
import { RETRO_PALETTE, RETRO_STATION_PATH, RETRO_P1_SIZE, EXPANDED_P1_CANVAS } from './retroPrototype';
import { fighterKey, FRAMES_PER_POSE, POSES } from './fighterSprites';

describe('M1.5 prototype contracts', () => {
  it('keeps every existing pose and its 4-frame texture key', () => {
    expect(POSES).toEqual(['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn']);
    expect(FRAMES_PER_POSE).toBe(4);
    for (const pose of POSES) for (let i = 0; i < 4; i++) {
      expect(fighterKey('P1',pose,i)).toBe(`fighter-P1-${pose}-${i}`);
    }
  });
  it('keeps the expanded sprite strictly opt-in', () => {
    expect(RETRO_P1_SIZE).toEqual(EXPANDED_P1_CANVAS ? { width: 48, height: 64 } : { width: 32, height: 48 });
    expect(RETRO_P1_SIZE.width / RETRO_P1_SIZE.height).toBeGreaterThan(0);
  });
  it('uses a replaceable Vite public station asset path and original palette', () => {
    expect(RETRO_STATION_PATH).toBe('assets/station/turenki-station-retro.svg');
    expect(Object.values(RETRO_PALETTE)).toHaveLength(11);
  });
});
