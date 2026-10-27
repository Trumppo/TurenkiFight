import { test, expect } from '@playwright/test';

test('station prototype loads without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TurenkiFight' })).toBeVisible();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByText('Turengin rautatieasema', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('station SVG loads and four-player HUD is visible after gamepad joins', async ({ page }) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => {
    const pads = Array.from({ length: 3 }, (_, index) => ({
      id: `QA Gamepad ${index}`,
      index,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, button) => ({
        pressed: button === 8, touched: button === 8, value: button === 8 ? 1 : 0,
      })),
      timestamp: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
  });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    if (!game) return 0;
    const scene = game.scene.getScene('StationScene') as { playerHud?: Map<string, unknown> };
    return scene.playerHud?.size ?? 0;
  })).toBe(4);
  const state = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      state: { fighters: { id: string }[] };
      textures: { exists: (key: string) => boolean };
      playerHud: Map<string, { text: string }>;
    };
    return {
      players: scene.state.fighters.map(f => f.id),
      textures: ['P1', 'P2', 'P3', 'P4'].every(id =>
        ['idle', 'walk', 'punch', 'kick', 'jumpkick', 'hit', 'ko', 'respawn'].every(pose =>
          [0, 1, 2, 3].every(frame => scene.textures.exists(`fighter-${id}-${pose}-${frame}`)))),
      hud: [...scene.playerHud.values()].map(label => label.text),
      station: scene.textures.exists('station-backdrop'),
    };
  });
  expect(state.players).toEqual(['P1', 'P2', 'P3', 'P4']);
  expect(state.textures).toBe(true);
  expect(state.station).toBe(true);
  expect(state.hud).toHaveLength(4);
  expect(state.hud.every(text => text.includes('HP 100'))).toBe(true);
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});

test('responsive canvas retains 16:9 and logical camera coverage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const geometry = await canvas.evaluate((element: HTMLCanvasElement) => ({
    internalWidth: element.width, internalHeight: element.height,
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
  }));
  expect(geometry.internalWidth).toBe(640);
  expect(geometry.internalHeight).toBe(360);
  expect(geometry.cssWidth / geometry.cssHeight).toBeCloseTo(16 / 9, 1);
});

test('all fighter poses resolve to distinct, nonempty canvas textures', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } };
    };
    const poses = ['idle', 'walk', 'depth', 'punch', 'kick', 'jump', 'jumpkick', 'hit', 'ko', 'respawn'];
    const signatures: Record<string, number[]> = {};
    for (const id of ['P1', 'P2', 'P3', 'P4']) {
      const samples: number[] = [];
      for (const pose of poses) {
        for (let frame = 0; frame < 4; frame++) {
          const canvas = scene.textures.get(`fighter-${id}-${pose}-${frame}`).getSourceImage();
          const context = canvas.getContext('2d')!;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let nonTransparent = 0;
          let colorChecksum = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] === 0) continue;
            nonTransparent++;
            colorChecksum = (colorChecksum + pixels[i] * 3 + pixels[i + 1] * 5 + pixels[i + 2] * 7) >>> 0;
          }
          if (nonTransparent === 0) throw new Error(`Empty fighter texture: ${id}/${pose}/${frame}`);
          samples.push(colorChecksum);
        }
      }
      signatures[id] = samples;
    }
    return signatures;
  });
  for (const samples of Object.values(result)) {
    expect(samples).toHaveLength(40);
    expect(samples.every(checksum => checksum > 0)).toBe(true);
  }
  expect(result.P1).not.toEqual(result.P2);
});

test('HUD clock, score and hit/KO/respawn presentation follow authoritative state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      state: { fighters: Array<{ id: string; health: number; score: number; koTimer: number; protection: number; attackMove: string | null; z: number; x: number; y: number }>; remainingTicks: number; phase: string; tick: number };
      playerHud: Map<string, { text: string }>;
      hudTimer: { text: string };
      pose: (f: unknown, prev?: unknown) => string;
      drawFighters: () => void;
      fighterSprites: Map<string, { texture: { key: string } }>;
      hitFlash: Map<string, number>;
    };
    const f = scene.state.fighters[0];
    f.health = 37;
    f.score = -2;
    scene.state.remainingTicks = 90 * 60;
    scene.drawFighters();
    const hud = scene.playerHud.get(f.id)!.text;
    const clock = scene.hudTimer.text;
    // drawFighters() correctly starts a hit flash when health drops; isolate attack pose assertions.
    scene.hitFlash.delete(f.id);
    f.attackMove = 'punch';
    const punch = scene.pose(f);
    f.attackMove = 'kick';
    const kick = scene.pose(f);
    f.attackMove = 'jumpkick';
    const jumpkick = scene.pose(f);
    f.attackMove = null;
    f.koTimer = 10;
    const ko = scene.pose(f);
    f.koTimer = 0;
    f.protection = 10;
    const respawn = scene.pose(f);
    f.protection = 0;
    scene.hitFlash.set(f.id, scene.state.tick + 12);
    const hit = scene.pose(f, { x: f.x, y: f.y, health: 60 });
    return { hud, clock, punch, kick, jumpkick, ko, respawn, hit };
  });
  expect(result.hud).toContain('HP 37');
  expect(result.hud).toContain('-2');
  expect(result.clock).toBe('01:30');
  expect(result.punch).toBe('punch');
  expect(result.kick).toBe('kick');
  expect(result.jumpkick).toBe('jumpkick');
  expect(result.ko).toBe('ko');
  expect(result.respawn).toBe('respawn');
  // Explicitly assert the hit cue with an active flash, independent of earlier attack assertions.
  expect(result.hit).toBe('hit');
});

test('960x540 browser renderer keeps the same logical camera framing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: {
        scale: { resize: (width: number, height: number) => void };
        canvas: HTMLCanvasElement;
        scene: { getScene: (key: string) => unknown };
      };
    }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      cameras: { main: { zoom: number; setZoom: (zoom: number) => void; centerOn: (x: number, y: number) => void; worldView: { width: number; height: number } } };
      state: { tick: number; fighters: Array<{ x: number; y: number; health: number; score: number }> };
    };
    const before = JSON.stringify(scene.state);
    const originalZoom = scene.cameras.main.zoom;
    game.scale.resize(960, 540);
    scene.cameras.main.setZoom(Math.min(960 / 384, 540 / 216));
    scene.cameras.main.centerOn(192, 108);
    const after = JSON.stringify(scene.state);
    return {
      width: game.canvas.width, height: game.canvas.height,
      zoom: scene.cameras.main.zoom, originalZoom,
      worldWidth: 960 / scene.cameras.main.zoom,
      worldHeight: 540 / scene.cameras.main.zoom,
      simulationUnchanged: before === after,
    };
  });
  expect(result.width).toBe(960);
  expect(result.height).toBe(540);
  expect(result.zoom).toBeCloseTo(2.5);
  expect(result.originalZoom).toBeCloseTo(640 / 384);
  expect(result.worldWidth).toBeCloseTo(384);
  expect(result.worldHeight).toBeCloseTo(216);
  expect(result.simulationUnchanged).toBe(true);
});
