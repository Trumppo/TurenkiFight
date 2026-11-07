import { describe, expect, it } from 'vitest';
import { arenaRules, hazardPhaseAt, hazardWarningStart } from '../simulation/arenas';
import { hazardDamagePreemptedByKnockout, observedHazardDamage } from './arenaTelegraph';
import { createState } from '../simulation/step';

const hazard = arenaRules('kkauppa').hazard;

describe('K-kauppa simulation-tick telegraph', () => {
  it('shares the rules table warning and active boundaries on the global tick', () => {
    expect(hazard).not.toBeNull();
    expect(hazardWarningStart(hazard!)).toBe(2400);
    expect(hazardPhaseAt(2399, hazard)).toBe('idle');
    expect(hazardPhaseAt(2400, hazard)).toBe('warning');
    expect(hazardPhaseAt(2579, hazard)).toBe('warning');
    expect(hazardPhaseAt(2580, hazard)).toBe('active');
    expect(hazardPhaseAt(2699, hazard)).toBe('active');
    expect(hazardPhaseAt(2700, hazard)).toBe('idle');
    // The 180-tick countdown is included: the first warning appears at 40 s
    // global, i.e. after 37 s of fighting. Damage begins at 43 s global.
    expect(hazardPhaseAt(180 + 2220, hazard)).toBe('warning');
    expect(hazardPhaseAt(180 + 2400, hazard)).toBe('active');
  });

  it('recognizes observed damage only on the active cadence and inside the band', () => {
    expect(observedHazardDamage(2579, 2580, 'kkauppa', true, 100, 99, 140, 140)).toBe(true);
    expect(observedHazardDamage(2579, 2580, 'kkauppa', true, 100, 99, 157, 157)).toBe(false);
    expect(observedHazardDamage(2579, 2580, undefined, true, 100, 99, 140, 140)).toBe(false);
    expect(observedHazardDamage(2399, 2400, 'kkauppa', true, 100, 99, 140, 140)).toBe(false);
  });

  it('does not mislabel a combat or Deathmatch-zone knockout as shelf damage', () => {
    const state = createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch', arena: 'kkauppa' });
    const fighter = state.fighters[0]!;
    state.tick = 2580;
    fighter.x = 16;
    fighter.y = 140;
    fighter.health = 0;
    fighter.koTimer = 180;
    expect(hazardDamagePreemptedByKnockout(state, fighter)).toBe(true);

    fighter.x = 100;
    state.events = [{ tick: 2580, type: 'Knockout', attacker: 'P2', target: 'P1' }];
    expect(hazardDamagePreemptedByKnockout(state, fighter)).toBe(true);
  });
});
