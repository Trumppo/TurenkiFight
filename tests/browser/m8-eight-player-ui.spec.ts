import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { contrastRatio, FIGHTER_MARKER_CONTRAST_THRESHOLD, FIGHTER_MARKER_FACE, FIGHTER_MARKER_FLOORS, FIGHTER_MARKER_OUTLINE } from '../../src/game/presentation/fighterMarker';

const ids = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);

async function addBots(page: import('@playwright/test').Page): Promise<void> {
  for (const id of ids.slice(1)) await page.locator(`[data-player="${id}"] .hud-slot-action`).click();
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.fighters.map((fighter: { id: string }) => fighter.id)))
    .toEqual(ids);
}

async function setPresentationState(page: import('@playwright/test').Page, mode: string, phase: 'fighting' | 'results'): Promise<void> {
  await page.evaluate(async ({ mode, phase, ids }) => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const sim = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = mode;
    scene.botSlots = new Set(ids.slice(1));
    const state = sim.createState({ ids, phase, mode });
    state.fighters.forEach((fighter: any, index: number) => {
      fighter.score = (8 - index) * 250;
      fighter.frags = 8 - index;
      fighter.deaths = index;
      fighter.eliminated = mode === 'last-man-standing' && index > 0;
    });
    if (phase === 'results') state.events = [{ tick: 7200, type: 'MatchEnded', reason: mode === 'deathmatch' ? 'frag-limit' : 'time', winner: 'P1' }];
    scene.state = state;
    scene.drawFighters();
    if (scene.sys.isActive()) scene.sys.pause();
  }, { mode, phase, ids });
}

test('lobby offers bot add/remove in every non-host slot through eight', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('[data-player="P2"] .hud-name')).toHaveText('P2 KEY/PAD');
  await expect(page.locator('[data-player="P5"] .hud-name')).toHaveText('P5 PAD/BOT');
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /P5–P8 GAMEPAD OR BOT/);
  await addBots(page);

  for (const id of ids.slice(1)) {
    const card = page.locator(`[data-player="${id}"]`);
    await expect(card).toHaveClass(/is-bot/);
    await expect(card).toHaveAttribute('data-bot', 'true');
    await expect.poll(() => card.locator('.hud-name').evaluate(element => getComputedStyle(element, '::after').content)).toBe('"BOT"');
    await expect(card.locator('.hud-slot-action')).toHaveText('−BOT');
  }

  await page.locator('[data-player="P8"] .hud-slot-action').click();
  await expect(page.locator('[data-player="P8"]')).toHaveClass(/is-empty/);
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.fighters.length)).toBe(7);
  expect(await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').fighterSprites.has('P8'))).toBe(false);
  await page.locator('[data-player="P8"] .hud-slot-action').click();
  await expect(page.locator('[data-player="P8"]')).toHaveAttribute('data-bot', 'true');
});

test('unassigned gamepads can explicitly join non-host slots through P8', async ({ page }) => {
  await page.addInitScript(() => {
    const pads = Array.from({ length: 7 }, (_, index) => ({
      index, connected: true, id: `Test gamepad ${index + 1}`, mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    (window as any).__testPads = pads;
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(() => {
    for (const pad of (window as any).__testPads) pad.buttons[8].pressed = true;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.fighters.map((fighter: { id: string }) => fighter.id)))
    .toEqual(ids);
  await page.evaluate(() => {
    for (const pad of (window as any).__testPads) pad.buttons[8].pressed = false;
  });
  const assignments = await page.evaluate(() => Array.from((window as any).__turenkiGame.scene.getScene('StationScene').gamepadSlots.values()));
  expect(assignments).toEqual(ids.slice(1));
  for (const id of ids.slice(4)) {
    const card = page.locator(`[data-player="${id}"]`);
    await expect(card).not.toHaveClass(/is-empty|is-bot/);
    const playerNumber = Number(id.slice(1));
    await expect(card.locator('.hud-name')).toHaveText(`${id} PAD ${playerNumber - 2}`);
  }
});

test('eight HUD cards show each mode field and the eight-player results roster', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const fields = [
    { mode: 'score-brawl', expected: (index: number) => ({ score: `${(8 - index) * 250}`, health: 'H100' }) },
    { mode: 'last-man-standing', expected: (index: number) => ({ score: index ? 'S0' : 'S1', health: index ? 'OUT' : 'ALIVE' }) },
    { mode: 'deathmatch', expected: (index: number) => ({ score: `F${8 - index}`, health: `D${index}` }) },
  ];
  for (const field of fields) {
    await setPresentationState(page, field.mode, 'fighting');
    await expect(page.locator('.hud-player')).toHaveCount(8);
    for (let index = 0; index < ids.length; index++) {
      const card = page.locator(`[data-player="${ids[index]}"]`);
      await expect(card.locator('.hud-score')).toHaveText(field.expected(index).score);
      await expect(card.locator('.hud-health')).toHaveText(field.expected(index).health);
      if (index) await expect(card).toHaveAttribute('data-bot', 'true');
      else await expect(card).not.toHaveAttribute('data-bot');
    }
  }

  for (const mode of ['score-brawl', 'last-man-standing', 'deathmatch']) {
    await setPresentationState(page, mode, 'results');
    const status = page.locator('#match-status');
    await expect(status).toContainText('WINNER: P1');
    await expect(status).toContainText(mode === 'deathmatch' ? 'REASON: frag-limit' : 'REASON: time');
    const fullResults = await status.getAttribute('aria-label');
    for (const id of ids) expect(fullResults).toContain(id);
    await expect(page.locator('.hud-player')).toHaveCount(8);
  }
});

const viewports = [
  { name: '640x360', width: 640, height: 360 },
  { name: '1280x720', width: 1280, height: 720 },
];
const visualStyle = 'retro';

for (const viewport of viewports) {
  test(`M8 eight-fighter arena readability evidence at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    await addBots(page);
    await page.keyboard.down('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.phase)).toBe('countdown');
    await page.keyboard.up('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.phase), { timeout: 8000 }).toBe('fighting');
    await page.waitForTimeout(900);

    const layout = await page.evaluate(() => {
      const canvasElement = document.querySelector('#game canvas') as HTMLCanvasElement;
      const canvas = canvasElement.getBoundingClientRect();
      const hud = document.querySelector('#fight-hud')!.getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.hud-player'));
      const fontSizes = Array.from(document.querySelectorAll<HTMLElement>('#match-timer, #match-status, .hud-player, .hud-name, .hud-score, .hud-health, .hud-slot-action, .mode-control select'))
        .map(element => Number.parseFloat(getComputedStyle(element).fontSize));
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return {
        canvas: { x: canvas.x, y: canvas.y, right: canvas.right, bottom: canvas.bottom, width: canvas.width, height: canvas.height,
          backingWidth: canvasElement.width, backingHeight: canvasElement.height },
        hud: { top: hud.top, bottom: hud.bottom },
        fontSizes,
        cardCount: cards.length,
        bots: cards.slice(1).every(card => card.dataset.bot === 'true' && card.classList.contains('is-bot')),
        fieldOverflow: cards.flatMap(card => Array.from(card.querySelectorAll<HTMLElement>('.hud-name, .hud-score, .hud-health'))
          .filter(element => element.scrollWidth > element.clientWidth + 1)
          .map(element => `${card.dataset.player}.${element.className}`)),
        fighters: [...scene.fighterSprites.entries()].map(([id, sprite]: [string, { texture: { key: string } }]) => ({ id, texture: sprite.texture.key })),
        markers: scene.debugPlayerMarkers(),
        markerCssTextSizes: scene.debugPlayerMarkers().map((marker: { fontSize: number }) =>
          marker.fontSize * scene.cameras.main.zoom * canvas.width / canvasElement.width),
        phase: scene.state.phase,
      };
    });
    expect(layout.phase).toBe('fighting');
    expect(layout.cardCount).toBe(8);
    expect(layout.bots).toBe(true);
    expect(layout.fieldOverflow).toEqual([]);
    expect(layout.fighters).toHaveLength(8);
    expect(new Set(layout.fighters.map(fighter => fighter.texture.split('-').slice(0, 2).join('-'))).size).toBe(8);
    expect(layout.markers.map((marker: { id: string }) => marker.id)).toEqual(ids);
    expect(layout.markers.map((marker: { label: string }) => marker.label)).toEqual(ids);
    expect(layout.markers.every((marker: { visible: boolean }) => marker.visible)).toBe(true);
    expect(layout.markerCssTextSizes.every((size: number) => size >= 12), `marker text CSS px: ${layout.markerCssTextSizes.join(', ')}`).toBe(true);
    for (const [arenaStyle, floor] of Object.entries(FIGHTER_MARKER_FLOORS)) {
      expect(contrastRatio(FIGHTER_MARKER_FACE, floor), `${arenaStyle} marker face`).toBeGreaterThanOrEqual(FIGHTER_MARKER_CONTRAST_THRESHOLD);
      expect(contrastRatio(FIGHTER_MARKER_OUTLINE, floor), `${arenaStyle} marker outline`).toBeGreaterThanOrEqual(FIGHTER_MARKER_CONTRAST_THRESHOLD);
    }
    expect(layout.canvas.backingWidth).toBe(640);
    expect(layout.canvas.backingHeight).toBe(360);
    expect(Math.min(...layout.fontSizes)).toBeGreaterThanOrEqual(14);
    const scoreboardBottom = layout.canvas.y + layout.canvas.height * 35 / 216;
    expect(layout.hud.bottom).toBeLessThanOrEqual(scoreboardBottom + 1);
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({ path: `artifacts/visual/g2-eight-fighters-${visualStyle}-${viewport.name}.png` });
    await page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.state.fighters[0].koTimer = 24;
      scene.drawFighters();
    });
    expect(await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene')
      .debugPlayerMarkers().every((marker: { visible: boolean }) => marker.visible)), 'markers remain visible through knockdown').toBe(true);
  });
}
