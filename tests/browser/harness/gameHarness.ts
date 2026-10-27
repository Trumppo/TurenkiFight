import type { Page } from '@playwright/test';

export type MatchSnapshot = { phase: string; tick: number; remainingTicks: number; fighters: Array<{ id: string; score: number; health: number; koTimer: number }> };

export async function installVirtualPads(page: Page, count = 3): Promise<void> {
  await page.addInitScript((count: number) => {
    type VirtualButton = { pressed: boolean; touched: boolean; value: number };
    const makeButton = (pressed = false): VirtualButton => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });
    const pads = Array.from({ length: count }, (_, index) => ({
      id: `Harness gamepad ${index}`, index, connected: true, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => makeButton()),
      timestamp: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    Object.assign(window, { __harnessPads: pads });
  }, count);
}

export async function setPadButton(page: Page, index: number, button: number, pressed: boolean): Promise<void> {
  await page.evaluate(({ index, button, pressed }) => {
    const pads = (window as typeof window & { __harnessPads: Array<{ buttons: Array<{ pressed: boolean; touched: boolean; value: number }> }> }).__harnessPads;
    const target = pads[index]?.buttons[button];
    if (!target) throw new Error(`Missing virtual pad ${index} button ${button}`);
    target.pressed = pressed; target.touched = pressed; target.value = pressed ? 1 : 0;
  }, { index, button, pressed });
}

export async function snapshot(page: Page): Promise<MatchSnapshot> {
  return page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    if (!game) throw new Error('Phaser game not exposed');
    const scene = game.scene.getScene('StationScene') as { state: MatchSnapshot };
    return JSON.parse(JSON.stringify(scene.state)) as MatchSnapshot;
  });
}

// Advance the real scene's fixed-step accumulator, not a fake copy of the rules.
// Each 250ms call advances at most 15 simulation ticks. Phaser's render loop may
// also advance ticks, so assertions use the authoritative final phase, not wall time.
export async function advanceUntilResults(page: Page, maxBatches = 650): Promise<MatchSnapshot> {
  for (let batch = 0; batch < maxBatches; batch++) {
    const state = await page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
      const scene = game.scene.getScene('StationScene') as { update: (time: number, delta: number) => void; state: MatchSnapshot };
      if (scene.state.phase !== 'results') scene.update(0, 250);
      return { phase: scene.state.phase, tick: scene.state.tick, remainingTicks: scene.state.remainingTicks,
        fighters: scene.state.fighters.map(f => ({ id: f.id, score: f.score, health: f.health, koTimer: f.koTimer })) };
    });
    if (state.phase === 'results') return state;
  }
  throw new Error(`Match did not reach results within ${maxBatches} batches`);
}
