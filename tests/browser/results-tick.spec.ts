import { expect, test } from '@playwright/test';

import { enterLocalGame } from './titleFlow';
/**
 * QA finding F2 (docs/visual/M8_QA_REPORT_2026-11-02.md): after the match
 * reached `results`, the presentation loop kept calling `step`, so the
 * reported `state.tick` drifted past the tick recorded on the MatchEnded
 * event (7380 in the Score Brawl measurement). These checks pin the frozen
 * results tick, the results text and the rematch path.
 */
type ResultsFighter = { id: string; frags?: number; deaths?: number };
type ResultsState = {
  phase: string;
  tick: number;
  remainingTicks: number;
  events: Array<{ tick: number; type: string; reason?: string; winner?: string | null }>;
  fighters: ResultsFighter[];
};

test('reported tick stays at the match-end tick across frames in results, then rematch starts', async ({ page }) => {
  await enterLocalGame(page, '/');
  await expect(page.locator('#game canvas')).toBeVisible();

  const measured = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene') as {
      state: ResultsState;
      update: (time: number, delta: number) => void;
      keys: Record<string, { isDown: boolean }>;
    };
    const phaseNow = () => scene.state.phase;
    // Lobby -> match through the scene's normal keyboard adapter: P2 joins,
    // then the host starts. Fixed 17 ms calls keep this independent of rAF.
    scene.keys.SHIFT.isDown = true;
    scene.update(0, 17);
    scene.keys.SHIFT.isDown = false;
    scene.update(0, 17);
    if (scene.state.fighters.length !== 2) throw new Error('P2 did not join');
    scene.keys.ENTER.isDown = true;
    scene.update(0, 17);
    scene.keys.ENTER.isDown = false;
    scene.update(0, 17);
    if (phaseNow() !== 'countdown') throw new Error('Match did not start');

    // Play the real 120-second match with the real fixed-step accumulator.
    // 250 ms advances at most 15 ticks; 650 batches cover countdown + match.
    let batches = 0;
    while (phaseNow() !== 'results') {
      scene.update(0, 250);
      if (++batches > 650) throw new Error('Match did not reach results');
    }
    const endEvent = scene.state.events.find((event: { type: string }) => event.type === 'MatchEnded');
    const settledTick = scene.state.tick;
    const samples: Array<{ tick: number; phase: string; timer: string | null; status: string | null }> = [];
    for (let frame = 0; frame < 6; frame++) {
      // If results were still stepped, this would advance 15 ticks per frame.
      scene.update(0, 250);
      samples.push({
        tick: scene.state.tick,
        phase: scene.state.phase,
        timer: document.getElementById('match-timer')?.textContent ?? null,
        status: document.getElementById('match-status')?.textContent ?? null,
      });
    }

    // Rematch must still leave results and reset the authoritative tick.
    scene.keys.ENTER.isDown = true;
    scene.update(0, 17);
    scene.keys.ENTER.isDown = false;
    scene.update(0, 250);
    return {
      endEventTick: endEvent?.tick ?? null,
      settledTick,
      samples,
      rematch: {
        phase: scene.state.phase,
        tick: scene.state.tick,
        remainingTicks: scene.state.remainingTicks,
      },
    };
  });

  expect(measured.endEventTick).toBe(7380);
  expect(measured.settledTick).toBe(7380);
  expect(measured.samples).toHaveLength(6);
  for (const sample of measured.samples) {
    expect(sample.tick).toBe(7380);
    expect(sample.phase).toBe('results');
    expect(sample.timer).toBe('00:00');
    expect(sample.status).toContain('RESULTS');
    expect(sample.status).toContain('ENTER: REMATCH');
  }

  expect(measured.rematch.phase).toBe('countdown');
  expect(measured.rematch.tick).toBeGreaterThan(0);
  expect(measured.rematch.tick).toBeLessThan(180);
  expect(measured.rematch.remainingTicks).toBe(7200);
});

test('results phase keeps its authoritative tick, winner and reason while frames run', async ({ page }) => {
  await enterLocalGame(page, '/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const samples = await page.evaluate(async () => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene') as {
      state: ResultsState;
      selectedMode: string;
      update: (time: number, delta: number) => void;
      drawFighters: () => void;
    };
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    scene.selectedMode = 'deathmatch';
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'results', mode: 'deathmatch' }) as unknown as ResultsState;
    state.tick = 7200;
    state.fighters[0].frags = 20;
    state.fighters[0].deaths = 1;
    state.fighters[1].frags = 3;
    state.fighters[1].deaths = 2;
    state.events = [{ tick: 7200, type: 'MatchEnded', reason: 'frag-limit', winner: 'P1' }];
    scene.state = state;
    scene.drawFighters();
    const frames: Array<{ tick: number; status: string | null; events: string[] }> = [];
    for (let frame = 0; frame < 6; frame++) {
      scene.update(0, 250);
      frames.push({
        tick: scene.state.tick,
        status: document.getElementById('match-status')?.textContent ?? null,
        events: scene.state.events.map(event => event.type),
      });
    }
    return frames;
  });

  for (const sample of samples) {
    expect(sample.tick).toBe(7200);
    expect(sample.status).toContain('WINNER: P1');
    expect(sample.status).toContain('REASON: frag-limit');
    // The frozen presentation loop no longer discards the end event by
    // stepping the results state.
    expect(sample.events).toEqual(['MatchEnded']);
  }
});
