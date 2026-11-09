import { describe, expect, it } from 'vitest';
import {
  contrastRatio, fighterMarkerOffset, FIGHTER_MARKER_CONTRAST_THRESHOLD, FIGHTER_MARKER_FACE,
  FIGHTER_MARKER_FLOORS, FIGHTER_MARKER_OUTLINE, FIGHTER_MARKER_TEXT_SIZE, playerMarkerLabel,
} from './fighterMarker';

describe('persistent fighter player markers', () => {
  it('uses a unique non-colour number cue for every supported slot', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const labels = ids.map(playerMarkerLabel);
    expect(labels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(new Set(labels).size).toBe(8);
    expect(FIGHTER_MARKER_TEXT_SIZE).toBeGreaterThanOrEqual(12);
  });

  it('fans eight markers into separated rows when fighters occupy the same point', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const boxes = ids.map(id => ({ ...fighterMarkerOffset(id), left: 0, top: 0 }));
    for (let index = 0; index < boxes.length; index++) {
      for (let other = index + 1; other < boxes.length; other++) {
        const a = boxes[index], b = boxes[other];
        const separated = Math.abs(a.x - b.x) >= 17 || Math.abs(a.y - b.y) >= 13;
        expect(separated, `${ids[index]} overlaps ${ids[other]} at the same fighter position`).toBe(true);
      }
    }
  });

  it('keeps both the marker face and outline at least 3:1 against each unchanged arena floor', () => {
    const measured = Object.fromEntries(Object.entries(FIGHTER_MARKER_FLOORS).map(([arenaStyle, floor]) => [
      arenaStyle,
      {
        face: Number(contrastRatio(FIGHTER_MARKER_FACE, floor).toFixed(2)),
        outline: Number(contrastRatio(FIGHTER_MARKER_OUTLINE, floor).toFixed(2)),
      },
    ]));
    expect(measured).toEqual({
      stationClassic: { face: 3.95, outline: 3.99 },
      stationRetro: { face: 4.2, outline: 3.76 },
      kkauppaClassic: { face: 3.34, outline: 4.72 },
      kkauppaRetro: { face: 3.76, outline: 4.2 },
      meskuRetro: { face: 4.86, outline: 3.25 },
    });
    for (const [arenaStyle, floor] of Object.entries(FIGHTER_MARKER_FLOORS)) {
      expect(contrastRatio(FIGHTER_MARKER_FACE, floor), `${arenaStyle} face contrast`).toBeGreaterThanOrEqual(FIGHTER_MARKER_CONTRAST_THRESHOLD);
      expect(contrastRatio(FIGHTER_MARKER_OUTLINE, floor), `${arenaStyle} outline contrast`).toBeGreaterThanOrEqual(FIGHTER_MARKER_CONTRAST_THRESHOLD);
    }
  });

  it('rejects IDs outside the eight stable player slots', () => {
    expect(() => playerMarkerLabel('P0')).toThrow('Unknown player marker ID: P0');
    expect(() => playerMarkerLabel('CPU')).toThrow('Unknown player marker ID: CPU');
  });
});
