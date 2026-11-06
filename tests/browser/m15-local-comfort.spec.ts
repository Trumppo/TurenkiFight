import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('four local humans occupy keyboard and paired pads; local pause freezes and resumes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    const pads = [0, 1].map(index => ({
      index, connected: true, id: `Turenki QA pad ${index}`, mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => pads.map(pad => pad.connected ? pad : null),
    });
    (window as typeof window & { __m15Pads?: typeof pads }).__m15Pads = pads;
  });
  await page.goto('/?scale=2');
  await expect(page.locator('#game canvas')).toHaveAttribute('width', '640');
  await expect(page.locator('#game canvas')).toHaveAttribute('height', '360');

  // P1 is keyboard host; P2 explicitly joins by keyboard; pads join P3/P4.
  await page.keyboard.down('Shift');
  await expect(page.locator('.hud-player[data-player="P2"] .hud-name')).toHaveText('P2 KEYBOARD');
  await page.keyboard.up('Shift');
  await page.evaluate(() => {
    for (const pad of (window as any).__m15Pads) pad.buttons[8].pressed = true;
  });
  await expect(page.locator('.hud-player[data-player="P3"] .hud-name')).toHaveText('P3 PAD 0');
  await expect(page.locator('.hud-player[data-player="P4"] .hud-name')).toHaveText('P4 PAD 1');
  await expect(page.locator('#match-status')).toContainText('PAD 0 → P3');
  await expect(page.locator('#match-status')).toContainText('PAD 1 → P4');
  await page.evaluate(() => {
    for (const pad of (window as any).__m15Pads) pad.buttons[8].pressed = false;
  });
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /LOBBY/);
  await expect(page.locator('#player-hud .hud-player')).toHaveCount(8);
  await expect(page.locator('#player-hud .hud-player.is-empty')).toHaveCount(4);

  const screenshots = path.resolve('artifacts/screenshots');
  await mkdir(screenshots, { recursive: true });
  const style = await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').arenaSelection.style as string);
  await page.screenshot({ path: path.join(screenshots, `m15-four-player-lobby-${style}.png`) });
  const desktopReadability = await page.locator('.hud-player[data-player="P3"] .hud-name').evaluate(node => ({
    fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(desktopReadability.fontSize).toBeGreaterThanOrEqual(14);
  expect(desktopReadability.scrollWidth).toBeLessThanOrEqual(desktopReadability.clientWidth);
  await page.setViewportSize({ width: 640, height: 360 });
  const compactReadability = await page.locator('.hud-player[data-player="P3"] .hud-name').evaluate(node => ({
    fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(compactReadability.fontSize).toBeGreaterThanOrEqual(14);
  expect(compactReadability.scrollWidth).toBeLessThanOrEqual(compactReadability.clientWidth);
  await page.setViewportSize({ width: 1280, height: 720 });

  const scene = () => page.evaluate(() => {
    const value = (window as any).__turenkiGame.scene.getScene('StationScene');
    return {
      phase: value.state.phase as string,
      tick: value.state.tick as number,
      slots: [...value.gamepadSlots.entries()] as [number, string][],
    };
  });
  expect((await scene()).slots).toEqual([[0, 'P3'], [1, 'P4']]);

  await page.locator('#start-match').click();
  await expect.poll(async () => (await scene()).phase).toBe('fighting');
  await page.locator('#pause-match').click();
  await expect(page.locator('#pause-match')).toHaveText('RESUME');
  await expect(page.locator('#match-status')).toContainText('PAUSED');
  const frozen = await scene();
  await page.waitForTimeout(200);
  expect(await scene()).toEqual(frozen);
  await page.screenshot({ path: path.join(screenshots, `m15-paused-${style}.png`) });

  await page.keyboard.press('p');
  await expect(page.locator('#pause-match')).toHaveText('PAUSE');
  await expect.poll(async () => (await scene()).tick).toBeGreaterThan(frozen.tick);
  await page.keyboard.press('p');
  await expect(page.locator('#pause-match')).toHaveText('RESUME');
  const keyboardFrozen = await scene();
  await page.waitForTimeout(150);
  expect(await scene()).toEqual(keyboardFrozen);
  await page.locator('#pause-match').click();
  await expect.poll(async () => (await scene()).tick).toBeGreaterThan(keyboardFrozen.tick);

  const result = await page.evaluate(async () => {
    const current = (window as any).__turenkiGame.scene.getScene('StationScene');
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    let state = simulation.createState(['P1', 'P2', 'P3', 'P4'], 'countdown');
    for (let i = 0; i < simulation.COUNTDOWN_TICKS + simulation.MATCH_TICKS; i++) {
      state = simulation.step(state, []);
    }
    current.state = state;
    current.drawFighters();
    return state.phase;
  });
  expect(result).toBe('results');
  await expect(page.locator('#pause-match')).toBeDisabled();
});
