import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const style = 'retro';
const evidenceDirectory = resolve('artifacts/m12-item-ui');

test('M12 bottles render on the floor, follow a holder, and use snapshot flight coordinates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?scale=2');
  await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.sys?.isActive());

  const setup = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = scene.state;
    const p1 = state.fighters[0];
    Object.assign(p1, { x: 322, y: 190, z: 0, facing: 1, koTimer: 0, protection: 0, health: 100 });
    const crowd = [
      { ...p1, id: 'P2', x: 337, y: 190 },
      { ...p1, id: 'P3', x: 326, y: 200 },
      { ...p1, id: 'P4', x: 311, y: 198 },
    ];
    state.fighters = [p1, ...crowd];
    state.phase = 'fighting';
    state.tick = 120;
    state.objects = [{ id: 'O1', kind: 'bottle', x: 330, y: 204, z: 0, state: 'ground', spawnTick: 120 }];
    scene.drawFighters();
    return {
      bottle: scene.debugObjects()[0],
      hintVisible: !document.getElementById('object-hint')!.hidden,
    };
  });

  expect(setup.bottle).toMatchObject({ id: 'O1', state: 'ground', visible: true, screenX: 330, screenY: 202 });
  expect(setup.hintVisible).toBe(true);
  await expect.poll(async () => page.locator('#game canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(640);
  await mkdir(evidenceDirectory, { recursive: true });

  // Use the native game backing for 640x360 and exact 2x CSS pixel scaling for
  // 1280x720. The same crowded floor fixture is captured for both visual builds.
  await page.locator('#game canvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.style.setProperty('width', '640px', 'important');
    canvas.style.setProperty('height', '360px', 'important');
  });
  await page.locator('#game canvas').screenshot({ path: resolve(evidenceDirectory, `m12-${style}-640x360.png`) });
  await page.locator('#game canvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.style.setProperty('width', '1280px', 'important');
    canvas.style.setProperty('height', '720px', 'important');
  });
  await page.locator('#game canvas').screenshot({ path: resolve(evidenceDirectory, `m12-${style}-1280x720.png`) });

  const objectDiagnostics = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = scene.state;
    const holder = state.fighters[0];
    state.objects = [{ id: 'O1', kind: 'bottle', x: holder.x, y: holder.y, z: 18, state: 'held', holder: holder.id }];
    scene.drawFighters();
    const held = scene.debugObjects()[0];
    holder.x += 12;
    holder.y += 4;
    holder.facing = -1;
    state.objects[0].x = holder.x;
    state.objects[0].y = holder.y;
    scene.drawFighters();
    const heldAfterMove = scene.debugObjects()[0];
    state.objects = [{ id: 'O1', kind: 'bottle', x: 411, y: 183, z: 37, state: 'airborne', holder: holder.id, vx: 4, vz: 2 }];
    scene.drawFighters();
    return { held, heldAfterMove, thrown: scene.debugObjects()[0] };
  });

  expect(objectDiagnostics.held).toMatchObject({ state: 'held', visible: true, screenX: 337 });
  expect(objectDiagnostics.heldAfterMove).toMatchObject({ state: 'held', visible: true, screenX: 319, screenY: 169 });
  expect(objectDiagnostics.thrown).toMatchObject({
    state: 'airborne', x: 411, y: 183, z: 37, visible: true, screenX: 411, screenY: 146,
  });

  const hintHiddenWithoutObjects = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.objects = undefined;
    scene.drawFighters();
    return (document.getElementById('object-hint') as HTMLElement).hidden;
  });
  expect(hintHiddenWithoutObjects).toBe(true);
});
