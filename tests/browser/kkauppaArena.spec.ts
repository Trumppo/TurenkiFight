import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createState } from '../../src/game/simulation/step';

const style = 'retro';

async function enterLocalFight(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(path);
  const onboarding = page.locator('#onboarding');
  if (await onboarding.count()) {
    await expect(onboarding).toHaveAttribute('data-screen', 'title');
    await expect(page.locator('#game canvas')).toHaveCount(0);
    await page.locator('#title-start').click();
    await expect(onboarding).toHaveAttribute('data-screen', 'menu');
    await page.locator('[data-route="local"]').click();
  }
  await expect(page.locator('#game canvas')).toBeVisible();
}

async function waitForBackdrop(page: import('@playwright/test').Page, texture: string): Promise<void> {
  await expect.poll(() => page.evaluate((key) => {
    const scene = (window as any).__turenkiGame?.scene.getScene('StationScene');
    return scene?.sys.isActive() && scene.textures.exists(key);
  }, texture)).toBe(true);
}

async function distinctColorCount(page: import('@playwright/test').Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let y = 0; y < canvas.height && colors.size <= 32; y += 3) {
      for (let x = 0; x < canvas.width && colors.size <= 32; x += 3) {
        const index = (y * canvas.width + x) * 4;
        colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
      }
    }
    return colors.size;
  }, png.toString('base64'));
}

async function assetSha256(assetPath: string): Promise<string> {
  const text = await readFile(resolve(process.cwd(), 'public', assetPath), 'utf8');
  // Git may check out these committed SVGs with CRLF on Windows or LF on Linux.
  const bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

test('K-kauppa renders in retro with four readable fighter sprites at native and 2x scale', async ({ page }) => {
  for (const size of [{ name: '640x360', width: 640, height: 360, scale: 1 }, { name: '1280x720', width: 1280, height: 720, scale: 2 }]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await enterLocalFight(page, size.scale === 2 ? '/?arena=kkauppa&scale=2' : '/?arena=kkauppa');
    await expect(page.locator('.page-header p')).toHaveText('K-kauppa · interior 2.5D arena prototype');
    await waitForBackdrop(page, 'arena-kkauppa-backdrop');
    await expect(page.locator('#game canvas')).toHaveAttribute('width', '640');
    await expect(page.locator('#game canvas')).toHaveAttribute('height', '360');

    const state = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
    await page.evaluate((fixture) => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      scene.state = fixture;
      scene.drawFighters();
    }, state);
    await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').fighterSprites.size)).toBe(4);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const canvas = page.locator('#game canvas');
    await canvas.evaluate((node, scaleFactor) => {
      // Chromium's screenshot compositor captures WebGL correctly; reading the
      // default non-preserved drawing buffer through toDataURL would be black.
      (node as HTMLCanvasElement).style.width = `${640 * scaleFactor}px`;
      (node as HTMLCanvasElement).style.height = `${360 * scaleFactor}px`;
      (node as HTMLCanvasElement).style.imageRendering = 'pixelated';
    }, size.scale);
    const captured = await canvas.screenshot({ scale: 'css' });
    const png = size.scale === 1
      ? Buffer.from((await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const output = document.createElement('canvas');
        output.width = 640;
        output.height = 360;
        const context = output.getContext('2d')!;
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, output.width, output.height);
        return output.toDataURL('image/png');
      }, captured.toString('base64'))).split(',')[1]!, 'base64')
      : captured;
    expect(await canvas.evaluate(node => [(node as HTMLCanvasElement).width, (node as HTMLCanvasElement).height])).toEqual([640, 360]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640 * size.scale, 360 * size.scale]);
    expect(await distinctColorCount(page, png), 'K-kauppa screenshot should be nonblank').toBeGreaterThan(1);
    const dir = join(process.cwd(), 'artifacts', 'screenshots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `m15-kkauppa-${style}-${size.name}.png`), png);
  }
});

test('station default and Mesku selection still resolve their original backdrops', async ({ page }) => {
  await enterLocalFight(page, '/');
  await waitForBackdrop(page, 'station-backdrop');
  expect(await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return {
      selectedArena: scene.arenaSelection.manifest.id,
      station: scene.textures.exists('station-backdrop'),
      kkauppa: scene.textures.exists('arena-kkauppa-backdrop'),
    };
  })).toEqual({ selectedArena: 'station', station: true, kkauppa: false });

  await enterLocalFight(page, '/?arena=mesku');
  await waitForBackdrop(page, 'arena-mesku-backdrop');
  expect(await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return {
      selectedArena: scene.arenaSelection.manifest.id,
      station: scene.textures.exists('station-backdrop'),
      mesku: scene.textures.exists('arena-mesku-backdrop'),
      shop: scene.textures.exists('arena-kkauppa-backdrop'),
    };
  })).toEqual({ selectedArena: 'mesku', station: false, mesku: true, shop: false });
  expect(await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').createLobbyState(['P1', 'P2']).arena))
    .toBe('mesku');

  await page.goto('/online.html?arena=kkauppa');
  await expect(page.locator('.page-header p')).toHaveText('Remote authoritative match · arena: K-kauppa');
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiOnline?.arenaTextureExists())).toBe(true);
});

test('the selected arena wires into normal, reset, ALL BOTS and wave state creation', async ({ page }) => {
  await enterLocalFight(page, '/?arena=kkauppa');
  await waitForBackdrop(page, 'arena-kkauppa-backdrop');
  await page.keyboard.press('Shift');
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.fighters.map((fighter: any) => fighter.id))).toEqual(['P1', 'P2']);
  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.phase)).toBe('countdown');
  expect(await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').state.arena)).toBe('kkauppa');

  const paths = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.resetLocal();
    const resetArena = scene.state.arena;
    scene.startAllBotMatch();
    const allBotsArena = scene.state.arena;
    scene.resetLocal();
    scene.selectedMode = 'wave';
    scene.botSlots.add('P2');
    scene.state = scene.createLobbyState(['P1', 'P2']);
    const waveLobby = { arena: scene.state.arena, mode: scene.state.mode };
    scene.startLocalMatch();
    return { resetArena, allBotsArena, waveArena: scene.state.arena, waveMode: scene.state.mode, waveLobby };
  });
  expect(paths).toEqual({
    resetArena: 'kkauppa', allBotsArena: 'kkauppa', waveArena: 'kkauppa', waveMode: 'wave',
    waveLobby: { arena: 'kkauppa', mode: 'wave' },
  });

  const hazard = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    let state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting', arena: 'kkauppa' });
    state.tick = 2399;
    state.fighters[0].y = 140;
    state.fighters[1].y = 157;
    scene.state = state;
    scene.previous.clear();
    scene.lastDrawTick = undefined;
    scene.drawFighters();
    const idle = scene.arenaTelegraph.diagnostics();
    state = simulation.step(state, []);
    scene.state = state;
    scene.drawFighters();
    const warning = scene.arenaTelegraph.diagnostics();
    const warningLabel = scene.arenaTelegraph.label.text;
    const warningHealth = state.fighters.map((fighter: any) => fighter.health);
    const warningState = JSON.stringify(state);
    const firstCueCount = scene.audioDiagnostics().cueCounts['shop-bell'] ?? 0;
    scene.drawFighters();
    const repeatedCueCount = scene.audioDiagnostics().cueCounts['shop-bell'] ?? 0;
    const warningStateUnchanged = warningState === JSON.stringify(state);
    state.tick = 2579;
    scene.state = state;
    scene.drawFighters();
    const preCollapseHealth = state.fighters.map((fighter: any) => fighter.health);
    state = simulation.step(state, []);
    scene.state = state;
    scene.drawFighters();
    return {
      idle, warning, warningLabel, warningHealth, firstCueCount, repeatedCueCount, warningStateUnchanged,
      active: scene.arenaTelegraph.diagnostics(),
      health: state.fighters.map((fighter: any) => fighter.health), preCollapseHealth,
      tick: state.tick, arena: state.arena, cameraShaking: scene.cameras.main.shakeEffect.isRunning,
    };
  });
  expect(hazard.idle).toMatchObject({ phase: 'idle', bandVisible: true, warningStart: 2400 });
  expect(hazard.warning).toMatchObject({ phase: 'warning', active: true, bandVisible: true, cueCount: 1 });
  expect(hazard.warningLabel).toBe('ARENA: SHELF ZONE · DROP 3S');
  expect(hazard.warningHealth).toEqual([100, 100]);
  expect(hazard.firstCueCount).toBe(1);
  expect(hazard.repeatedCueCount).toBe(1);
  expect(hazard.warningStateUnchanged).toBe(true);
  expect(hazard.active).toMatchObject({ phase: 'active', bandVisible: true, damageFeedback: true });
  expect(hazard).toMatchObject({ tick: 2580, arena: 'kkauppa', preCollapseHealth: [100, 100], health: [99, 100] });
  expect(hazard.cameraShaking).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const staticWarningColors = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = simulation.createState({ ids: ['P1'], phase: 'fighting', arena: 'kkauppa' });
    state.tick = 2400;
    scene.state = state;
    scene.drawFighters();
    const first = scene.arenaTelegraph.label.style.color;
    state.tick = 2408;
    scene.drawFighters();
    return [first, scene.arenaTelegraph.label.style.color];
  });
  expect(staticWarningColors[0]).toBe(staticWarningColors[1]);
  const reducedMotion = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    let state = simulation.createState({ ids: ['P1'], phase: 'fighting', arena: 'kkauppa' });
    state.tick = 2579;
    state.fighters[0].y = 140;
    scene.previous.clear();
    scene.lastDrawTick = undefined;
    scene.lastHazardFeedbackTick = -1;
    scene.cameras.main.shakeEffect.reset();
    scene.state = state;
    scene.drawFighters();
    state = simulation.step(state, []);
    scene.state = state;
    scene.drawFighters();
    return { shaking: scene.cameras.main.shakeEffect.isRunning, feedback: scene.arenaTelegraph.diagnostics().damageFeedback };
  });
  expect(reducedMotion).toEqual({ shaking: false, feedback: true });
});

test('station keeps default state bytes and has no shelf band', async ({ page }) => {
  await enterLocalFight(page, '/');
  await waitForBackdrop(page, 'station-backdrop');
  const station = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.scene.pause('StationScene');
    scene.state = scene.createLobbyState(['P1', 'P2']);
    scene.startLocalMatch();
    const actual = scene.state;
    const expected = simulation.createState(['P1', 'P2'], 'countdown');
    scene.arenaTelegraph.update(0, actual.phase === 'fighting', actual.arena);
    return {
      arena: actual.arena,
      sameBytes: JSON.stringify(actual) === JSON.stringify(expected),
      band: scene.arenaTelegraph.diagnostics(),
    };
  });
  expect(station.arena).toBeUndefined();
  expect(station.sameBytes).toBe(true);
  expect(station.band).toMatchObject({ phase: 'idle', bandVisible: false });
});

test('online hazard follows the snapshot arena and tick; an omitted arena is harmless', async ({ page }) => {
  await page.goto('/online.html?arena=kkauppa');
  await expect(page.locator('.page-header p')).toHaveText('Remote authoritative match · arena: K-kauppa');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__turenkiOnline?.arenaHazardDiagnostics)).toBe('function');
  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const api = (window as any).__turenkiOnline;
    const kkauppa = simulation.createState({ ids: ['P1'], phase: 'fighting', arena: 'kkauppa' });
    kkauppa.tick = 2400;
    api.renderHudSnapshotForTest(kkauppa);
    const warning = api.arenaHazardDiagnostics();
    const station = simulation.createState({ ids: ['P1'], phase: 'fighting' });
    station.tick = 2580;
    api.renderHudSnapshotForTest(station);
    return { warning, station: api.arenaHazardDiagnostics() };
  });
  expect(result.warning).toMatchObject({ phase: 'warning', bandVisible: true, warningStart: 2400 });
  expect(result.station).toMatchObject({ phase: 'idle', bandVisible: false });
});

test('the danger band, warning and collapse render at 640x360 and 1280x720', async ({ page }) => {
  test.setTimeout(90_000);
  await enterLocalFight(page, '/?arena=kkauppa');
  await waitForBackdrop(page, 'arena-kkauppa-backdrop');
  await page.addStyleTag({ content: '#game { width: 648px !important; max-width: none !important; margin-left: 0 !important; margin-right: 0 !important; } #game canvas { width: 640px !important; height: 360px !important; max-width: none !important; margin: 0 !important; } main { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }' });
  for (const size of [
    { name: '640x360', width: 640, height: 360, scale: 1 },
    { name: '1280x720', width: 1280, height: 720, scale: 2 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const phase of [
      { name: 'before-warning', tick: 2300 },
      { name: 'warning', tick: 2500 },
      { name: 'collapse', tick: 2600 },
    ]) {
      await page.evaluate(({ tick }) => {
        const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
        scene.scene.pause('StationScene');
        const fighters = [
          { id: 'P1', x: 120, y: 138, z: 0, vz: 0, facing: 1, health: 100, score: 0, koCount: 0, hitsReceived: 0, attackCooldown: 0, attackFrames: 0, attackMove: null, hitTargets: [], hitstun: 0, koTimer: 0, protection: 0, previousButtons: [] },
          { id: 'P2', x: 260, y: 180, z: 0, vz: 0, facing: -1, health: 100, score: 0, koCount: 0, hitsReceived: 0, attackCooldown: 0, attackFrames: 0, attackMove: null, hitTargets: [], hitstun: 0, koTimer: 0, protection: 0, previousButtons: [] },
        ];
        scene.state = { tick, phase: 'fighting', countdownTicks: 0, remainingTicks: 3600, events: [], arena: 'kkauppa', fighters };
        scene.previous.clear();
        scene.lastDrawTick = undefined;
        scene.drawFighters();
      }, phase);
      expect(await page.evaluate(() => {
        const label = (window as any).__turenkiGame.scene.getScene('StationScene').arenaTelegraph.label;
        return { visible: label.visible, text: label.text };
      })).toEqual({ visible: true, text: phase.name === 'warning'
        ? 'ARENA: SHELF ZONE · DROP 2S'
        : phase.name === 'collapse' ? 'ARENA: SHELF ZONE · ACTIVE' : 'ARENA: SHELF ZONE' });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const canvas = page.locator('#game canvas');
      const raw = await canvas.screenshot();
      const scaled = await page.evaluate(async ({ base64, width, height }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const output = document.createElement('canvas');
        output.width = width;
        output.height = height;
        const context = output.getContext('2d')!;
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, width, height);
        return output.toDataURL('image/png');
      }, { base64: raw.toString('base64'), width: 640 * size.scale, height: 360 * size.scale });
      const screenshot = Buffer.from(scaled.split(',')[1]!, 'base64');
      await writeFile(`artifacts/screenshots/m15-hazard-${style}-${size.name}-${phase.name}.png`, screenshot);
      expect([screenshot.readUInt32BE(16), screenshot.readUInt32BE(20)]).toEqual([640 * size.scale, 360 * size.scale]);
    }
  }
});

test('supported station and Mesku SVG content matches the line-ending-independent baseline', async () => {
  // SHA-256 values are computed over UTF-8 text after CRLF-to-LF normalization.
  expect(await assetSha256('assets/station/turenki-station-retro.svg'))
    .toBe('01fcb21015ce6a8666dd15738927480d85353421bf1db59a37a45d6bba0ed4c5');
  expect(await assetSha256('assets/mesku/ravintola-mesku-evening.svg'))
    .toBe('61ec56637ee9c33ebae4543a18e029f3ab148a7c3663a12fbed9d374d74779e5');
});
