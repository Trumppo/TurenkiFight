import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const EIGHT = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);

async function installResults(page: Page, mode: string, ids = EIGHT, draw = false): Promise<void> {
  await page.evaluate(async ({ mode, ids, draw }) => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = mode;
    const state = simulation.createState({ ids, phase: 'results', mode });
    if (mode === 'score-brawl') {
      state.fighters.forEach((fighter: any, index: number) => {
        fighter.score = draw ? 12 : (ids.length - index) * 10;
        fighter.koCount = ids.length - index;
        fighter.hitsReceived = index;
      });
    } else if (mode === 'deathmatch') {
      state.fighters.forEach((fighter: any, index: number) => {
        fighter.frags = ids.length - index;
        fighter.deaths = index;
        fighter.damageDealt = (ids.length - index) * 20;
      });
    } else {
      state.fighters.forEach((fighter: any, index: number) => {
        fighter.eliminated = index !== ids.length - 1;
        fighter.health = index === ids.length - 1 ? 100 : 0;
        fighter.koCount = ids.length - index;
        fighter.damageDealt = (ids.length - index) * 10;
      });
    }
    if (draw) {
      state.fighters.forEach((fighter: any) => { fighter.score = 12; fighter.koCount = 0; fighter.hitsReceived = 0; });
    }
    const events: any[] = [];
    if (mode === 'last-man-standing') {
      ids.slice(0, -1).forEach((id, index) => events.push({ tick: index + 10, type: 'Knockout', target: id }));
    }
    events.push({ tick: 7200, type: 'MatchEnded', reason: 'time', winner: draw ? null : ids[0] });
    state.tick = 7200;
    state.remainingTicks = 0;
    state.events = events;
    scene.state = state;
    scene.matchEvents = [];
    scene.resultPresentationReady = false;
    scene.update(0, 0);
  }, { mode, ids, draw });
  await expect(page.locator('#victory-reveal')).toBeVisible();
}

test('Score Brawl, Deathmatch and Last Man Standing reveal their ranked podium metrics', async ({ page }) => {
  await page.goto('/?visual=retro');
  await expect(page.locator('#game canvas')).toBeVisible();

  await installResults(page, 'score-brawl');
  await expect(page.locator('#victory-title')).toHaveText('P1');
  await expect(page.locator('#victory-podium li').nth(0)).toHaveAttribute('aria-label', '2ND place, P2, 70 SCORE');
  await expect(page.locator('#victory-podium li').nth(1)).toHaveAttribute('aria-label', '3RD place, P3, 60 SCORE');
  await expect(page.locator('#victory-rest')).toContainText('4TH P4');
  await expect(page.locator('#victory-rest')).toContainText('8TH P8');

  // Drive the next synthetic results states through the real scene update,
  // just as a state transition from fighting would be prepared.
  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = simulation.createState({ ids: ['P1', 'P2', 'P3'], phase: 'results', mode: 'deathmatch' });
    state.fighters[0].frags = 2; state.fighters[0].deaths = 1;
    state.fighters[1].frags = 8; state.fighters[1].deaths = 0;
    state.fighters[2].frags = 4; state.fighters[2].deaths = 2;
    state.events = [{ tick: 7200, type: 'MatchEnded', reason: 'frag-limit', winner: 'P2' }];
    scene.state = state; scene.resultPresentationReady = false; scene.matchEvents = [];
    scene.update(0, 0);
  });
  await expect(page.locator('#victory-title')).toHaveText('P2');
  await expect(page.locator('#victory-podium li').nth(0)).toHaveAttribute('aria-label', '2ND place, P3, 4 FRAGS');
  await expect(page.locator('#victory-podium li').nth(1)).toHaveAttribute('aria-label', '3RD place, P1, 2 FRAGS');

  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const ids = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const state = simulation.createState({ ids, phase: 'results', mode: 'last-man-standing' });
    state.fighters.forEach((fighter: any, index: number) => { fighter.eliminated = index !== 4; fighter.health = index === 4 ? 100 : 0; });
    state.events = [
      { tick: 100, type: 'Knockout', target: 'P1' },
      { tick: 200, type: 'Knockout', target: 'P2' },
      { tick: 300, type: 'Knockout', target: 'P3' },
      { tick: 400, type: 'Knockout', target: 'P4' },
      { tick: 500, type: 'MatchEnded', reason: 'elimination', winner: 'P5' },
    ];
    scene.state = state; scene.resultPresentationReady = false; scene.matchEvents = [];
    scene.update(0, 0);
  });
  await expect(page.locator('#victory-title')).toHaveText('P5');
  await expect(page.locator('#victory-podium li').nth(0)).toHaveAttribute('aria-label', '2ND place, P4, SURVIVAL PLACE 2ND');
  await expect(page.locator('#victory-podium li').nth(1)).toHaveAttribute('aria-label', '3RD place, P3, SURVIVAL PLACE 3RD');
  const fivePlayerRest = await page.locator('#victory-rest').evaluate(element => ({
    text: element.textContent,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    overflow: element.scrollWidth > element.clientWidth + 1,
  }));
  expect(fivePlayerRest.text).toMatch(/^PLACES: .*4TH .*5TH /);
  expect(fivePlayerRest.text).not.toContain('8TH');
  expect(fivePlayerRest.fontSize).toBeGreaterThanOrEqual(14);
  expect(fivePlayerRest.overflow).toBe(false);
});

test('draw names all tied players without announcing a winner', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await installResults(page, 'score-brawl', ['P1', 'P2', 'P3'], true);
  await expect(page.locator('#victory-title')).toHaveText('DRAW');
  await expect(page.locator('#victory-ties')).toHaveText('TIED PLAYERS: P1 · P2 · P3');
  await expect(page.locator('#victory-title')).toHaveAttribute('aria-label', 'Draw. Tied players: P1, P2, P3');
  await expect(page.locator('#victory-reveal')).not.toContainText('WINNER:');
});

test('Last Man Standing carries knockout events across match ticks into the podium ranking', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = 'last-man-standing';
    const state = simulation.createState({ ids: ['P1', 'P2', 'P3', 'P4'], phase: 'fighting', mode: 'last-man-standing' });
    const [p1, p2, p3, p4] = state.fighters;
    for (const fighter of state.fighters) { fighter.y = 160; fighter.health = 10; }
    Object.assign(p4, { x: 100, facing: 1, attackMove: 'punch', attackFrames: 17 });
    Object.assign(p1, { x: 120 });
    Object.assign(p3, { x: 200 });
    Object.assign(p2, { x: 220 });
    scene.state = state;
    scene.matchEvents = [];
    scene.resultPresentationReady = false;
    scene.elapsedMs = 0;
    scene.update(0, 17);
    Object.assign(scene.state.fighters.find((fighter: any) => fighter.id === 'P3'), { attackMove: 'punch', attackFrames: 17 });
    scene.update(0, 17);
    const observed = scene.matchEvents.filter((event: any) => event.type === 'Knockout').map((event: any) => event.target);
    if (observed.join(',') !== 'P1,P2') throw new Error(`Unexpected observed KO sequence: ${observed.join(',')}`);
    const ended = scene.state;
    ended.phase = 'results';
    ended.fighters.find((fighter: any) => fighter.id === 'P3').eliminated = true;
    ended.events = [{ tick: ended.tick, type: 'MatchEnded', reason: 'elimination', winner: 'P4' }];
    scene.state = ended;
    scene.update(0, 0);
  });
  await expect(page.locator('#victory-title')).toHaveText('P4');
  await expect(page.locator('#victory-podium li').nth(0)).toHaveAttribute('aria-label', '2ND place, P2, SURVIVAL PLACE 2ND');
  await expect(page.locator('#victory-podium li').nth(1)).toHaveAttribute('aria-label', '3RD place, P1, SURVIVAL PLACE 3RD');
});

test('keyboard or pointer skips the flourish but keeps the static podium', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await installResults(page, 'score-brawl', ['P1', 'P2', 'P3']);
  await expect(page.locator('#victory-reveal')).toHaveClass(/is-revealing/);
  await page.keyboard.press('a');
  await expect(page.locator('#victory-reveal')).not.toHaveClass(/is-revealing/);
  await expect(page.locator('#victory-title')).toHaveText('P1');

  // Reinstall results to restart the reveal, then an unrelated click skips it.
  await installResults(page, 'score-brawl', ['P1', 'P2', 'P3']);
  await page.locator('h1').click({ force: true });
  await expect(page.locator('#victory-reveal')).not.toHaveClass(/is-revealing/);
});

test('reduced motion starts with a static podium and no reveal timer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await installResults(page, 'deathmatch', ['P1', 'P2', 'P3']);
  await expect(page.locator('#victory-reveal')).not.toHaveClass(/is-revealing/);
  await expect(page.locator('#victory-title')).toHaveText('P1');
  const state = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return { timer: scene.revealTimer ?? null, motion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  expect(state).toEqual({ timer: null, motion: true });
});

test('RESET button and Esc return to the lobby during reveal and clear timers', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await installResults(page, 'score-brawl', ['P1', 'P2', 'P3']);
  await page.locator('#reset-match').click();
  await expect(page.locator('#victory-reveal')).toBeHidden();
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /LOBBY/);
  expect(await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').revealTimer ?? null)).toBeNull();

  await installResults(page, 'score-brawl', ['P1', 'P2', 'P3']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#victory-reveal')).toBeHidden();
  await expect(page.locator('#match-status')).toHaveAttribute('aria-label', /LOBBY/);
});

test('results screenshots fit all requested viewports with readable, non-clipped labels', async ({ page }) => {
  const outputDirectory = path.join(process.cwd(), 'artifacts', 'm9-victory-viewports');
  await mkdir(outputDirectory, { recursive: true });
  await page.goto('/?visual=retro');
  await expect(page.locator('#game canvas')).toBeVisible();
  for (const viewport of [
    { width: 640, height: 360, label: '640x360' },
    { width: 1280, height: 720, label: '1280x720' },
    { width: 1920, height: 1080, label: '1920x1080' },
    { width: 390, height: 844, label: '390x844' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installResults(page, 'score-brawl');
    await page.waitForTimeout(1250);
    await page.screenshot({ path: path.join(outputDirectory, `${viewport.label}.png`) });
    const layout = await page.evaluate(() => {
      const panel = document.getElementById('victory-reveal')!;
      const text = Array.from(panel.querySelectorAll<HTMLElement>('.victory-kicker, .victory-title, .victory-ties, .victory-place, .victory-rest, .victory-skip'));
      const rect = panel.getBoundingClientRect();
      return {
        panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        sizes: text.map(element => Number.parseFloat(getComputedStyle(element).fontSize)),
        overflow: Array.from(panel.querySelectorAll<HTMLElement>('*'))
          .filter(element => !element.classList.contains('victory-burst') && element.scrollWidth > element.clientWidth + 1)
          .map(element => ({ className: element.className, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })),
        viewportHeight: window.innerHeight,
        title: document.getElementById('victory-title')?.textContent,
        rest: document.getElementById('victory-rest')?.textContent,
      };
    });
    expect(layout.sizes.every(size => size >= 14)).toBe(true);
    expect(layout.overflow).toEqual([]);
    expect(layout.panel.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.title).toBe('P1');
    expect(layout.rest).toContain('8TH P8');
  }
});
