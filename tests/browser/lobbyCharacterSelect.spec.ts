import { test, expect, type Page } from '@playwright/test';

type CharacterDiagnostics = {
  stateJson: string;
  p1Texture: string;
  p1Character: string;
  p1Name: string;
  activeCount: number;
  p5SelectorHidden: boolean;
  textureKeys: string[];
};

const diagnostics = (page: Page) => page.evaluate<CharacterDiagnostics>(() => {
  const game = (window as typeof window & {
    __turenkiGame?: { scene: { getScene: (key: string) => any } };
  }).__turenkiGame!;
  const scene = game.scene.getScene('StationScene');
  const p1Select = document.querySelector<HTMLSelectElement>('[data-player="P1"] .hud-character-select')!;
  const p5Select = document.querySelector<HTMLSelectElement>('[data-player="P5"] .hud-character-select')!;
  return {
    stateJson: JSON.stringify({ ...scene.state, tick: 0, events: [] }),
    p1Texture: scene.fighterSprites.get('P1')?.texture.key ?? '',
    p1Character: p1Select.value,
    p1Name: document.querySelector('[data-player="P1"] .hud-name')?.textContent ?? '',
    activeCount: scene.selectedPlayerCount,
    p5SelectorHidden: p5Select.hidden || !!p5Select.parentElement?.hidden,
    textureKeys: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map(id => `fighter-${id}-idle-0`)
      .filter(key => scene.textures.exists(key)),
  };
});

test('local character selection remaps presentation only and persists', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('turenkifight.playerCount', '8');
    if (localStorage.getItem('turenkifight.characterSelections') === null) {
      localStorage.removeItem('turenkifight.characterSelections');
    }
  });
  await page.goto('/');
  await expect(page.locator('[data-player="P1"] .hud-character-select')).toBeVisible();

  // Gate B technical: prove character change does not affect simulation state (locked recommendation)
  const before = await diagnostics(page);
  await page.locator('[data-player="P1"] .hud-character-select').selectOption('P5');
  await page.waitForTimeout(100); // allow draw
  const after = await diagnostics(page);
  expect(after.stateJson).toBe(before.stateJson); // simulation state unchanged
  expect(after.p1Texture).not.toBe(before.p1Texture); // presentation changed

  await page.locator('[data-player="P1"] .hud-character-select').selectOption('P6');
  await expect.poll(() => diagnostics(page)).toMatchObject({
    p1Character: 'P6',
    p1Texture: 'fighter-P6-idle-0',
    activeCount: 8,
  });
  const after2 = await diagnostics(page);
  expect(after2.stateJson).toBe(before.stateJson);
  await expect(page.locator('[data-player="P1"] .hud-character-select')).toHaveAttribute('aria-label', 'P1 character: KIOSK VENDOR');
  expect(after2.textureKeys).toHaveLength(8);

  await page.reload();
  await expect(page.locator('[data-player="P1"] .hud-character-select')).toHaveValue('P6');
  await expect(page.locator('[data-player="P1"] .hud-character-select')).toHaveAttribute('aria-label', 'P1 character: KIOSK VENDOR');
});

test('character selectors follow the active player-count boundary', async ({ page }) => {
  await page.goto('/');
  await page.locator('#player-count').selectOption('4');
  await expect(page.locator('[data-player="P4"] .hud-character-select')).toBeVisible();
  await expect(page.locator('[data-player="P5"] .hud-character-select')).toBeHidden();
  await expect.poll(() => diagnostics(page)).toMatchObject({ activeCount: 4, p5SelectorHidden: true });

  await page.locator('[data-player="P1"] .hud-character-select').selectOption('P8');
  await page.locator('#player-count').selectOption('1');
  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => any } } }).__turenkiGame!;
    return game.scene.getScene('StationScene').state.phase;
  })).toBe('countdown');
  await expect(page.locator('[data-player="P1"] .hud-character-select')).toBeDisabled();
});
