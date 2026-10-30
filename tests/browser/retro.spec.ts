import { test, expect } from '@playwright/test';

const retro = process.env.VITE_VISUAL_STYLE === 'retro';

test('station and P1 prototype render with stable legacy sprite API', async ({ page }) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } };
      fighterSprites: Map<string, { texture: { key: string }; originX: number; originY: number }>;
    };
    const pixels = (id: string) => {
      const canvas = scene.textures.get(`fighter-${id}-idle-0`).getSourceImage();
      const ctx = canvas.getContext('2d')!;
      return { width: canvas.width, height: canvas.height, rgba: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
    };
    const p1 = pixels('P1');
    const p2 = pixels('P2');
    let pairedPixels = true;
    // Half-density art should consist of exact 2x2 blocks with identical RGBA values.
    for (let y = 0; y < p1.height; y += 2) for (let x = 0; x < p1.width; x += 2) {
      const base = (y * p1.width + x) * 4;
      for (const [dx, dy] of [[1,0],[0,1],[1,1]]) {
        const neighbor = ((y + dy) * p1.width + x + dx) * 4;
        for (let channel = 0; channel < 4; channel++) {
          if (p1.rgba[base + channel] !== p1.rgba[neighbor + channel]) pairedPixels = false;
        }
      }
    }
    return {
      station: scene.textures.get('station-backdrop').getSourceImage().width,
      p1: [p1.width, p1.height], p2: [p2.width, p2.height],
      p1Paired: pairedPixels,
      p1DistinctFromP2: JSON.stringify(p1.rgba) !== JSON.stringify(p2.rgba),
      keys: ['idle','walk','punch','kick','hit'].every(pose =>
        [0,1,2,3].every(frame => {
          const c = scene.textures.get(`fighter-P1-${pose}-${frame}`).getSourceImage();
          return c.width === 32 && c.height === 48;
        })),
      origin: [scene.fighterSprites.get('P1')?.originX, scene.fighterSprites.get('P1')?.originY],
    };
  });
  expect(result.station).toBe(retro ? 640 : 384);
  expect(result.p1).toEqual([32, 48]);
  expect(result.p2).toEqual([32, 48]);
  expect(result.keys).toBe(true);
  expect(result.origin).toEqual([0.5, 1]);
  expect(result.p1DistinctFromP2).toBe(true);
  if (retro) expect(result.p1Paired).toBe(true);
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
});

for (const [label, width, height] of [
  ['native', 640, 360],
  ['2x', 1280, 720],
  ['3x', 1920, 1080],
  ['mobile', 390, 844],
] as const) {
  test(`visual screenshot ${label} with ${retro ? 'retro' : 'classic'} art`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { sys: { isActive: () => boolean } } } } }).__turenkiGame;
      return !!game?.scene.getScene('StationScene')?.sys.isActive();
    })).toBe(true);
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 1);
    await page.screenshot({ path: `artifacts/visual/${retro ? 'retro' : 'classic'}-${label}.png`, animations: 'disabled' });
  });
}
