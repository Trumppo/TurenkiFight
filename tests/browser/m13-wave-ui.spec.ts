import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test('Wave selection shows the human-plus-bot lobby rule and passes explicit teams to match creation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const mode = page.locator('#game-mode');
  await expect(mode.locator('option[value="wave"]')).toHaveText('Wave (Asemahalli)');
  await mode.selectOption('wave');

  await expect(page.locator('#match-status')).toContainText('WAVE NEEDS HUMAN + BOT');
  await expect(page.locator('#start-match')).toBeDisabled();
  await expect(page.locator('#all-bots-match')).toBeDisabled();
  // O is likewise unavailable for Wave: the first slice needs a human-controlled ally.
  await page.keyboard.press('o');
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.phase)).toBe('lobby');

  await page.locator('[data-player="P2"] .hud-slot-action').click();
  await expect(page.locator('[data-player="P2"] .hud-name')).toHaveText('P2 ENEMY');
  await expect(page.locator('#start-match')).toBeEnabled();
  const lobbyTeams = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return { mode: scene.state.mode, teams: scene.state.fighters.map((fighter: any) => [fighter.id, fighter.team]) };
  });
  expect(lobbyTeams).toEqual({ mode: 'wave', teams: [['P1', 'players'], ['P2', 'enemies']] });

  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return { phase: scene.state.phase, mode: scene.state.mode, teams: scene.state.fighters.map((fighter: any) => fighter.team) };
  })).toEqual({ phase: 'countdown', mode: 'wave', teams: ['players', 'enemies'] });
});

test('Wave HUD derives counter, enemy count and inter-wave countdown from state', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const rendered = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const sim = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.update = () => {};
    scene.selectedMode = 'wave';
    scene.botSlots = new Set(['P3', 'P4']);
    const state = sim.createState({
      ids: ['P1', 'P2', 'P3', 'P4'], phase: 'fighting', mode: 'wave',
      teams: { P1: 'players', P2: 'players', P3: 'enemies', P4: 'enemies' },
    });
    state.wave = { index: 1, countdownTicks: 90, remaining: 2 };
    scene.state = state;
    scene.drawFighters();
    scene.scene.pause();
    return {
      wave: document.querySelector('#wave-number')?.textContent,
      enemies: document.querySelector('#wave-enemies')?.textContent,
      countdown: document.querySelector('#wave-countdown')?.textContent,
      countdownHidden: (document.querySelector('#wave-countdown') as HTMLElement).hidden,
      label: document.querySelector('#wave-status')?.getAttribute('aria-label'),
    };
  });
  expect(rendered).toEqual({ wave: 'WAVE 2/3', enemies: 'ENEMIES 2', countdown: 'NEXT WAVE IN 2', countdownHidden: false,
    label: 'Wave 2 of 3, 2 enemies remaining, next wave in 2 seconds' });
  const fontsAndOverflow = await page.locator('#wave-status, #wave-status *').evaluateAll(elements => elements.map(element => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    overflow: getComputedStyle(element).textOverflow,
  })));
  expect(Math.min(...fontsAndOverflow.map(item => item.fontSize))).toBeGreaterThanOrEqual(14);
  expect(fontsAndOverflow.every(item => item.overflow !== 'ellipsis')).toBe(true);

  const clearedCountdown = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.wave.countdownTicks = 0;
    scene.drawFighters();
    return (document.querySelector('#wave-countdown') as HTMLElement).hidden;
  });
  expect(clearedCountdown).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileHud = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.wave.countdownTicks = 90;
    scene.drawFighters();
    const hud = document.querySelector('#wave-status') as HTMLElement;
    return {
      text: hud.textContent,
      fontSize: Number.parseFloat(getComputedStyle(hud).fontSize),
      overflow: getComputedStyle(hud).textOverflow,
      width: hud.clientWidth,
      scrollWidth: hud.scrollWidth,
      countdownHidden: (document.querySelector('#wave-countdown') as HTMLElement).hidden,
    };
  });
  expect(mobileHud.text).toContain('NEXT WAVE IN 2');
  expect(mobileHud.fontSize).toBeGreaterThanOrEqual(14);
  expect(mobileHud.overflow).not.toBe('ellipsis');
  expect(mobileHud.scrollWidth).toBeLessThanOrEqual(mobileHud.width);
  expect(mobileHud.countdownHidden).toBe(false);
});

test('Wave results show score ranking and the waves-cleared end reason', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const sim = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = 'wave';
    scene.botSlots = new Set(['P2']);
    const state = sim.createState({ ids: ['P1', 'P2'], phase: 'results', mode: 'wave', teams: { P1: 'players', P2: 'enemies' } });
    state.fighters[0].score = 120;
    state.fighters[1].score = 20;
    state.events = [{ tick: 7200, type: 'MatchEnded', reason: 'waves-cleared', winner: 'P1' }];
    scene.state = state;
    scene.matchEvents = [...state.events];
    scene.resultPresentationReady = false;
    scene.lastResult = undefined;
    scene.drawFighters();
    scene.update(0, 0);
  });
  await expect(page.locator('#match-status')).toContainText('WINNER: P1');
  await expect(page.locator('#match-status')).toContainText('REASON: WAVES CLEARED');
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /#1 P1: 120/);
  await expect(page.locator('#victory-title')).toHaveText('P1');
  await expect(page.locator('#victory-podium')).toContainText('P2');
  await expect(page.locator('#victory-podium')).toContainText('20 SCORE');
});

test('classic and retro Wave HUD visual proof at 640x360 and 1280x720', async ({ page }, testInfo) => {
  const style = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';
  const screenshotDir = join(process.cwd(), 'artifacts', 'visual');
  mkdirSync(screenshotDir, { recursive: true });
  const prepareWaveSnapshot = async () => {
    const rendered = await page.evaluate(async () => {
      const moduleUrl = '/src/game/simulation/step.ts';
      const sim = await import(/* @vite-ignore */ moduleUrl);
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.selectedMode = 'wave';
      scene.botSlots = new Set(['P3', 'P4']);
      const state = sim.createState({
        ids: ['P1', 'P2', 'P3', 'P4'], phase: 'fighting', mode: 'wave',
        teams: { P1: 'players', P2: 'players', P3: 'enemies', P4: 'enemies' },
      });
      state.wave = { index: 1, countdownTicks: 90, remaining: 2 };
      for (const fighter of state.fighters) {
        fighter.eliminated = false;
        if (fighter.team === 'enemies') { fighter.health = 100; fighter.koTimer = 0; }
      }
      state.fighters[0].x = 55; state.fighters[0].y = 145;
      state.fighters[1].x = 145; state.fighters[1].y = 160;
      state.fighters[2].x = 235; state.fighters[2].y = 145;
      state.fighters[3].x = 325; state.fighters[3].y = 160;
      scene.state = state;
      scene.drawFighters();
      // Keep the visual proof on an authoritative match frame, not a moving test fixture.
      scene.scene.pause();
      return {
        wave: document.querySelector('#wave-number')?.textContent,
        enemies: document.querySelector('#wave-enemies')?.textContent,
        countdown: document.querySelector('#wave-countdown')?.textContent,
        renderedFighters: [...scene.fighterSprites.values()].filter((sprite: any) => sprite.visible).length,
      };
    });
    expect(rendered).toEqual({ wave: 'WAVE 2/3', enemies: 'ENEMIES 2', countdown: 'NEXT WAVE IN 2', renderedFighters: 4 });
  };

  for (const viewport of [
    { width: 640, height: 360, url: '/' },
    { width: 1280, height: 720, url: '/?scale=2' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(viewport.url);
    await expect(page.locator('#game canvas')).toBeVisible();
    await prepareWaveSnapshot();
    const name = `m13-wave-${style}-${viewport.width}x${viewport.height}.png`;
    const path = join(screenshotDir, name);
    await page.screenshot({ path, fullPage: false });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  }
});

test('online HUD calls a supplied wave snapshot WAVE and the server now accepts wave mode', async ({ page }) => {
  await page.goto('/online.html');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => typeof (window as any).__turenkiOnline?.renderHudSnapshotForTest === 'function');
  await page.waitForFunction(() => (window as any).__turenkiOnline?.audioDiagnostics().state !== 'not-ready');
  const onlinePresentation = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const sim = await import(/* @vite-ignore */ moduleUrl);
    const modesUrl = '/src/game/simulation/modes.ts';
    const modes = await import(/* @vite-ignore */ modesUrl);
    const state = sim.createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'wave', teams: { P1: 'players', P2: 'enemies' } });
    (window as any).__turenkiOnline.renderHudSnapshotForTest(state);
    return {
      mode: document.querySelector('#match-mode')?.textContent,
      wave: document.querySelector('#wave-number')?.textContent,
      enemies: document.querySelector('#wave-enemies')?.textContent,
      validatedModes: modes.MODE_IDS,
    };
  });
  expect(onlinePresentation.mode).toBe('ONLINE MODE · WAVE');
  expect(onlinePresentation.wave).toBe('WAVE 1/3');
  expect(onlinePresentation.enemies).toBe('ENEMIES 1');
  expect(onlinePresentation.validatedModes).toContain('wave');
});
