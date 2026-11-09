import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const PLAYER_IDS = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
const VIEWPORTS = [
  { width: 640, height: 360, label: '640x360' },
  { width: 1280, height: 720, label: '1280x720' },
];

async function installFightingHud(page: Page): Promise<void> {
  await page.evaluate(async ids => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = 'score-brawl';
    scene.state = simulation.createState({ ids, phase: 'fighting', mode: 'score-brawl' });
    scene.state.objects = [{ id: 'O1', kind: 'bottle', x: 320, y: 320, z: 0, state: 'ground' }];
    scene.drawFighters();
    scene.renderDomHud();
  }, PLAYER_IDS);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function installResultsHud(page: Page): Promise<void> {
  await page.evaluate(async ids => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = simulation.createState({ ids, phase: 'results', mode: 'score-brawl' });
    state.fighters.forEach((fighter: any, index: number) => { fighter.score = (ids.length - index) * 10; });
    state.events = [{ tick: 7200, type: 'MatchEnded', reason: 'time', winner: 'P1' }];
    state.tick = 7200;
    state.remainingTicks = 0;
    scene.selectedMode = 'score-brawl';
    scene.state = state;
    scene.matchEvents = [];
    scene.resultPresentationReady = false;
    scene.update(0, 0);
  }, PLAYER_IDS);
  await expect(page.locator('#victory-reveal')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function inspectTextAndBounds(page: Page, selector: string) {
  return page.locator(selector).evaluate(root => {
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const texts = Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter(element => visible(element) && (element.innerText ?? element.textContent ?? '').trim().length > 0)
      .map(element => ({
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.innerText ?? element.textContent ?? '').trim(),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        // Native select elements report the height of their closed option list
        // as scrollHeight in Chromium; their visible control box is checked by
        // bounds and computed font size instead.
        scrollWidth: element.tagName === 'SELECT' || getComputedStyle(element).overflowX === 'visible'
          ? element.clientWidth : element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.tagName === 'SELECT' || getComputedStyle(element).overflowY === 'visible'
          ? element.clientHeight : element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
    const rootRect = root.getBoundingClientRect();
    const gameRect = document.getElementById('game')!.getBoundingClientRect();
    const canvas = document.querySelector<HTMLCanvasElement>('#game canvas')!;
    const canvasRect = canvas.getBoundingClientRect();
    const clippedDescendants = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(element => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1
        || rect.top < rootRect.top - 1 || rect.bottom > rootRect.bottom + 1;
    }).map(element => ({ id: element.id, className: element.className, rect: element.getBoundingClientRect().toJSON() }));
    return {
      texts,
      rootInsideGame: rootRect.left >= gameRect.left && rootRect.right <= gameRect.right
        && rootRect.top >= gameRect.top && rootRect.bottom <= gameRect.bottom,
      rootOverflow: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight },
      clippedDescendants,
      canvasLogicalSize: [canvas.width, canvas.height],
      canvasCssSize: [canvasRect.width, canvasRect.height],
      viewportSize: [window.innerWidth, window.innerHeight],
      shortHeightMedia: matchMedia('(max-height: 540px)').matches,
      gameCssSize: [getComputedStyle(document.getElementById('game')!).width, getComputedStyle(document.getElementById('game')!).height],
      canvasInsideViewport: canvasRect.left >= 0 && canvasRect.top >= 0
        && canvasRect.right <= window.innerWidth && canvasRect.bottom <= window.innerHeight,
      rootBounds: { left: rootRect.left, top: rootRect.top, right: rootRect.right, bottom: rootRect.bottom },
      canvasBounds: { left: canvasRect.left, top: canvasRect.top, right: canvasRect.right, bottom: canvasRect.bottom },
    };
  });
}

function assertReadable(layout: Awaited<ReturnType<typeof inspectTextAndBounds>>, label: string): void {
  expect(layout.rootInsideGame, `${label}: presentation panel must stay within the game frame`).toBe(true);
  expect(layout.clippedDescendants, `${label}: no visible child may be clipped by the game or result panel`).toEqual([]);
  expect(layout.canvasLogicalSize, `${label}: preserve the logical camera`).toEqual([640, 360]);
  expect(layout.canvasInsideViewport, `${label}: keep the complete canvas in view`).toBe(true);
  expect(layout.rootOverflow.scrollWidth, `${label}: panel width must not clip content`).toBeLessThanOrEqual(layout.rootOverflow.clientWidth + 1);
  expect(layout.rootOverflow.scrollHeight, `${label}: panel height must not clip content`).toBeLessThanOrEqual(layout.rootOverflow.clientHeight + 1);
  expect(layout.texts.length, `${label}: expected visible presentation text`).toBeGreaterThan(0);
  expect(layout.texts.filter(item => item.fontSize < 14), `${label}: HUD and results text must be at least 14 CSS px`).toEqual([]);
  expect(layout.texts.filter(item => item.scrollWidth > item.clientWidth + 1), `${label}: horizontal text clipping`).toEqual([]);
  expect(layout.texts.filter(item => item.scrollHeight > item.clientHeight + 1), `${label}: vertical text clipping`).toEqual([]);
}

test('G5 desktop HUD and results stay readable at native and scaled desktop sizes', async ({ page }) => {
  const style = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';
  const outputDirectory = path.join(process.cwd(), 'artifacts', 'g5-desktop-hud');
  await mkdir(outputDirectory, { recursive: true });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    await installFightingHud(page);

    const hud = await inspectTextAndBounds(page, '#fight-hud');
    assertReadable(hud, `${style} ${viewport.label} fighting HUD`);
    if (viewport.width === 640) expect(hud.canvasCssSize[0]).toBeLessThan(640);
    await expect(page.locator('#player-hud .hud-player')).toHaveCount(8);
    expect(await page.locator('#player-hud .hud-player').evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.player)))
      .toEqual(PLAYER_IDS);
    await expect(page.locator('#match-timer')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(page.locator('#match-status')).toContainText('FIGHT');
    await expect(page.locator('#game-mode')).toBeVisible();
    await expect(page.locator('#object-hint')).toBeVisible();
    console.log(`G5 ${style} ${viewport.label} HUD: ${hud.texts.length} text elements; ${hud.texts.length ? Math.min(...hud.texts.map(item => item.fontSize)) : 0}-${Math.max(...hud.texts.map(item => item.fontSize))} CSS px; canvas ${hud.canvasCssSize.join('x')} CSS / ${hud.canvasLogicalSize.join('x')} logical in ${hud.viewportSize.join('x')} (short-height media ${hud.shortHeightMedia}, game ${hud.gameCssSize.join('x')}); HUD height ${(hud.rootBounds.bottom - hud.rootBounds.top).toFixed(1)}px`);
    await page.screenshot({ path: path.join(outputDirectory, `${style}-${viewport.label}-hud.png`), animations: 'disabled' });

    await installResultsHud(page);
    const results = await inspectTextAndBounds(page, '#victory-reveal');
    assertReadable(results, `${style} ${viewport.label} results`);
    console.log(`G5 ${style} ${viewport.label} results: ${results.texts.length} text elements; ${Math.min(...results.texts.map(item => item.fontSize))}-${Math.max(...results.texts.map(item => item.fontSize))} CSS px; panel ${results.rootBounds.right - results.rootBounds.left}x${results.rootBounds.bottom - results.rootBounds.top}px`);
    await expect(page.locator('#victory-title')).toHaveText('P1');
    await expect(page.locator('#victory-podium li')).toHaveCount(2);
    await expect(page.locator('#victory-rest')).toContainText('8TH P8');
    if (viewport.height <= 540) {
      await expect(page.locator('#match-status')).toHaveText('RESULTS · WINNER: P1');
      await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /REASON: TIME/i);
    }
    console.log(`G5 ${style} ${viewport.label} visible results status: ${await page.locator('#match-status').textContent()}`);
    await page.screenshot({ path: path.join(outputDirectory, `${style}-${viewport.label}-results.png`), animations: 'disabled' });
  }
});
