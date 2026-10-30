import { test, expect } from '@playwright/test';

const retro = process.env.VITE_VISUAL_STYLE === 'retro';
const expanded = retro && process.env.VITE_FIGHTER_CANVAS === 'expanded';
const p1Width = expanded ? 48 : 32;
const p1Height = expanded ? 64 : 48;

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
          return c.width === p1.width && c.height === p1.height;
        })),
      origin: [scene.fighterSprites.get('P1')?.originX, scene.fighterSprites.get('P1')?.originY],
    };
  });
  expect(result.station).toBe(retro ? 640 : 384);
  expect(result.p1).toEqual([p1Width, p1Height]);
  expect(result.p2).toEqual([32, 48]);
  expect(result.keys).toBe(true);
  expect(result.origin).toEqual([0.5, 1]);
  expect(result.p1DistinctFromP2).toBe(true);
  // Deliberately permit 1px facial detail: 320x180 is a stage art grid, not a fighter limit.
  if (retro && !expanded) expect(result.p1Paired).toBe(false);
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

test('capture enlarged P1 pose sheet for visual acceptance', async ({ page }) => {
  test.skip(!retro, 'Only the retro preview is the subject of this pose sheet');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    if (!game) return false;
    const scene = game.scene.getScene('StationScene') as { textures: { exists: (key: string) => boolean } };
    return scene.textures.exists('fighter-P1-idle-0');
  })).toBe(true);
  const sheet = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as { textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } } };
    const poses = ['idle', 'walk', 'depth', 'punch', 'kick', 'jump', 'jumpkick', 'hit', 'ko', 'respawn'];
    const cellW = 220, cellH = 310, scale = 4;
    const out = document.createElement('canvas');
    out.width = cellW * 5; out.height = cellH * 2;
    const g = out.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#202937'; g.fillRect(0, 0, out.width, out.height);
    g.font = 'bold 17px monospace'; g.textBaseline = 'top';
    for (let p = 0; p < poses.length; p++) {
      const x = (p % 5) * cellW, y = Math.floor(p / 5) * cellH;
      g.fillStyle = '#303c4a'; g.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
      g.fillStyle = '#f0d8ad'; g.fillText(poses[p].toUpperCase(), x + 12, y + 9);
      const texture = scene.textures.get(`fighter-P1-${poses[p]}-2`).getSourceImage();
      g.drawImage(texture, x + 10, y + 30, texture.width * scale, texture.height * scale);
      g.fillStyle = '#aab6c5'; g.fillText('frame 2 / 4', x + 12, y + 290);
    }
    return out.toDataURL('image/png');
  });
  const image = Buffer.from(sheet.split(',')[1], 'base64');
  const fs = await import('node:fs');
  fs.mkdirSync('artifacts/visual', { recursive: true });
  fs.writeFileSync(`artifacts/visual/${expanded ? 'expanded' : 'retro'}-P1-pose-sheet.png`, image);
  expect(image.byteLength).toBeGreaterThan(1000);
});

test('capture four-frame kick anatomy strip for acceptance', async ({ page }) => {
  test.skip(!retro, 'Retro fighter anatomy only');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { textures: { exists: (key: string) => boolean } } } } }).__turenkiGame;
    return !!game?.scene.getScene('StationScene').textures.exists('fighter-P1-kick-3');
  })).toBe(true);
  const imageData = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } } } } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    const phases = ['CHAMBER', 'RAISE', 'EXTEND', 'RECOVER'];
    const scale = 4, width = 220, height = 305;
    const out = document.createElement('canvas');
    out.width = width * 4; out.height = height;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#26313e'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.font = 'bold 18px monospace'; ctx.textBaseline = 'top';
    for (let frame = 0; frame < 4; frame++) {
      const x = frame * width;
      ctx.fillStyle = '#f1d9b4'; ctx.fillText(phases[frame], x + 12, 12);
      const texture = scene.textures.get(`fighter-P1-kick-${frame}`).getSourceImage();
      ctx.drawImage(texture, x + 15, 38, texture.width * scale, texture.height * scale);
    }
    return out.toDataURL('image/png');
  });
  const fs = await import('node:fs');
  fs.mkdirSync('artifacts/visual', { recursive: true });
  const image = Buffer.from(imageData.split(',')[1], 'base64');
  fs.writeFileSync(`artifacts/visual/${expanded ? 'expanded' : 'retro'}-P1-kick-four-phases.png`, image);
  expect(image.byteLength).toBeGreaterThan(1000);
});

test('forward kick overlaps torso without a duplicate third leg', async ({ page }) => {
  test.skip(!retro || expanded, 'Pixel coordinates are specific to the original 32x48 kick');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } } } } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    const canvas = scene.textures.get('fighter-P1-kick-2').getSourceImage();
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const opaque = (x: number, y: number) => pixels[(y * canvas.width + x) * 4 + 3] > 0;
    return {
      dimensions: [canvas.width, canvas.height],
      forwardFoot: [27, 28, 29, 30, 31].some(x => opaque(x, 29)),
      torsoOverlap: [23, 24, 25, 26].some(x => opaque(x, 30)),
      noOverflow: canvas.width === 32,
    };
  });
  expect(result.dimensions).toEqual([p1Width, p1Height]);
  expect(result.forwardFoot).toBe(true);
  expect(result.torsoOverlap).toBe(true);
  expect(result.noOverflow).toBe(true);
});

test('extended kick toe uses boot shading rather than a stray bright spark', async ({ page }) => {
  test.skip(!retro || expanded, 'Toe pixel coordinate is specific to the original 32x48 canvas');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { textures: { exists: (key: string) => boolean } } } } }).__turenkiGame;
    return !!game?.scene.getScene('StationScene').textures.exists('fighter-P1-kick-2');
  })).toBe(true);
  const pixel = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } } } } } }).__turenkiGame!;
    const source = game.scene.getScene('StationScene').textures.get('fighter-P1-kick-2').getSourceImage();
    return Array.from(source.getContext('2d')!.getImageData(29, 28, 1, 1).data);
  });
  // Pixel colors can vary with overlap/outline; reject bright isolated spark pixels.
  expect(pixel[3]).toBe(255);
  expect(Math.max(...pixel.slice(0, 3))).toBeLessThan(110);
});
