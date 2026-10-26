import { describe, expect, it } from 'vitest';
import { VIEWPORT, cameraScale } from './viewport';
import { VISUAL_ASSETS, publicAssetUrl } from './visualAssets';

describe('presentation asset and camera contract', () => {
  it('resolves station artwork in development and GitHub Pages subpaths', () => {
    const path = VISUAL_ASSETS.station.backdrop.path;
    expect(publicAssetUrl('/', path)).toBe('/assets/station/turenki-station-background.svg');
    expect(publicAssetUrl('./', path)).toBe('./assets/station/turenki-station-background.svg');
    expect(publicAssetUrl('/TurenkiFight/', path)).toBe('/TurenkiFight/assets/station/turenki-station-background.svg');
    expect(() => publicAssetUrl('/', '../private')).toThrow();
    expect(() => publicAssetUrl('/', 'https://elsewhere.example/art.svg')).toThrow();
  });

  it('keeps the same logical camera coverage at 640x360 and 960x540', () => {
    expect(VIEWPORT.renderWidth).toBe(640);
    expect(VIEWPORT.renderHeight).toBe(360);
    const scale640 = cameraScale(640, 360);
    const scale960 = cameraScale(960, 540);
    expect(scale640 * VIEWPORT.logicalWidth).toBeCloseTo(640);
    expect(scale640 * VIEWPORT.logicalHeight).toBeCloseTo(360);
    expect(scale960 * VIEWPORT.logicalWidth).toBeCloseTo(960);
    expect(scale960 * VIEWPORT.logicalHeight).toBeCloseTo(540);
    expect(640 / scale640).toBeCloseTo(960 / scale960);
    expect(360 / scale640).toBeCloseTo(540 / scale960);
  });

  it('keeps art rasterization independent from render resolution', () => {
    expect(VISUAL_ASSETS.station.backdrop.width).toBe(VIEWPORT.logicalWidth);
    expect(VISUAL_ASSETS.station.backdrop.height).toBe(VIEWPORT.logicalHeight);
  });
});
