import { expect, test } from '@playwright/test';

test('audio unlocks on gameplay key press, mute persists, and browser reports no audio errors', async ({ page }) => {
  const audioErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && /audio|audiocontext|resume|webaudio/i.test(message.text())) audioErrors.push(message.text());
  });
  page.on('pageerror', error => {
    if (/audio|audiocontext|resume|webaudio/i.test(error.message)) audioErrors.push(error.message);
  });
  await page.goto('/');
  await expect(page.locator('#audio-mute')).toBeVisible();
  await expect(page.locator('#audio-volume')).toBeVisible();
  expect(Number.parseFloat(await page.locator('#audio-mute').evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { audioDiagnostics?: () => { state: string } } | undefined;
    return scene?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('not-created');

  await page.keyboard.press('F');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { audioDiagnostics?: () => { state: string } } | undefined;
    return scene?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('running');

  await page.locator('#audio-mute').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('turenkifight.audio.v1') ?? '{}').muted)).toBe(true);
  expect(audioErrors).toEqual([]);
});

test('online scene uses the same gesture unlock and audio controls', async ({ page }) => {
  await page.goto('/online.html');
  await expect(page.locator('#audio-mute')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: { audioDiagnostics?: () => { state: string } } }).__turenkiOnline;
    return api?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('not-created');
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: { audioDiagnostics?: () => { state: string } } }).__turenkiOnline;
    return api?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('running');
  await page.locator('#audio-mute').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('turenkifight.audio.v1') ?? '{}').muted)).toBe(true);
});

test('procedural punch and kick cues are sharper and still flow through the unlocked audio director', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { audioDiagnostics?: () => { state: string } } | undefined;
    return scene?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('running');

  const cues = await page.evaluate(async () => {
    const moduleUrl = '/src/game/presentation/audio/audioAssets.ts';
    const { PLACEHOLDER_CUE_ASSETS } = await import(/* @vite-ignore */ moduleUrl);
    const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game.scene.getScene('StationScene') as {
      playAudioCue: (cue: 'hit' | 'kick') => void;
      audioDiagnostics: () => { cueCounts: Record<string, number> };
    };
    scene.playAudioCue('hit');
    scene.playAudioCue('kick');
    return {
      hit: PLACEHOLDER_CUE_ASSETS.hit,
      kick: PLACEHOLDER_CUE_ASSETS.kick,
      counts: scene.audioDiagnostics().cueCounts,
    };
  });
  expect(cues.hit).toMatchObject({ kind: 'synth', shape: { frequency: 300, duration: 0.06, attack: 0.003 } });
  expect(cues.kick).toMatchObject({ kind: 'synth', shape: { frequency: 165, duration: 0.095, attack: 0.003 } });
  expect(cues.counts).toMatchObject({ hit: 1, kick: 1 });
});

test('header audio controls stay outside the HUD and leave status readable on short and mobile views', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#audio-mute')).toBeVisible();
  const native = await page.evaluate(() => {
    const status = document.querySelector<HTMLElement>('#match-status')!;
    const controls = document.querySelector<HTMLElement>('.audio-controls')!;
    return {
      text: status.textContent,
      scrollWidth: status.scrollWidth,
      clientWidth: status.clientWidth,
      outsideHud: !controls.closest('#fight-hud'),
      fontSize: Number.parseFloat(getComputedStyle(controls.querySelector('button')!).fontSize),
    };
  });
  expect(native.text).toBe('SHIFT/PAD JOIN · START');
  expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth);
  expect(native.outsideHud).toBe(true);
  expect(native.fontSize).toBeGreaterThanOrEqual(14);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('#match-status').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.clientWidth);
});

test('audio controls are tabbable and define no gameplay-key shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('#audio-mute')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#audio-volume')).toBeFocused();
  // Focus is required to operate the slider; once focus returns to the page,
  // the normal gameplay key still reaches the audio gesture unlock path.
  await page.locator('#game canvas').click({ position: { x: 10, y: 10 } });
  await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as { state: { phase: string } };
    scene.state.phase = 'fighting';
  });
  await page.keyboard.down('f');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { state?: { fighters?: Array<{ attackMove?: string | null }> } } | undefined;
    return scene?.state?.fighters?.[0]?.attackMove ?? null;
  })).toBe('punch');
  await page.keyboard.up('f');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { audioDiagnostics?: () => { state: string } } | undefined;
    return scene?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('running');
});
