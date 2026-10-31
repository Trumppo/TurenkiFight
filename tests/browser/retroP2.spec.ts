import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const retro = process.env.VITE_VISUAL_STYLE === 'retro';

test('VIS-02A P2 retro contract and four-frame poses', async ({ page }) => {
  test.skip(!retro, 'Retro-only character artwork');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const evidence = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (name: string) => {
      textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } };
      fighterSprites: Map<string, { originX: number; originY: number }>;
    } } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    const poses = ['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn'];
    const details = poses.flatMap(pose => Array.from({ length: 4 }, (_, frame) => {
      const source = scene.textures.get(`fighter-P2-${pose}-${frame}`).getSourceImage();
      const pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
      let count = 0, minX = 32, maxX = -1;
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        if (pixels[(y * source.width + x) * 4 + 3] > 0) {
          count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        }
      }
      return { pose, frame, width: source.width, height: source.height, count, minX, maxX };
    }));
    const p1 = scene.textures.get('fighter-P1-idle-0').getSourceImage();
    const p2 = scene.textures.get('fighter-P2-idle-0').getSourceImage();
    const a = p1.getContext('2d')!.getImageData(0,0,32,48).data;
    const b = p2.getContext('2d')!.getImageData(0,0,32,48).data;
    let differing = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2] || a[i+3] !== b[i+3]) differing++;
    return { details, differing };
  });
  expect(evidence.details).toHaveLength(40);
  for (const frame of evidence.details) {
    expect([frame.width,frame.height]).toEqual([32,48]);
    expect(frame.count).toBeGreaterThan(45);
    expect(frame.minX).toBeGreaterThanOrEqual(0);
    expect(frame.maxX).toBeLessThan(32);
  }
  expect(evidence.differing).toBeGreaterThan(120);
});

for (const [label, width, height] of [
  ['native',640,360],['2x',1280,720],['3x',1920,1080],['mobile',390,844],
] as const) {
  test(`VIS-02A comparison screenshot ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    await page.keyboard.press('Shift');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (name: string) => {
        fighterSprites: Map<string, unknown>;
      } } } }).__turenkiGame;
      return game?.scene.getScene('StationScene').fighterSprites.size ?? 0;
    })).toBeGreaterThanOrEqual(2);
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/vis-02a-${retro ? 'retro' : 'classic'}-${label}.png`, animations: 'disabled' });
  });
}
