import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createState } from '../../src/game/simulation/step';

const poses = ['idle', 'walk', 'depth', 'punch', 'kick', 'jump', 'jumpkick', 'hit', 'ko', 'respawn'];
const retroMainHashes = {
  P1: '39a8610a',
  P2: 'c0b1bf96',
  P3: '64846402',
  P4: '3acf70bf',
};

test('P5-P8 are original monochrome silhouettes; P1-P4 textures match main', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.textures?.exists('fighter-P8-respawn-3'));
  const evidence = await page.evaluate((poseKeys) => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const combined: Record<string, string> = {};
    const silhouette: Record<string, { hash: string; pixels: number }> = {};
    const bounds: Record<string, { minX: number; minY: number; maxX: number; maxY: number }> = {};
    const poses = poseKeys as string[];
    for (let player = 1; player <= 8; player++) {
      const id = `P${player}`;
      let combinedHash = 2166136261;
      const idleSource = scene.textures.get(`fighter-${id}-idle-0`).getSourceImage() as HTMLCanvasElement;
      const idlePixels = idleSource.getContext('2d')!.getImageData(0, 0, 32, 48).data;
      let maskHash = 2166136261;
      let pixelCount = 0;
      for (let index = 3; index < idlePixels.length; index += 4) {
        const present = idlePixels[index] > 0 ? 1 : 0;
        pixelCount += present;
        maskHash ^= present;
        maskHash = Math.imul(maskHash, 16777619);
      }
      silhouette[id] = { hash: (maskHash >>> 0).toString(16).padStart(8, '0'), pixels: pixelCount };
      for (const pose of poses) for (let frame = 0; frame < 4; frame++) {
        const key = `fighter-${id}-${pose}-${frame}`;
        if (!scene.textures.exists(key)) throw new Error(`Missing animation texture ${key}`);
        const source = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
        if (source.width !== 32 || source.height !== 48) throw new Error(`Unexpected cell size for ${key}`);
        const rgba = source.getContext('2d')!.getImageData(0, 0, 32, 48).data;
        for (const byte of Array.from(rgba)) { combinedHash ^= byte; combinedHash = Math.imul(combinedHash, 16777619); }
        if (player >= 5) {
          let minX = 32, minY = 48, maxX = -1, maxY = -1;
          for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
            if (rgba[(y * 32 + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
           const airborne = pose === 'jump' || pose === 'jumpkick';
           // Grounded cel drawings reach the shared foot baseline. Jump cels
           // may lift the feet, but must still retain a substantial silhouette
           // within the 32x48 cell; world Z and origin remain scene-owned.
           if (minX < 0 || minY < 0 || maxX >= 32 || maxY >= 48 || maxY < (airborne ? 35 : 43)) throw new Error(`Clipped or incomplete pose ${key}`);
          bounds[key] = { minX, minY, maxX, maxY };
        }
      }
      combined[id] = (combinedHash >>> 0).toString(16).padStart(8, '0');
    }
    return { combined, silhouette, bounds };
  }, poses);

  expect(Object.fromEntries(Object.entries(evidence.combined).filter(([id]) => id <= 'P4'))).toEqual(retroMainHashes);
  const newSilhouetteHashes = ['P5', 'P6', 'P7', 'P8'].map(id => evidence.silhouette[id].hash);
  expect(new Set(newSilhouetteHashes).size, 'Each new character must have a different monochrome bitmap silhouette').toBe(4);
  expect(['P5', 'P6', 'P7', 'P8'].every(id => evidence.silhouette[id].pixels > 150)).toBe(true);
  expect(Object.keys(evidence.bounds)).toHaveLength(4 * poses.length * 4);
  for (const id of ['P5', 'P6', 'P7', 'P8']) {
    const origin = await page.evaluate(({ playerId, state }) => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.state = state;
      scene.drawFighters();
      const sprite = scene.fighterSprites.get(playerId);
      return { x: sprite.originX, y: sprite.originY };
    }, { playerId: id, state: createState([id], 'lobby') });
    expect(origin, `${id} keeps the bottom-centre world anchor`).toEqual({ x: 0.5, y: 1 });
  }

  // Capture a compact eight-player crowd with both depth lanes represented. All eight
  // game sprites are active; alternating y positions keep accessories inspectable.
  for (const viewport of [
    { name: '640x360', width: 640, height: 360 },
    { name: '1280x720', width: 1280, height: 720 },
    { name: '390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.sys?.isActive());
    const state = createState({ ids: Array.from({ length: 8 }, (_, i) => `P${i + 1}`), phase: 'fighting', mode: 'score-brawl' });
    state.fighters.forEach((fighter, index) => {
      fighter.x = 35 + index * 45;
      fighter.y = index % 2 === 0 ? 157 : 178;
    });
    await page.evaluate((nextState) => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.botSlots = new Set(nextState.fighters.slice(1).map((fighter: { id: string }) => fighter.id));
      scene.state = nextState;
      scene.drawFighters();
      if (scene.sys.isActive()) scene.sys.pause();
    }, state);
    await expect(page.locator('.hud-player')).toHaveCount(8);
    await expect(page.locator('.hud-player').nth(7)).toContainText('P8');
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/m9-p5-p8-eight-fighters-${viewport.name}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.sys?.isActive());
  const crowd = createState({ ids: Array.from({ length: 8 }, (_, i) => `P${i + 1}`), phase: 'fighting', mode: 'score-brawl' });
  crowd.fighters.forEach((fighter, index) => {
    fighter.x = 134 + (index % 4) * 26;
    fighter.y = index < 4 ? 163 : 141;
  });
  await page.evaluate((state) => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.botSlots = new Set(state.fighters.slice(1).map((fighter: { id: string }) => fighter.id));
    scene.state = state;
    scene.drawFighters();
    if (scene.sys.isActive()) scene.sys.pause();
  }, crowd);
  await page.screenshot({ path: 'artifacts/visual/m9-p5-p8-crowded-fight-1280x720.png', fullPage: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.textures?.exists('fighter-P8-respawn-3'));
  await page.evaluate((poseKeys) => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const sheet = document.createElement('canvas');
    sheet.id = 'm9-pose-contact-sheet';
    sheet.width = 512;
    sheet.height = poseKeys.length * 208;
    sheet.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;width:512px;height:auto;background:#182535;image-rendering:pixelated';
    const ctx = sheet.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#f4e5b4';
    ctx.font = '12px monospace';
    for (let row = 0; row < poseKeys.length; row++) {
      ctx.fillText(poseKeys[row], 4, row * 208 + 14);
      for (let column = 0; column < 4; column++) {
        const playerId = `P${column + 5}`;
        const source = scene.textures.get(`fighter-${playerId}-${poseKeys[row]}-0`).getSourceImage() as HTMLCanvasElement;
        ctx.drawImage(source, column * 128, row * 208 + 16, 128, 192);
      }
    }
    document.body.appendChild(sheet);
  }, poses);
  mkdirSync('artifacts/visual', { recursive: true });
  await page.locator('#m9-pose-contact-sheet').screenshot({ path: 'artifacts/visual/m9-p5-p8-pose-contact-sheet.png' });
});
