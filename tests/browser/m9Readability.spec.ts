import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createState } from '../../src/game/simulation/step';

const retro = process.env.VITE_VISUAL_STYLE === 'retro';
const visualDirectory = 'artifacts/visual';

type SpriteSample = {
  sourceColours: number;
  renderedColours: number;
  renderWidth: number;
  renderHeight: number;
  textureKey: string;
  tintFill: boolean;
  sourceMask: Uint8Array;
  rgb: Uint8Array;
  screenshot: Buffer;
};

async function renderedSpriteSample(page: Page, id: string, tick: number, flash = true): Promise<SpriteSample> {
  const sample = await page.evaluate(async ({ id, tick, flash }) => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state.tick = tick;
    scene.drawFighters();
    const sprite = scene.fighterSprites.get(id);
    if (!flash) sprite.clearTint().setAlpha(1);
    const source = scene.textures.get(sprite.texture.key).getSourceImage() as HTMLCanvasElement;
    const camera = scene.cameras.main;
    const left = Math.floor((sprite.x - camera.worldView.x) * camera.zoom - sprite.displayWidth * camera.zoom * sprite.originX);
    const top = Math.floor((sprite.y - camera.worldView.y) * camera.zoom - sprite.displayHeight * camera.zoom * sprite.originY);
    const width = Math.ceil(sprite.displayWidth * camera.zoom);
    const height = Math.ceil(sprite.displayHeight * camera.zoom);
    const render = scene.game.renderer;
    const captured = new Promise<HTMLImageElement>(resolve => {
      render.snapshotArea(left, top, width, height, (image: HTMLImageElement) => resolve(image));
    });
    scene.sys.render(render);
    const image = await captured;
    const pixels = document.createElement('canvas');
    pixels.width = width;
    pixels.height = height;
    const context = pixels.getContext('2d')!;
    context.drawImage(image, 0, 0, width, height);
    return {
      width: source.width,
      height: source.height,
      sourcePixels: Array.from(source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data),
      renderWidth: width,
      renderHeight: height,
      renderPixels: Array.from(context.getImageData(0, 0, width, height).data),
      textureKey: sprite.texture.key,
      tintFill: sprite.tintFill,
    };
  }, { id, tick, flash });
  const screenshotPng = await page.locator('#game canvas').screenshot();
  const colors = new Set<string>();
  const sourceColors = new Set<string>();
  const sourceMask = new Uint8Array(sample.width * sample.height);
  const rgb = new Uint8Array(sample.width * sample.height * 3);
  for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
    const sourceOffset = (y * sample.width + x) * 4;
    if (sample.sourcePixels[sourceOffset + 3] === 0) continue;
    const pixel = y * sample.width + x;
    sourceMask[pixel] = 1;
    sourceColors.add(`${sample.sourcePixels[sourceOffset]},${sample.sourcePixels[sourceOffset + 1]},${sample.sourcePixels[sourceOffset + 2]}`);
    const sx = Math.min(sample.renderWidth - 1, Math.floor((x + 0.5) * sample.renderWidth / sample.width));
    const sy = Math.min(sample.renderHeight - 1, Math.floor((y + 0.5) * sample.renderHeight / sample.height));
    const offset = (sy * sample.renderWidth + sx) * 4;
    colors.add(`${sample.renderPixels[offset]},${sample.renderPixels[offset + 1]},${sample.renderPixels[offset + 2]}`);
    rgb[pixel * 3] = sample.renderPixels[offset];
    rgb[pixel * 3 + 1] = sample.renderPixels[offset + 1];
    rgb[pixel * 3 + 2] = sample.renderPixels[offset + 2];
  }
  return {
    sourceColours: sourceColors.size,
    renderedColours: colors.size,
    renderWidth: sample.renderWidth,
    renderHeight: sample.renderHeight,
    textureKey: sample.textureKey,
    tintFill: sample.tintFill,
    sourceMask,
    rgb,
    screenshot: screenshotPng,
  };
}

function spriteDelta(reference: SpriteSample, current: SpriteSample): { meanChannelDelta: number; changedPixelShare: number } {
  let total = 0, changed = 0, samples = 0;
  for (let pixel = 0; pixel < reference.sourceMask.length; pixel++) {
    if (!reference.sourceMask[pixel]) continue;
    let pixelDelta = 0;
    for (let channel = 0; channel < 3; channel++) {
      const offset = pixel * 3 + channel;
      pixelDelta += Math.abs(reference.rgb[offset] - current.rgb[offset]);
    }
    total += pixelDelta;
    samples += 3;
    if (pixelDelta / 3 >= 16) changed++;
  }
  return { meanChannelDelta: total / samples, changedPixelShare: changed / (samples / 3) };
}

test('KO stays a detailed, marked pose and down-versus-standing survives greyscale', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.sys?.isActive());

  const state = createState({ ids: ['P5'], phase: 'fighting', mode: 'score-brawl' });
  Object.assign(state.fighters[0], { x: 192, y: 170, facing: 1, eliminated: true, health: 0 });
  await page.evaluate(state => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state = state;
    scene.drawFighters();
    scene.sys.pause();
  }, state);
  await expect(page.locator('[data-player="P5"] .hud-name')).toHaveText('P5');

  const ko = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const sprite = scene.fighterSprites.get('P5');
    const marker = scene.koMarkers.get('P5');
    return {
      texture: sprite.texture.key,
      markerVisible: marker.visible,
      markerText: marker.text,
      markerPosition: { x: marker.x, y: marker.y },
      spritePosition: { x: sprite.x, y: sprite.y },
      tint: sprite.tintTopLeft,
      tintFill: sprite.tintFill,
    };
  });
  expect(ko.texture).toMatch(/^fighter-P5-ko-/);
  expect(ko.tintFill, 'KO shading is multiplicative, not a flat fill').toBe(false);
  expect(ko.markerVisible, 'An outlined monochrome KO marker appears above the fighter').toBe(true);
  expect(ko.markerText, 'The KO marker preserves the player identifier').toBe('P5');
  expect(ko.markerPosition.x).toBe(ko.spritePosition.x + 10);
  expect(ko.markerPosition.y).toBeGreaterThan(ko.spritePosition.y - 40);
  expect(ko.markerPosition.y).toBeLessThan(ko.spritePosition.y - 16);
  const koSample = await renderedSpriteSample(page, 'P5', 0);
  console.log(`KO colour counts: source=${koSample.sourceColours}, rendered=${koSample.renderedColours}`);
  expect(koSample.renderedColours, 'The rendered KO sprite retains multiple character colours').toBeGreaterThan(1);
  expect(koSample.renderedColours, 'KO rendering retains a colour count close to its source texture')
    .toBeGreaterThanOrEqual(Math.ceil(koSample.sourceColours * 0.8));

  mkdirSync(visualDirectory, { recursive: true });
  await page.addStyleTag({ content: '#game canvas { filter: grayscale(1) !important; }' });
  await page.screenshot({ path: `${visualDirectory}/m9-ko-grayscale-640x360.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${visualDirectory}/m9-ko-grayscale-390x844.png`, fullPage: true });

  // Tight eight-player overlap with one eliminated player tests marker clutter
  // and whether a downed fighter can still be located among standing bodies.
  await page.setViewportSize({ width: 640, height: 360 });
  const crowd = createState({ ids: Array.from({ length: 8 }, (_, index) => `P${index + 1}`), phase: 'fighting', mode: 'score-brawl' });
  const placements = [
    [172, 125], [182, 128], [194, 132], [168, 137],
    [185, 141], [205, 135], [160, 139], [188, 134],
  ];
  crowd.fighters.forEach((fighter, index) => {
    [fighter.x, fighter.y] = placements[index];
  });
  Object.assign(crowd.fighters[7], { eliminated: true, health: 0 });
  await page.evaluate(state => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state = state;
    scene.drawFighters();
  }, crowd);
  await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.hitFlash.set('P4', 12);
    scene.drawFighters();
    scene.sys.pause();
  });
  const crowdVisuals = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return {
      hitTexture: scene.fighterSprites.get('P4').texture.key,
      downTag: scene.koMarkers.get('P8').text,
    };
  });
  expect(crowdVisuals.hitTexture).toMatch(/^fighter-P4-hit-/);
  expect(crowdVisuals.downTag).toBe('P8');
  await page.screenshot({ path: `${visualDirectory}/m9-eight-fighter-crowd-grayscale-640x360.png`, fullPage: true });

  // Also preserve a colour crowd capture for checking player identity and hit/KO
  // contrast against the dark floor.
  await page.addStyleTag({ content: '#game canvas { filter: none !important; }' });
  await page.screenshot({ path: `${visualDirectory}/m9-eight-fighter-crowd-640x360.png`, fullPage: true });
});

test('retro hit cycle keeps detail on five frames and a high-contrast pop on the sixth', async ({ page }) => {
  test.skip(!retro, 'Retro-only hit flash');
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__turenkiGame?.scene?.getScene('StationScene')?.sys?.isActive());
  const state = createState({ ids: ['P1'], phase: 'fighting', mode: 'score-brawl' });
  Object.assign(state.fighters[0], { x: 192, y: 170 });
  await page.evaluate(state => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    scene.state = state;
    scene.hitFlash.set('P1', 114);
    scene.drawFighters();
    scene.sys.pause();
  }, state);
  await expect.poll(() => page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').fighterSprites.get('P1').texture.key))
    .toMatch(/^fighter-P1-hit-/);

  mkdirSync(visualDirectory, { recursive: true });
  const baseline = await renderedSpriteSample(page, 'P1', 102, false);
  writeFileSync(`${visualDirectory}/m9-hit-cycle-baseline.png`, baseline.screenshot);
  const ticks = [102, 103, 104, 105, 106, 107];
  const frames: SpriteSample[] = [];
  for (const tick of ticks) {
    const frame = await renderedSpriteSample(page, 'P1', tick);
    frames.push(frame);
    writeFileSync(`${visualDirectory}/m9-hit-cycle-${tick}.png`, frame.screenshot);
  }
  const sourceColours = frames[0].sourceColours;
  const counts = frames.map(frame => frame.renderedColours);
  expect(frames[0].tintFill, 'Exactly the first frame uses the full-fill pop').toBe(true);
  expect(frames.slice(1).every(frame => !frame.tintFill), 'The remaining five frames preserve the original sprite pixels').toBe(true);
  expect(frames.every(frame => frame.sourceColours === sourceColours)).toBe(true);
  expect(counts[0], 'The one full-fill frame has a clearly reduced colour count')
    .toBeLessThan(Math.ceil(sourceColours / 2));
  for (const [index, frame] of frames.slice(1).entries()) {
    expect(frame.renderedColours, `Tick ${ticks[index + 1]} preserves at least half the ${sourceColours} source colours`)
      .toBeGreaterThanOrEqual(Math.ceil(sourceColours / 2));
  }
  const popDelta = spriteDelta(baseline, frames[0]);
  console.log(`Hit cycle pixels: source=${sourceColours}; ticks=${ticks.join(',')}; rendered=${counts.join(',')}; popDelta=${JSON.stringify(popDelta)}`);
  expect(popDelta.meanChannelDelta, `Frame 102 flash delta: ${JSON.stringify(popDelta)}`).toBeGreaterThan(35);
  expect(popDelta.changedPixelShare, `Frame 102 flash changed share: ${JSON.stringify(popDelta)}`).toBeGreaterThan(0.75);
});
