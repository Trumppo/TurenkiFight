import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createState } from '../../src/game/simulation/step';

const retro = process.env.VITE_VISUAL_STYLE === 'retro';
const style = retro ? 'retro' : 'classic';

async function waitForBackdrop(page: import('@playwright/test').Page, texture: string): Promise<void> {
  await expect.poll(() => page.evaluate((key) => {
    const scene = (window as any).__turenkiGame?.scene.getScene('StationScene');
    return scene?.sys.isActive() && scene.textures.exists(key);
  }, texture)).toBe(true);
}

async function captureBackdrop(page: import('@playwright/test').Page, query: string, texture: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(query);
  await waitForBackdrop(page, texture);
  await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.scene.pause('StationScene');
    for (const sprite of scene.fighterSprites.values()) sprite.setVisible(false);
    scene.zoneGraphics?.setVisible(false);
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const png = await page.locator('#game canvas').screenshot();
  const stats = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let y = 0; y < canvas.height && colors.size <= 32; y += 3) {
      for (let x = 0; x < canvas.width && colors.size <= 32; x += 3) {
        const index = (y * canvas.width + x) * 4;
        colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
      }
    }
    return { width: canvas.width, height: canvas.height, distinctColors: colors.size };
  }, png.toString('base64'));
  expect([stats.width, stats.height]).toEqual([960, 540]);
  expect(stats.distinctColors, 'background screenshot should not be blank or uniform').toBeGreaterThan(32);
  return { png, stats };
}

async function assetSha256(assetPath: string): Promise<string> {
  const text = await readFile(resolve(process.cwd(), 'public', assetPath), 'utf8');
  // Git may check out these committed SVGs with CRLF on Windows or LF on Linux.
  const bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

test('K-kauppa renders in both styles with four readable fighter sprites at native and 2x scale', async ({ page }) => {
  for (const size of [{ name: '640x360', width: 640, height: 360, scale: 1 }, { name: '1280x720', width: 1280, height: 720, scale: 2 }]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(size.scale === 2 ? '/?arena=kkauppa&scale=2' : '/?arena=kkauppa');
    await expect(page.locator('#game canvas')).toBeVisible();
    await expect(page.locator('.page-header p')).toHaveText('K-kauppa · interior 2.5D arena prototype');
    await waitForBackdrop(page, 'arena-kkauppa-backdrop');
    await expect(page.locator('#game canvas')).toHaveAttribute('width', '640');
    await expect(page.locator('#game canvas')).toHaveAttribute('height', '360');

    const state = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
    await page.evaluate((fixture) => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.state = fixture;
      scene.drawFighters();
    }, state);
    await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').fighterSprites.size)).toBe(4);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const canvas = page.locator('#game canvas');
    await canvas.evaluate((node, scaleFactor) => {
      // Chromium's screenshot compositor captures WebGL correctly; reading the
      // default non-preserved drawing buffer through toDataURL would be black.
      (node as HTMLCanvasElement).style.width = `${640 * scaleFactor}px`;
      (node as HTMLCanvasElement).style.height = `${360 * scaleFactor}px`;
      (node as HTMLCanvasElement).style.imageRendering = 'pixelated';
    }, size.scale);
    const captured = await canvas.screenshot({ scale: 'css' });
    const png = size.scale === 1
      ? Buffer.from((await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const output = document.createElement('canvas');
        output.width = 640;
        output.height = 360;
        const context = output.getContext('2d')!;
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, output.width, output.height);
        return output.toDataURL('image/png');
      }, captured.toString('base64'))).split(',')[1]!, 'base64')
      : captured;
    expect(await canvas.evaluate(node => [(node as HTMLCanvasElement).width, (node as HTMLCanvasElement).height])).toEqual([640, 360]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640 * size.scale, 360 * size.scale]);
    expect(png.byteLength).toBeGreaterThan(4000);
    const dir = join(process.cwd(), 'artifacts', 'screenshots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `m15-kkauppa-${style}-${size.name}.png`), png);
  }
});

test('station default and Mesku selection still resolve their original backdrops', async ({ page }) => {
  await page.goto('/');
  await waitForBackdrop(page, 'station-backdrop');
  expect(await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return scene.textures.exists('station-backdrop') && !scene.textures.exists('arena-kkauppa-backdrop');
  })).toBe(true);

  await page.goto('/?arena=mesku');
  const expected = retro ? 'arena-mesku-backdrop' : 'station-backdrop';
  await waitForBackdrop(page, expected);
  expect(await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return {
      station: scene.textures.exists('station-backdrop'),
      mesku: scene.textures.exists('arena-mesku-backdrop'),
      shop: scene.textures.exists('arena-kkauppa-backdrop'),
    };
  })).toEqual(retro
    ? { station: false, mesku: true, shop: false }
    : { station: true, mesku: false, shop: false });

  await page.goto('/online.html?arena=kkauppa');
  await expect(page.locator('.page-header p')).toHaveText('Remote authoritative match · arena: K-kauppa');
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiOnline?.arenaTextureExists())).toBe(true);
});

test('the shelf event is a harmless, non-text presentation telegraph', async ({ page }) => {
  await page.goto('/?arena=kkauppa');
  await waitForBackdrop(page, 'arena-kkauppa-backdrop');
  const state = createState(['P1', 'P2'], 'fighting');
  await page.evaluate((fixture) => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.scene.pause('StationScene');
    scene.state = fixture;
    scene.drawFighters();
  }, state);
  const early = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 2519;
    scene.drawFighters();
    return scene.arenaTelegraph.diagnostics();
  });
  expect(early).toEqual({ active: false, cueCount: 0 });

  const cue = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 2520;
    scene.drawFighters();
    const stateBytes = JSON.stringify(scene.state);
    scene.drawFighters();
    return {
      visual: scene.arenaTelegraph.diagnostics(),
      sounds: scene.audioDiagnostics().cueCounts['shop-bell'],
      unchangedState: stateBytes === JSON.stringify(scene.state),
      text: `${document.querySelector('#match-status')?.textContent} ${document.querySelector('.page-header p')?.textContent}`,
    };
  });
  expect(cue.visual).toEqual({ active: true, cueCount: 1 });
  expect(cue.sounds).toBe(1);
  expect(cue.unchangedState).toBe(true);
  expect(cue.text).not.toMatch(/hazard|collapse|damage|warning/i);
});

test('station and Mesku SVG content matches the line-ending-independent pre-arena baseline', async () => {
  // SHA-256 values are computed over UTF-8 text after CRLF-to-LF normalization.
  expect(await assetSha256('assets/station/turenki-station-background.svg'))
    .toBe('738e9082dd3b73ff0893d877047455c7fea20cb38438c174299c2fb0a01e5962');
  expect(await assetSha256('assets/station/turenki-station-retro.svg'))
    .toBe('01fcb21015ce6a8666dd15738927480d85353421bf1db59a37a45d6bba0ed4c5');
  expect(await assetSha256('assets/mesku/ravintola-mesku-evening.svg'))
    .toBe('61ec56637ee9c33ebae4543a18e029f3ab148a7c3663a12fbed9d374d74779e5');
});

test('classic Mesku fallback produces the same nonblank station capture in this run', async ({ page }) => {
  test.skip(retro, 'Classic-only fallback comparison');
  const station = await captureBackdrop(page, '/', 'station-backdrop');
  const meskuFallback = await captureBackdrop(page, '/?arena=mesku', 'station-backdrop');
  expect(station.png.equals(meskuFallback.png), 'classic Mesku fallback should render the unchanged station')
    .toBe(true);
});

test('retro station default and unknown-arena fallback match; Mesku remains distinct', async ({ page }) => {
  test.skip(!retro, 'Retro-only fallback comparison');
  const station = await captureBackdrop(page, '/', 'station-backdrop');
  const unknownFallback = await captureBackdrop(page, '/?arena=not-real', 'station-backdrop');
  const mesku = await captureBackdrop(page, '/?arena=mesku', 'arena-mesku-backdrop');
  expect(station.png.equals(unknownFallback.png), 'retro unknown-arena fallback should render the station')
    .toBe(true);
  expect(station.png.equals(mesku.png), 'retro Mesku is a distinct arena, not a fallback')
    .toBe(false);
});
