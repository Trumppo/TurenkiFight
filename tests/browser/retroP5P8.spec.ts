import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const retro = process.env.VITE_VISUAL_STYLE === 'retro';
const poses = ['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn'];

test('VIS-02C retro contract covers all eight 32x48 fighters and replaces every P5-P8 classic pose', async ({ page }) => {
  test.skip(!retro, 'Retro-only P5-P8 artwork');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(async ({ poses }) => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      textures: {
        get: (key: string) => { getSourceImage: () => HTMLCanvasElement };
        remove: (key: string) => void;
      };
    };
    const rgba = (id: string, pose: string, frame: number) => {
      const image = scene.textures.get(`fighter-${id}-${pose}-${frame}`).getSourceImage();
      return { width: image.width, height: image.height, data: Array.from(image.getContext('2d')!.getImageData(0,0,32,48).data) };
    };
    const roster = ['P1','P2','P3','P4','P5','P6','P7','P8'];
    const retroPixels = new Map<string, number[]>();
    const sizes = roster.flatMap(id => poses.flatMap(pose => [0,1,2,3].map(frame => {
      const image = rgba(id,pose,frame);
      if (Number(id.slice(1)) >= 5) retroPixels.set(`${id}-${pose}-${frame}`, image.data);
      return { id, pose, frame, width: image.width, height: image.height };
    })));
    // Regenerate just the legacy expanded characters in the same Phaser texture
    // manager, compare every key, then restore the retro set for scene shutdown.
    for (const id of ['P5','P6','P7','P8']) for (const pose of poses) for (let frame = 0; frame < 4; frame++) {
      scene.textures.remove(`fighter-${id}-${pose}-${frame}`);
    }
    const fighterSpritesPath = '/src/game/presentation/fighterSprites.ts';
    const { createFighterTextures } = await import(/* @vite-ignore */ fighterSpritesPath);
    createFighterTextures(scene as never);
    const comparisons = [...retroPixels].map(([key, retro]) => {
      const [id, pose, frameText] = key.split('-');
      const classic = rgba(id,pose,Number(frameText)).data;
      let differing = 0;
      for (let i = 0; i < retro.length; i++) if (retro[i] !== classic[i]) differing++;
      return { key, differing };
    });
    const retroP5P8Path = '/src/game/presentation/retroP5P8.ts';
    const { createRetroP5P8Textures } = await import(/* @vite-ignore */ retroP5P8Path);
    createRetroP5P8Textures(scene as never);
    const masks = ['P5','P6','P7','P8'].map(id => {
      const { data } = retroPixels.get(`${id}-idle-0`) ? { data: retroPixels.get(`${id}-idle-0`)! } : { data: [] as number[] };
      return data.filter((_v,index) => index % 4 === 3).map(alpha => alpha > 0 ? 1 : 0);
    });
    const maskDiffs = masks.flatMap((a,i) => masks.slice(i+1).map(b => a.reduce<number>((sum,value,index) => sum + Number(value !== b[index]),0)));
    return { sizes, comparisons, maskDiffs };
  }, { poses });

  expect(result.sizes).toHaveLength(320);
  for (const image of result.sizes) expect([image.width,image.height], `${image.id} ${image.pose}-${image.frame}`).toEqual([32,48]);
  expect(result.comparisons).toHaveLength(160);
  for (const comparison of result.comparisons) expect(comparison.differing, comparison.key).toBeGreaterThan(0);
  expect(result.maskDiffs).toHaveLength(6);
  // Even the closest pair differs at more than 2% of the 32x48 alpha mask;
  // this catches accessories/headgear being reduced to palette-only variants.
  for (const differentPixels of result.maskDiffs) expect(differentPixels).toBeGreaterThan(25);
});

test('eight-player retro lobby and match screenshots use the P1-P8 roster', async ({ page }) => {
  test.skip(!retro, 'Eight-fighter retro visual QA');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  for (let player = 2; player <= 8; player++) {
    await page.locator(`.hud-player[data-player="P${player}"] .hud-slot-action`).click();
    await expect.poll(() => page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { fighters: unknown[] } } } } }).__turenkiGame;
      return game?.scene.getScene('StationScene').state.fighters.length ?? 0;
    })).toBe(player);
  }
  mkdirSync('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/retro-eight-fighter-lobby.png', animations: 'disabled' });
  await page.locator('#all-bots-match').click();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { phase: string; fighters: unknown[] } } } } }).__turenkiGame;
    const state = game?.scene.getScene('StationScene').state;
    return state ? { phase: state.phase, roster: state.fighters.length } : undefined;
  })).toMatchObject({ roster: 8 });
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { phase: string } } } } }).__turenkiGame;
    return game?.scene.getScene('StationScene').state.phase;
  }), { timeout: 10_000 }).toBe('fighting');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/visual/retro-eight-fighter-match.png', animations: 'disabled' });
});
