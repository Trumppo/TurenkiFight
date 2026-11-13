import { expect, test, type Page } from '@playwright/test';

import { enterLocalGame } from './titleFlow';
type CameraDiagnostics = {
  shakeCount: number;
  lastShake: { reason: string; duration: number; intensity: number } | null;
  isShaking: boolean;
  reducedMotion: boolean;
};
type FeedbackDiagnostics = { liveSparks: number; maxLiveSparks: number; knockoutTargets: string[] };

async function landPunch(page: Page, targetHealth: number): Promise<{
  knockoutEvents: number;
  camera: CameraDiagnostics;
  feedback: FeedbackDiagnostics;
}> {
  return page.evaluate(async targetHealth => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting' });
    const [p1, p2] = state.fighters;
    Object.assign(p1, { x: 170, y: 160, facing: 1 });
    Object.assign(p2, { x: 190, y: 160, health: targetHealth });
    scene.state = state;
    scene.matchEvents = [];
    scene.elapsedMs = 0;
    scene.keys.F.isDown = true;
    scene.update(0, 150);
    scene.keys.F.isDown = false;
    return {
      knockoutEvents: scene.matchEvents.filter((event: any) => event.type === 'Knockout').length,
      camera: scene.cameraPunchDiagnostics(),
      feedback: scene.combatFeedbackDiagnostics(),
    };
  }, targetHealth);
}

test('a knockout produces a short restrained camera punch, stronger than an ordinary hit', async ({ page }) => {
  await enterLocalGame(page, '/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const ordinaryHit = await landPunch(page, 100);
  expect(ordinaryHit.camera.lastShake).toMatchObject({ reason: 'hit', duration: 32, intensity: 0.0015 });
  expect(ordinaryHit.camera.isShaking).toBe(true);
  expect(ordinaryHit.feedback.liveSparks).toBeGreaterThan(0);
  expect(ordinaryHit.feedback.liveSparks).toBeLessThanOrEqual(ordinaryHit.feedback.maxLiveSparks);
  const knockout = await landPunch(page, 10);
  expect(knockout.knockoutEvents).toBeGreaterThan(0);
  expect(knockout.feedback.knockoutTargets).toEqual(['P2']);
  expect(knockout.camera.lastShake).toMatchObject({ reason: 'knockout', duration: 140, intensity: 0.007 });
  expect(knockout.camera.shakeCount).toBeGreaterThan(ordinaryHit.camera.shakeCount);
  expect(knockout.camera.isShaking).toBe(true);
});

test('prefers-reduced-motion suppresses camera shake on a real knockout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterLocalGame(page, '/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await landPunch(page, 10);
  expect(result.knockoutEvents).toBeGreaterThan(0);
  expect(result.camera.reducedMotion).toBe(true);
  expect(result.camera.shakeCount).toBe(0);
  expect(result.camera.lastShake).toBeNull();
  expect(result.camera.isShaking).toBe(false);
  expect(result.feedback.liveSparks).toBeGreaterThan(0);
  expect(result.feedback.knockoutTargets).toEqual(['P2']);
});
