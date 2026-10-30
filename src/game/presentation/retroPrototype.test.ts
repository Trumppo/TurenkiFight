import { describe, expect, it } from 'vitest';
import { RETRO_PALETTE, RETRO_STATION_PATH } from './retroPrototype';
import { fighterKey, FRAMES_PER_POSE, POSES } from './fighterSprites';

describe('M1.5 prototype contracts', () => {
  it('keeps every existing pose and its 4-frame texture key', () => {
    expect(POSES).toEqual(['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn']);
    expect(FRAMES_PER_POSE).toBe(4);
    for (const pose of POSES) for (let i = 0; i < 4; i++) {
      expect(fighterKey('P1',pose,i)).toBe(`fighter-P1-${pose}-${i}`);
    }
  });
  it('uses a replaceable Vite public station asset path and original palette', () => {
    expect(RETRO_STATION_PATH).toBe('assets/station/turenki-station-retro.svg');
    expect(Object.values(RETRO_PALETTE)).toHaveLength(11);
  });
});
