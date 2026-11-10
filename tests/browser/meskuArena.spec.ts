import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createState } from '../../src/game/simulation/step';

const sizes = [
  { name: 'native', width: 640, height: 360 },
  { name: 'double', width: 1280, height: 720 },
  { name: 'triple', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const size of sizes) {
  test(`Mesku arena preserves four-player readability at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const assetResponses: number[] = [];
    page.on('response', response => {
      if (response.url().includes('/assets/mesku/ravintola-mesku-evening.svg')) assetResponses.push(response.status());
    });
    await page.goto('/?arena=mesku');
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    await expect(page.locator('.page-header p')).toHaveText('Ravintola Mesku · evening 2.5D arena prototype');
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return scene?.sys.isActive() && scene.textures.exists('arena-mesku-backdrop');
    })).toBe(true);
    await expect.poll(() => assetResponses.length).toBe(1);
    expect(assetResponses).toEqual([200]);
    await expect(canvas).toHaveAttribute('width', '640');
    await expect(canvas).toHaveAttribute('height', '360');

    const fixture = createState(['P1', 'P2', 'P3', 'P4'], 'lobby');
    await page.evaluate(state => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.state = state;
    }, fixture);
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return scene.fighterSprites.size;
    })).toBe(4);
    const silhouettes = await page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return ['P1', 'P2', 'P3', 'P4'].map(id => {
        const image = scene.textures.get(`fighter-${id}-idle-0`).getSourceImage() as HTMLCanvasElement;
        const pixels = image.getContext('2d')!.getImageData(0, 0, image.width, image.height).data;
        let opaque = 0;
        let mask = '';
        for (let i = 3; i < pixels.length; i += 4) {
          const visible = pixels[i] > 0;
          if (visible) opaque++;
          mask += visible ? '1' : '0';
        }
        return { id, width: image.width, height: image.height, opaque, mask };
      });
    });
    expect(silhouettes).toHaveLength(4);
    expect(new Set(silhouettes.map(fighter => fighter.mask)).size, 'fighter silhouettes must have distinct shapes').toBe(4);
    for (const fighter of silhouettes) {
      expect(fighter.width).toBeGreaterThan(0);
      expect(fighter.height).toBeGreaterThan(0);
      expect(fighter.opaque).toBeGreaterThan(80);
    }

    const hud = await page.locator('.hud-player').first().evaluate(element => {
      const card = getComputedStyle(element);
      const text = getComputedStyle(element.querySelector('.hud-score')!);
      const rgb = (value: string): number[] => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (color: number[]): number => {
        const channels = color.map(channel => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const a = luminance(rgb(card.backgroundColor));
      const b = luminance(rgb(text.color));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(hud, 'HUD text maintains WCAG AA contrast independently of arena palette').toBeGreaterThan(4.5);

    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/mesku-${size.name}.png`, fullPage: true });
  });
}

test('unknown arena selection clearly falls back to the default station', async ({ page }) => {
  await page.goto('/?arena=not-real');
  await expect(page.locator('.page-header p')).toHaveText('Unknown arena "not-real"; showing Turenki railway station.');
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return scene?.textures.exists('station-backdrop') && !scene.textures.exists('arena-not-real-backdrop');
  })).toBe(true);
});
test('online entry uses the selected Mesku arena before connecting', async ({ page }) => {
  await page.goto('/online.html?arena=mesku');
  await expect(page.locator('.page-header p')).toHaveText('Remote authoritative match · arena: Ravintola Mesku');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).__turenkiOnline;
    return !!game?.arenaTextureExists();
  })).toBe(true);
});
