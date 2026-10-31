import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test('VIS-02B visual review sheet for all four retro fighters', async ({ page }) => {
  test.skip(process.env.VITE_VISUAL_STYLE !== 'retro', 'Retro-only visual evidence');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (name: string) => {
      textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } };
    } } } }).__turenkiGame!;
    const textures = game.scene.getScene('StationScene').textures;
    const poses = ['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn'];
    const canvas = document.createElement('canvas');
    const scale = 3, cellW = 40, cellH = 54;
    canvas.id = 'fighter-review-sheet';
    canvas.width = poses.length * cellW * scale;
    canvas.height = 4 * cellH * scale;
    canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;image-rendering:pixelated';
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#202938';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font = '10px monospace';
    for (const [row,id] of ['P1','P2','P3','P4'].entries()) {
      for (const [column,pose] of poses.entries()) {
        const image = textures.get(`fighter-${id}-${pose}-2`).getSourceImage();
        ctx.drawImage(image,(column*cellW+4)*scale,(row*cellH+2)*scale,32*scale,48*scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(id, (column*cellW+2)*scale,(row*cellH+cellH-1)*scale);
      }
    }
    document.body.appendChild(canvas);
  });
  const sheet = page.locator('#fighter-review-sheet');
  await expect(sheet).toBeVisible();
  mkdirSync('artifacts/visual', { recursive: true });
  await sheet.screenshot({ path:'artifacts/visual/vis-02b-four-fighter-pose-sheet.png' });
});
