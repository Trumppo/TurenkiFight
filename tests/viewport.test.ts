import { describe, expect, it } from 'vitest';
import { cameraScale, VIEWPORT } from '../src/game/presentation/viewport';
import { createState, step } from '../src/game/simulation/step';

describe('render resolution isolation', () => {
  it('defaults to 640x360 with the unchanged 384x216 logical world', () => {
    expect([VIEWPORT.renderWidth, VIEWPORT.renderHeight]).toEqual([640, 360]);
    expect([VIEWPORT.logicalWidth, VIEWPORT.logicalHeight]).toEqual([384, 216]);
    expect(cameraScale(640, 360)).toBeCloseTo(5 / 3);
    expect(cameraScale(960, 540)).toBe(2.5);
  });

  it('preserves deterministic simulation for any presentation scale', () => {
    const input = [{ playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: false }];
    const original = createState(['P1', 'P2'], 'fighting');
    const first = step(original, input);
    cameraScale(960, 540);
    expect(step(original, input)).toEqual(first);
  });
});
