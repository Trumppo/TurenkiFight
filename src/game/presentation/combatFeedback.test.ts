import { describe, expect, it } from 'vitest';
import { createState } from '../simulation/step';
import { CombatFeedbackState, MAX_LIVE_HIT_SPARKS } from './combatFeedback';

describe('presentation combat feedback', () => {
  it('creates a spark for each hit event, drops oldest above the cap, and ignores repeated observation', () => {
    const state = createState(['P1', 'P2']);
    state.tick = 10;
    state.events = [{ tick: 10, type: 'HitLanded', attacker: 'P1', target: 'P2', move: 'punch' }];
    const feedback = new CombatFeedbackState();

    feedback.observe(state);
    feedback.observe(state);
    expect(feedback.diagnostics().liveSparks).toBe(1);

    state.tick = 11;
    state.events = Array.from({ length: MAX_LIVE_HIT_SPARKS + 4 }, () => ({
      tick: 11, type: 'HitLanded' as const, attacker: 'P1', target: 'P2', move: 'punch' as const,
    }));

    feedback.observe(state);
    expect(feedback.diagnostics()).toMatchObject({ liveSparks: MAX_LIVE_HIT_SPARKS, maxLiveSparks: MAX_LIVE_HIT_SPARKS });
    feedback.observe(state);
    expect(feedback.diagnostics().liveSparks).toBe(MAX_LIVE_HIT_SPARKS);

    feedback.advance(120);
    expect(feedback.diagnostics().liveSparks).toBe(0);
  });

  it('targets a short knockout cue to the knocked-out fighter only', () => {
    const state = createState(['P1', 'P2', 'P3']);
    state.tick = 5;
    state.events = [{ tick: 5, type: 'Knockout', attacker: 'P1', target: 'P2' }];
    const feedback = new CombatFeedbackState();

    feedback.observe(state);
    expect(feedback.diagnostics().knockoutTargets).toEqual(['P2']);
    feedback.advance(90);
    expect(feedback.diagnostics().knockoutTargets).toEqual(['P2']);
    feedback.advance(150);
    expect(feedback.diagnostics().knockoutTargets).toEqual([]);
  });

  it('draws static, minimal hit and KO cues for reduced motion', () => {
    const state = createState(['P1', 'P2']);
    state.tick = 3;
    state.events = [
      { tick: 3, type: 'HitLanded', attacker: 'P1', target: 'P2', move: 'punch' },
      { tick: 3, type: 'Knockout', attacker: 'P1', target: 'P2' },
    ];
    const feedback = new CombatFeedbackState();
    feedback.observe(state);
    const calls: string[] = [];
    let graphics: Record<string, (...args: number[]) => unknown>;
    graphics = new Proxy({}, {
      get: (_target, key) => (...args: number[]) => {
        calls.push(`${String(key)}:${args.join(',')}`);
        return graphics;
      },
    });

    feedback.draw(graphics as never, true);

    expect(calls.some(call => call.startsWith('fillRect:') && call.endsWith(',4,4'))).toBe(true);
    expect(calls.some(call => call.startsWith('strokeCircle:') && call.endsWith(',7'))).toBe(true);
    expect(calls.some(call => call.startsWith('lineTo:') || call.startsWith('moveTo:'))).toBe(false);
  });
});
