import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createState } from '../../src/game/simulation/step';

const style = 'retro';

test('station event is tick-derived, visible only during its window and cues once', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const fixture = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
  for (const [index, fighter] of fixture.fighters.entries()) {
    fighter.x = [100, 235, 385, 520][index];
    fighter.y = [230, 240, 250, 260][index];
  }
  await page.evaluate((state) => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.scene.pause();
    scene.state = state;
    scene.drawFighters();
  }, fixture);

  const before = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 3299;
    scene.drawFighters();
    return {
      event: scene.stationEvent.diagnostics(),
      hidden: (document.querySelector('#station-event-status') as HTMLElement).hidden,
    };
  });
  expect(before).toEqual({ event: { active: false, phase: null, cycle: null, cueCount: 0 }, hidden: true });

  const duringWarning = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 3300;
    const stateBytes = JSON.stringify(scene.state);
    scene.drawFighters();
    scene.drawFighters();
    return {
      event: scene.stationEvent.diagnostics(),
      text: (document.querySelector('#station-event-status') as HTMLElement).textContent,
      hidden: (document.querySelector('#station-event-status') as HTMLElement).hidden,
      cueCount: scene.audioDiagnostics().cueCounts['station-train'],
      audioState: scene.audioDiagnostics().state,
      fighters: scene.fighterSprites.size,
      lightsVisible: scene.stationEvent.lights.visible,
      stateTick: scene.state.tick,
      unchangedState: stateBytes === JSON.stringify(scene.state),
    };
  });
  expect(duringWarning).toEqual({
    event: { active: true, phase: 'warning', cycle: 1, cueCount: 1 },
    text: 'TRAIN APPROACH · PLATFORM LIGHTS ONLY', hidden: false, cueCount: 1,
    audioState: 'not-created', fighters: 4, lightsVisible: true, stateTick: 3300, unchangedState: true,
  });
  await expect(page.locator('#station-event-status')).toHaveCSS('font-size', '14px');
  await expect(page.locator('#station-event-status')).toHaveCSS('white-space', 'nowrap');

  const duringPass = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 3600;
    scene.drawFighters();
    return {
      event: scene.stationEvent.diagnostics(),
      text: (document.querySelector('#station-event-status') as HTMLElement).textContent,
    };
  });
  expect(duringPass).toEqual({
    event: { active: true, phase: 'passing', cycle: 1, cueCount: 1 },
    text: 'TRAIN PASSING · PLATFORM LIGHTS ONLY',
  });

  const after = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 3780;
    scene.drawFighters();
    return {
      event: scene.stationEvent.diagnostics(),
      hidden: (document.querySelector('#station-event-status') as HTMLElement).hidden,
      cueCount: scene.audioDiagnostics().cueCounts['station-train'],
      lightsVisible: scene.stationEvent.lights.visible,
    };
  });
  expect(after).toEqual({
    event: { active: false, phase: null, cycle: null, cueCount: 1 },
    hidden: true, cueCount: 1, lightsVisible: false,
  });

  const rematch = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = 0;
    scene.drawFighters();
    scene.state.tick = 3300;
    scene.drawFighters();
    scene.drawFighters();
    return {
      event: scene.stationEvent.diagnostics(),
      cueCount: scene.audioDiagnostics().cueCounts['station-train'],
    };
  });
  expect(rematch).toEqual({
    event: { active: true, phase: 'warning', cycle: 1, cueCount: 2 }, cueCount: 2,
  });
});

test('station event has native and 2x screenshots with the HUD and four fighters present', async ({ page }) => {
  await mkdir('artifacts/visual', { recursive: true });
  for (const size of [
    { width: 640, height: 360, name: '640x360' },
    { width: 1280, height: 720, name: '1280x720' },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(size.width === 1280 ? '/?scale=2' : '/');
    await expect(page.locator('#game canvas')).toBeVisible();
    const state = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
    for (const [index, fighter] of state.fighters.entries()) {
      fighter.x = [100, 235, 385, 520][index];
      fighter.y = [230, 240, 250, 260][index];
    }
    state.tick = 3300;
    await page.evaluate((fixture) => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.scene.pause();
      scene.state = fixture;
      scene.drawFighters();
    }, state);
    await expect(page.locator('#station-event-status')).toHaveText('TRAIN APPROACH · PLATFORM LIGHTS ONLY');
    const layout = await page.evaluate(() => {
      const status = document.querySelector<HTMLElement>('#station-event-status')!;
      const hud = document.querySelector<HTMLElement>('#fight-hud')!;
      const canvas = document.querySelector<HTMLCanvasElement>('#game canvas')!;
      const canvasRect = canvas.getBoundingClientRect();
      const logicalScale = canvasRect.height / 360;
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      const fighterTop = Math.min(...Array.from(scene.fighterSprites.values(), (sprite: any) =>
        canvasRect.top + (sprite.y - 48) * logicalScale));
      const rect = status.getBoundingClientRect();
      return {
        visibleFighters: scene.fighterSprites.size,
        statusFont: Number.parseFloat(getComputedStyle(status).fontSize),
        statusFits: status.scrollWidth <= status.clientWidth,
        hudInsideViewport: hud.getBoundingClientRect().bottom <= innerHeight,
        hudAboveFighters: hud.getBoundingClientRect().bottom < fighterTop,
        statusInsideViewport: rect.bottom <= innerHeight,
        logicalCanvas: [canvas.width, canvas.height],
      };
    });
    expect(layout).toMatchObject({
      visibleFighters: 4, statusFont: 14, statusFits: true,
      hudInsideViewport: true, hudAboveFighters: true, statusInsideViewport: true, logicalCanvas: [640, 360],
    });
    await page.screenshot({ path: `artifacts/visual/m12-station-event-${style}-${size.name}.png`, fullPage: true });
  }
});

test('online station event derives the identical warning, pass and visibility from snapshot ticks', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/online.html');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const api = (window as any).__turenkiOnline;
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    state.tick = 3299;
    api.renderHudSnapshotForTest(state);
    const before = {
      event: api.stationEventDiagnostics(),
      hidden: (document.querySelector('#station-event-status') as HTMLElement).hidden,
    };
    state.tick = 3300;
    api.renderHudSnapshotForTest(state);
    const warning = {
      event: api.stationEventDiagnostics(),
      text: (document.querySelector('#station-event-status') as HTMLElement).textContent,
    };
    api.renderHudSnapshotForTest(state);
    state.tick = 3600;
    api.renderHudSnapshotForTest(state);
    const passing = {
      event: api.stationEventDiagnostics(),
      text: (document.querySelector('#station-event-status') as HTMLElement).textContent,
    };
    state.tick = 3780;
    api.renderHudSnapshotForTest(state);
    const after = {
      event: api.stationEventDiagnostics(),
      hidden: (document.querySelector('#station-event-status') as HTMLElement).hidden,
    };
    return { before, warning, passing, after };
  });
  expect(result).toEqual({
    before: { event: { active: false, phase: null, cycle: null, cueCount: 0 }, hidden: true },
    warning: {
      event: { active: true, phase: 'warning', cycle: 1, cueCount: 1 },
      text: 'TRAIN APPROACH · PLATFORM LIGHTS ONLY',
    },
    passing: {
      event: { active: true, phase: 'passing', cycle: 1, cueCount: 1 },
      text: 'TRAIN PASSING · PLATFORM LIGHTS ONLY',
    },
    after: { event: { active: false, phase: null, cycle: null, cueCount: 1 }, hidden: true },
  });
});
