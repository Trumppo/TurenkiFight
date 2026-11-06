import { test, expect, type Page } from '@playwright/test';

type SceneState = {
  phase: string;
  tick: number;
  objects?: Array<{ id: string; kind: string; x: number; y: number; z: number; state: string; holder?: string; spawnTick?: number }>;
  fighters: Array<{ id: string; x: number; y: number; facing: number }>;
};

type StationDebug = {
  state: SceneState;
  update: (time: number, delta: number) => void;
};

function station(page: Page): Promise<SceneState> {
  return page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => StationDebug } };
    }).__turenkiGame;
    if (!game) throw new Error('Phaser game not exposed');
    const scene = game.scene.getScene('StationScene');
    return JSON.parse(JSON.stringify(scene.state)) as SceneState;
  });
}

test('pressing T picks up a nearby bottle through the local keyboard input path', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Two keyboard players, started through the normal lobby controls.
  await page.keyboard.down('Shift');
  await expect.poll(async () => (await station(page)).fighters.length).toBe(2);
  await page.keyboard.up('Shift');
  await page.keyboard.down('Enter');
  await expect.poll(async () => (await station(page)).phase).toBe('countdown');
  await page.keyboard.up('Enter');

  // Fast-forward the real fixed-step accumulator until the fighting phase.
  await page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => StationDebug } };
    }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    for (let i = 0; i < 20 && scene.state.phase === 'countdown'; i++) scene.update(0, 250);
  });
  await expect.poll(async () => (await station(page)).phase).toBe('fighting');

  // Place one deterministic bottle in front of P1. Creating the object is test
  // setup; the pickup itself must go through the real keyboard path below.
  const before = await page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => StationDebug } };
    }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    const p1 = scene.state.fighters.find(fighter => fighter.id === 'P1')!;
    scene.state.objects = [{
      id: 'O1', kind: 'bottle', x: p1.x + p1.facing * 8, y: p1.y, z: 0,
      state: 'ground', spawnTick: scene.state.tick,
    }];
    // Proximity alone must not pick the bottle up: no input, no pickup.
    scene.update(0, 100);
    return JSON.parse(JSON.stringify(scene.state.objects)) as NonNullable<SceneState['objects']>;
  });
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({ id: 'O1', state: 'ground' });
  expect(before[0]!.holder).toBeUndefined();

  // The actual assertion: holding T must map to `grab` and pick the bottle up.
  await page.keyboard.down('t');
  await expect.poll(async () => (await station(page)).objects?.[0]?.state).toBe('held');
  const after = await station(page);
  await page.keyboard.up('t');

  expect(after.objects).toHaveLength(1);
  expect(after.objects![0]).toMatchObject({ id: 'O1', kind: 'bottle', state: 'held', holder: 'P1' });
  // Picking up is not an attack: the fighter did not inherit a move from it.
  expect(after.phase).toBe('fighting');
});
