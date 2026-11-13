import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createState } from '../../src/game/simulation/step';
import { enterLocalGame } from './titleFlow';

const sizes = [
  { name: 'native', width: 640, height: 360 },
  { name: 'double', width: 1280, height: 720 },
  { name: 'triple', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const size of sizes) {
  test(`VIS-05 retro arena at ${size.name} viewport`, async ({ page }) => {
    await page.setViewportSize(size.name === 'double' ? { width: 640, height: 720 } : { width: size.width, height: size.height });
    await enterLocalGame(page, '/');
    if (size.name === 'double') await page.setViewportSize({ width: size.width, height: size.height });
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame?: {
        scene: { getScene: (key: string) => {
          sys: { isActive: () => boolean };
          textures: { exists: (key: string) => boolean };
        } };
      } }).__turenkiGame;
      const scene = game?.scene.getScene('StationScene');
      return !!scene?.sys.isActive() && scene.textures.exists('station-backdrop') &&
        ['P1', 'P2', 'P3', 'P4'].every(id =>
          ['idle', 'punch', 'kick', 'hit', 'ko', 'respawn'].every(pose =>
            scene.textures.exists(`fighter-${id}-${pose}-0`)));
    })).toBe(true);
    await expect(canvas).toHaveAttribute('width', '640');
    await expect(canvas).toHaveAttribute('height', '360');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);
    expect(bounds!.width).toBeLessThanOrEqual(size.width + 1);
    expect(bounds!.height).toBeLessThanOrEqual(size.height + 1);
    // Mobile fit must include the whole arena, not just a nonzero canvas size.
    if (size.name === 'mobile') {
      expect(bounds!.x, 'Mobile playfield must start inside the viewport').toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, 'Mobile playfield must fit horizontally').toBeLessThanOrEqual(size.width + 1);
      expect(bounds!.y, 'Mobile playfield must start inside the viewport').toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height, 'Mobile playfield must fit vertically').toBeLessThanOrEqual(size.height + 1);
    }
    // A visible canvas may still be clipped below the viewport by page chrome.
    // At the native viewport the entire playfield must be visible without scrolling.
    if (size.name === 'native') {
      expect(bounds!.y, 'Native playfield must not start above the viewport').toBeGreaterThanOrEqual(0);
      expect(
        bounds!.y + bounds!.height,
        'Native playfield bottom must fit in the browser viewport',
      ).toBeLessThanOrEqual(size.height + 1);
    }
    if (size.name === 'mobile') {
      // Confirm the full logical playfield is actually inside the visible window.
      // The CSS bounds assertions above catch overflow; this checks both axes
      // against the viewport after layout has settled.
      await expect.poll(async () => canvas.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 &&
          rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1;
      })).toBe(true);
    }
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({
      path: `artifacts/visual/vis-05-arena-${size.name}.png`,
      fullPage: true,
    });
  });
}

for (const size of [
  { name: '1280', width: 1280, height: 720 },
  { name: '1920', width: 1920, height: 1080 },
]) {
  test(`VIS-05 integer 2x mode at ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size.name === '1280' ? { width: 640, height: 720 } : { width: size.width, height: size.height });
    await enterLocalGame(page, '/?scale=2');
    if (size.name === '1280') await page.setViewportSize({ width: size.width, height: size.height });
    await expect(page).toHaveURL(/scale=2/);
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('width', '640');
    await expect(canvas).toHaveAttribute('height', '360');
    await expect.poll(() => canvas.evaluate(element => {
      const elementCanvas = element as HTMLCanvasElement;
      const rect = elementCanvas.getBoundingClientRect();
      return rect.width / elementCanvas.width === 2 && rect.height / elementCanvas.height === 2;
    })).toBe(true);
    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector('#game canvas')!;
      const rect = canvas.getBoundingClientRect();
      const hud = document.querySelector('#fight-hud')!.getBoundingClientRect();
      return {
        canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        hudBottom: hud.bottom,
        scoreboardBottom: rect.top + rect.height * 35 / 216,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      };
    });
    expect(metrics.canvas.width).toBe(1280);
    expect(metrics.canvas.height).toBe(720);
    expect(metrics.canvas.x).toBe((size.width - 1280) / 2);
    expect(metrics.canvas.y).toBe((size.height - 720) / 2);
    expect(metrics.hudBottom, 'External HUD stays inside the reserved scoreboard band').toBeLessThanOrEqual(metrics.scoreboardBottom + 1);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 1);
    await expect(page.locator('#display-scale')).toHaveValue('2');
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/vis-05-integer-2x-${size.name}.png`, fullPage: true });
  });
}

test('VIS-05 2x preference falls back cleanly on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await enterLocalGame(page, '/?scale=2');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const layout = await page.evaluate(() => {
    const c = document.querySelector('#game canvas') as HTMLCanvasElement;
    const canvasRect = c.getBoundingClientRect();
    const hudRect = document.querySelector('#fight-hud')!.getBoundingClientRect();
    const fontSize = Number.parseFloat(getComputedStyle(document.querySelector('.hud-player')!).fontSize);
    return { scale: canvasRect.width / c.width, canvasBottom: canvasRect.bottom, hudBottom: hudRect.bottom,
      scoreboardBottom: canvasRect.top + canvasRect.height * 35 / 216,
      scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight, fontSize };
  });
  expect(layout.scale).toBeLessThan(2);
  expect(layout.scale).toBeGreaterThan(0);
  expect(layout.canvasBottom).toBeLessThanOrEqual(361);
  expect(layout.hudBottom).toBeLessThanOrEqual(layout.scoreboardBottom + 1);
  expect(layout.fontSize).toBeGreaterThanOrEqual(14);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);
});

test('VIS-05 2x preference has no scroll at 1280x680', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await enterLocalGame(page, '/?scale=2');
  await page.setViewportSize({ width: 1280, height: 680 });
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const layout = await page.evaluate(() => {
    const rect = document.querySelector('#game canvas')!.getBoundingClientRect();
    return { documentHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight,
      canvasTop: rect.top, canvasBottom: rect.bottom, canvasWidth: rect.width };
  });
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.canvasTop).toBeGreaterThanOrEqual(0);
  expect(layout.canvasBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.canvasWidth).toBeLessThanOrEqual(1280);
  mkdirSync('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/vis-05-stale-2x-1280x680.png', fullPage: true });
});

test('scale control is hidden only below the short-height cutoff and remains reachable elsewhere', async ({ page }) => {
  const scaleControl = page.locator('.scale-control');

  await page.setViewportSize({ width: 1280, height: 720 });
  await enterLocalGame(page, '/');
  await page.setViewportSize({ width: 640, height: 540 });
  await expect(scaleControl).toBeHidden();

  await page.setViewportSize({ width: 640, height: 541 });
  await expect(scaleControl).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 680 });
  await expect(scaleControl).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(scaleControl).toBeVisible();
  await page.locator('#display-scale').selectOption('2');
  await expect(page).toHaveURL(/scale=2/);
  // Scale selection reloads into the title screen; re-enter LOCAL before inspecting resized layout.
  await enterLocalGame(page, '/?scale=2');

  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(scaleControl).toBeVisible();
  await expect(page.locator('#display-scale')).toHaveValue('2');
});

test('VIS-05 native short-viewport lobby status is fully readable', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await enterLocalGame(page, '/');
  const status = page.locator('#match-status');
  await expect.poll(() => status.textContent()).toBe('SHIFT/PAD JOIN · START');
  const metrics = await page.evaluate(() => {
    const text = document.querySelector('#match-status')!;
    const canvas = document.querySelector('#game canvas')!.getBoundingClientRect();
    const hud = document.querySelector('#fight-hud')!.getBoundingClientRect();
    return { scrollWidth: text.scrollWidth, clientWidth: text.clientWidth, fullStatus: text.getAttribute('aria-label'),
      hudBottom: hud.bottom, scoreboardBottom: canvas.top + canvas.height * 35 / 216,
      fontSize: Number.parseFloat(getComputedStyle(text).fontSize) };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.fullStatus).toContain('P5–P8 GAMEPAD OR BOT');
  expect(metrics.fontSize).toBeGreaterThanOrEqual(14);
  expect(metrics.hudBottom).toBeLessThanOrEqual(metrics.scoreboardBottom + 1);
  await expect(page.locator('[data-player="P1"] .hud-score')).toHaveText('0');
  mkdirSync('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/vis-05-status-native.png', fullPage: true });
});

for (const size of [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`VIS-05 external HUD stays readable at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await enterLocalGame(page, '/');
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    const hud = page.locator('#fight-hud');
    await expect(hud).toBeVisible();
    const fontSizes = await page.locator('#match-timer, #match-status, .hud-player, .hud-name, .hud-score, .hud-health, .hud-slot-action, .scale-control select').evaluateAll(elements =>
      elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
    expect(fontSizes.length).toBeGreaterThan(0);
    expect(Math.min(...fontSizes), 'HUD text must not be scaled below 14 CSS px').toBeGreaterThanOrEqual(14);
    const statusOverflow = await page.locator('#match-status').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(statusOverflow, 'HUD instructions remain fully visible').toBeLessThanOrEqual(1);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('#game canvas')!.getBoundingClientRect();
      const hud = document.querySelector('#fight-hud')!.getBoundingClientRect();
      return { canvas: { top: canvas.top, bottom: canvas.bottom }, hud: { top: hud.top, bottom: hud.bottom }, scrollHeight: document.documentElement.scrollHeight };
    });
    if (size.name === 'mobile') {
      expect(layout.hud.bottom).toBeLessThanOrEqual(layout.canvas.top);
      expect(layout.canvas.bottom).toBeLessThanOrEqual(size.height + 1);
    } else {
      expect(layout.hud.bottom).toBeLessThanOrEqual(layout.canvas.top + (layout.canvas.bottom - layout.canvas.top) * 35 / 216 + 1);
    }
    expect(await page.locator('.hud-player').count()).toBe(8);
  });
}

for (const size of [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`VIS-05 full eight-player status is visible at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await enterLocalGame(page, '/');
    await page.locator('#game canvas').waitFor({ state: 'visible' });
    const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const state = createState({ ids, phase: 'fighting', mode: 'score-brawl' });
    state.fighters.forEach(fighter => { fighter.koTimer = 30; });
    await page.evaluate(state => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.selectedMode = 'score-brawl';
      scene.botSlots = new Set(state.fighters.slice(1).map((fighter: { id: string }) => fighter.id));
      scene.state = state;
      scene.drawFighters();
      if (scene.sys.isActive()) scene.sys.pause();
    }, state);
    const status = page.locator('#match-status');
    await expect(status).toContainText('P8 KO');
    const metrics = await page.evaluate(() => {
      const status = document.querySelector<HTMLElement>('#match-status')!;
      const canvas = document.querySelector('#game canvas')!.getBoundingClientRect();
      const hud = document.querySelector('#fight-hud')!.getBoundingClientRect();
      return {
        text: status.textContent,
        fullText: status.getAttribute('aria-label'),
        clientWidth: status.clientWidth,
        scrollWidth: status.scrollWidth,
        clientHeight: status.clientHeight,
        scrollHeight: status.scrollHeight,
        fontSize: Number.parseFloat(getComputedStyle(status).fontSize),
        hudBottom: hud.bottom,
        canvasTop: canvas.top,
        scoreboardBottom: canvas.top + canvas.height * 35 / 216,
      };
    });
    console.log(`VIS-05 status ${size.name}: ${JSON.stringify(metrics)}`);
    expect(metrics.text).toBe(metrics.fullText);
    expect(metrics.scrollWidth, 'Status must not be clipped horizontally').toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.scrollHeight, 'Status must not be clipped vertically').toBeLessThanOrEqual(metrics.clientHeight);
    expect(metrics.fontSize).toBeGreaterThanOrEqual(14);
    if (size.name === 'mobile') {
      expect(metrics.hudBottom, 'Mobile HUD remains above the combat plane').toBeLessThanOrEqual(metrics.canvasTop);
    } else {
      expect(metrics.hudBottom, 'Desktop HUD remains inside the reserved scoreboard band').toBeLessThanOrEqual(metrics.scoreboardBottom + 1);
    }
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/vis-05-status-${size.name}.png`, fullPage: true });
  });
}

for (const size of [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`VIS-05 four-player HUD and fighter distinction at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await enterLocalGame(page, '/');
    const fixture = createState(['P1', 'P2', 'P3', 'P4'], 'lobby');
    await page.evaluate(state => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.state = state;
    }, fixture);
    await expect.poll(() => page.locator('.hud-player').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label'))))
      .toEqual(['P1, score 0, health 100', 'P2, score 0, health 100', 'P3, score 0, health 100', 'P4, score 0, health 100',
        'P5, not joined', 'P6, not joined', 'P7, not joined', 'P8, not joined']);
    const fighters = await page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return [...scene.fighterSprites.entries()].map(([id, sprite]: [string, { texture: { key: string } }]) => ({ id, texture: sprite.texture.key }));
    });
    expect(fighters).toHaveLength(4);
    for (const id of ['P1', 'P2', 'P3', 'P4']) expect(fighters.find(fighter => fighter.id === id)?.texture).toContain(`fighter-${id}-`);
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/vis-05-four-fighters-${size.name}.png`, fullPage: true });
  });
}

