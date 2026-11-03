import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const modes = [
  { id: 'score-brawl', name: 'Score Brawl' },
  { id: 'last-man-standing', name: 'Last Man Standing' },
  { id: 'deathmatch', name: 'Deathmatch' },
] as const;

test('mode selection is part of local match creation and preserves the join flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const mode = page.locator('#game-mode');
  await expect(mode).toHaveValue('score-brawl');
  for (const choice of modes) {
    await mode.selectOption(choice.id);
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return { mode: scene.state.mode ?? 'score-brawl', phase: scene.state.phase };
    })).toEqual({ mode: choice.id, phase: 'lobby' });
  }
  await mode.selectOption('deathmatch');
  mkdirSync('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/m7-mode-selection-lobby.png', fullPage: true });
  await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.fighters.length)).toBe(2);
  await page.keyboard.up('Shift');
  await page.keyboard.down('Enter');
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__turenkiGame.scene.getScene('StationScene').state;
    return { phase: state.phase, mode: state.mode, players: state.fighters.length };
  })).toEqual({ phase: 'countdown', mode: 'deathmatch', players: 2 });
  await expect(mode).toBeDisabled();
  expect(await page.locator('.hud-player').count()).toBe(8);
});

test('Last Man Standing HUD shows stocks and a visibly eliminated fighter', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = 'last-man-standing';
    const state = simulation.createState({ ids: ['P1', 'P2', 'P3', 'P4'], phase: 'fighting', mode: 'last-man-standing' });
    state.fighters[1].eliminated = true;
    state.fighters[1].health = 0;
    scene.state = state;
    scene.drawFighters();
  });
  await expect(page.locator('[data-player="P1"] .hud-score')).toHaveText('S1');
  await expect(page.locator('[data-player="P1"] .hud-score')).toHaveAttribute('title', 'STOCK 1');
  await expect(page.locator('[data-player="P1"] .hud-health')).toHaveText('ALIVE');
  await expect(page.locator('[data-player="P2"] .hud-score')).toHaveText('S0');
  await expect(page.locator('[data-player="P2"] .hud-score')).toHaveAttribute('title', 'STOCK 0');
  await expect(page.locator('[data-player="P2"] .hud-health')).toHaveText('OUT');
  await expect(page.locator('[data-player="P2"] .hud-health')).toHaveAttribute('title', 'ELIMINATED');
  await expect(page.locator('[data-player="P2"]')).toHaveClass(/is-eliminated/);
  const outVisual = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const fighter = scene.state.fighters.find((f: { id: string }) => f.id === 'P2');
    const sprite = scene.fighterSprites.get('P2');
    return { eliminated: fighter.eliminated, pose: scene.pose(fighter), alpha: sprite.alpha, tintFill: sprite.tintFill,
      markerVisible: scene.koMarkers.get('P2').visible, texture: sprite.texture.key };
  });
  expect(outVisual).toMatchObject({ eliminated: true, pose: 'ko', alpha: 0.92, tintFill: false, markerVisible: true });
  expect(outVisual.texture).toContain('fighter-P2-ko-');
  await expect(page.locator('[data-player="P2"]')).toHaveAttribute('aria-label', 'P2, stock 0, eliminated');
  const desktopFonts = await page.locator('#match-timer, #match-status, .hud-player, .hud-name, .hud-score, .hud-health, .mode-control select').evaluateAll(elements =>
    elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(Math.min(...desktopFonts)).toBeGreaterThanOrEqual(14);
  mkdirSync('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/m7-last-man-standing-hud.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFonts = await page.locator('#match-timer, #match-status, .hud-player, .hud-name, .hud-score, .hud-health, .mode-control select').evaluateAll(elements =>
    elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(Math.min(...mobileFonts)).toBeGreaterThanOrEqual(14);
  await page.screenshot({ path: 'artifacts/visual/m7-last-man-standing-mobile.png', fullPage: true });
});

test('Deathmatch HUD shows frags and deaths instead of score', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = 'deathmatch';
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
    state.fighters[0].frags = 3;
    state.fighters[0].deaths = 1;
    scene.state = state;
    scene.drawFighters();
  });
  await expect(page.locator('[data-player="P1"] .hud-score')).toHaveText('F3');
  await expect(page.locator('[data-player="P1"] .hud-health')).toHaveText('D1');
  await expect(page.locator('[data-player="P1"] .hud-score')).toHaveAttribute('title', 'FRAGS 3');
  await expect(page.locator('[data-player="P1"] .hud-health')).toHaveAttribute('title', 'DEATHS 1');
  await expect(page.locator('[data-player="P1"]')).toHaveAttribute('aria-label', /3 frags, 1 deaths/);
});

test('results name winners and reasons for every mode and show draws', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const setResult = async (mode: string, reason: string, winner: string | null) => {
    await page.evaluate(async ({ mode, reason, winner }) => {
      const moduleUrl = '/src/game/simulation/step.ts';
      const simulation = await import(/* @vite-ignore */ moduleUrl);
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.selectedMode = mode;
      const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'results', mode });
      state.fighters[0].score = 500;
      state.fighters[1].score = 100;
      state.fighters[0].frags = mode === 'deathmatch' ? 20 : 0;
      state.fighters[0].deaths = 1;
      state.fighters[1].deaths = 2;
      if (mode === 'last-man-standing') state.fighters[1].eliminated = true;
      state.events = [{ tick: 7200, type: 'MatchEnded', reason, winner }];
      scene.state = state;
      scene.drawFighters();
    }, { mode, reason, winner });
    return page.locator('#match-status').textContent();
  };

  const score = await setResult('score-brawl', 'time', 'P1');
  expect(score).toContain('WINNER: P1');
  expect(score).toContain('REASON: time');
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /#1 P1: 500/);
  mkdirSync('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/m7-score-brawl-results.png', fullPage: true });
  const lastMan = await setResult('last-man-standing', 'elimination', 'P1');
  expect(lastMan).toContain('WINNER: P1');
  expect(lastMan).toContain('REASON: elimination');
  expect(await page.locator('#match-status').getAttribute('aria-label')).toContain('P2 OUT');
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /REASON: elimination/);
  await page.screenshot({ path: 'artifacts/visual/m7-last-man-standing-results.png', fullPage: true });
  const deathmatch = await setResult('deathmatch', 'frag-limit', 'P1');
  expect(deathmatch).toContain('WINNER: P1');
  expect(deathmatch).toContain('REASON: frag-limit');
  expect(await page.locator('#match-status').getAttribute('aria-label')).toContain('P1 20F/1D');
  await page.screenshot({ path: 'artifacts/visual/m7-deathmatch-results.png', fullPage: true });
  const draw = await setResult('deathmatch', 'time', null);
  expect(draw).toContain('DRAW');
  expect(draw).toContain('REASON: time');
});

test('online HUD states the server default and honors a mode in a received snapshot', async ({ page }) => {
  await page.goto('/online.html');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#match-mode')).toHaveText('ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)');
  const onlineHud = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const api = (window as any).__turenkiOnline;
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
    state.fighters[0].frags = 2;
    state.fighters[0].deaths = 1;
    api.renderHudSnapshotForTest(state);
    const reported = {
      mode: document.querySelector('#match-mode')?.textContent,
      frags: document.querySelector('[data-player="P1"] .hud-score')?.textContent,
      deaths: document.querySelector('[data-player="P1"] .hud-health')?.textContent,
    };
    api.renderHudSnapshotForTest(null);
    return { ...reported, afterNullSnapshot: document.querySelector('#match-mode')?.textContent };
  });
  expect(onlineHud).toEqual({ mode: 'ONLINE MODE · DEATHMATCH', frags: 'FRAGS 2', deaths: 'DEATHS 1',
    afterNullSnapshot: 'ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)' });
});
