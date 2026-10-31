import { describe, expect, it } from 'vitest';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES, createState, step } from '../simulation/step';
import { neutralPlayerInput } from './inputFrame';
import { parseGameEvent } from './gameEvent';
import {
  BUTTON_LABELS, MAX_HEALTH, MAX_SNAPSHOT_TICK, assertEncodableState, decodeStateSnapshot, encodeStateSnapshot,
  parseStateSnapshot,
} from './stateSnapshot';

const fighting = () => createState(['P1', 'P2'], 'fighting');
const withFighter = (
  state: ReturnType<typeof createState>,
  patch: Partial<ReturnType<typeof createState>['fighters'][number]>,
  index = 0,
) => ({ ...state, fighters: state.fighters.map((f, i) => i === index ? { ...f, ...patch } : f) });
const rejectsState = (state: unknown) =>
  expect(() => parseStateSnapshot({ version: 1, state })).toThrow();
const acceptsState = (state: unknown) =>
  expect(() => parseStateSnapshot({ version: 1, state })).not.toThrow();
const attackDuration = (move: 'punch' | 'kick' | 'jumpkick') =>
  MOVES[move].startup + MOVES[move].active + MOVES[move].recovery;
const maxAttackDuration = () =>
  Math.max(...(['punch', 'kick', 'jumpkick'] as const).map(attackDuration));

describe('M2 StateSnapshot v1', () => {
  it('round-trips a complete state with fighters and events', () => {
    const state = step(createState(['P1', 'P2'], 'countdown'), []);
    const encoded = encodeStateSnapshot({ version: 1, state });
    expect(decodeStateSnapshot(encoded)).toEqual({ version: 1, state });
  });
  it('rejects unsupported versions, duplicate players and invalid numbers', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    for (const bad of [
      { version: 2, state },
      { version: 1, state: { ...state, tick: -1 } },
      { version: 1, state: { ...state, fighters: [state.fighters[0], state.fighters[0]] } },
      { version: 1, state: { ...state, fighters: [{ ...state.fighters[0], x: Infinity }] } },
      { version: 1, state: { ...state, events: [{ tick: 999, type: 'MatchEnded' }] } },
      { version: 1, state: { ...state, unexpected: true } },
    ]) expect(() => parseStateSnapshot(bad)).toThrow();
  });
  it('rejects oversized roster and event history', () => {
    const state = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
    const fifth = { ...state.fighters[0], id: 'P5' };
    const event = { tick: state.tick, type: 'MatchStarted' as const };
    for (const bad of [
      { ...state, fighters: [...state.fighters, fifth] },
      { ...state, events: Array(65).fill(event) },
    ]) expect(() => parseStateSnapshot({ version: 1, state: bad })).toThrow();
  });

  it('rejects states that a single step would turn into unencodable state', () => {
    const base = fighting();
    for (const state of [
      { ...base, remainingTicks: 0 },
      { ...createState(['P1', 'P2'], 'countdown'), remainingTicks: 0 },
      { ...base, remainingTicks: MATCH_TICKS + 1 },
      { ...createState(['P1', 'P2'], 'countdown'), countdownTicks: COUNTDOWN_TICKS + 1 },
      { ...base, tick: MAX_SNAPSHOT_TICK + 1 },
      { ...base, tick: Number.MAX_SAFE_INTEGER },
      withFighter(base, { hitsReceived: Number.MAX_SAFE_INTEGER }),
      withFighter(base, { koCount: Number.MAX_SAFE_INTEGER }),
    ]) rejectsState(state);
  });

  it('rejects impossible fighter states derived from simulation behaviour', () => {
    const base = fighting();
    for (const patch of [
      { health: 101 },
      { health: -1 },
      { health: 50.5 },
      { z: -0.5 },
      { attackMove: 'punch' as const, attackFrames: 0 },
      { attackMove: null, attackFrames: 5 },
      { attackMove: 'punch' as const, attackFrames: attackDuration('punch') + 1 },
      { attackMove: 'jumpkick' as const, attackFrames: attackDuration('jumpkick') + 1 },
      { attackCooldown: maxAttackDuration() + 1 },
      { attackMove: 'punch' as const, attackFrames: 1, attackCooldown: maxAttackDuration() + 1 },
      { hitTargets: ['P3'] },
    ]) rejectsState(withFighter(base, patch));
  });

  /**
   * `step()` skips `a.id === t.id` before the hit-target loop and only pushes
   * the opponent it just hit, so a fighter can never list itself in
   * `hitTargets`. A self ID is a roster member, so membership checking alone
   * accepted it; the parser must reject it like an unknown ID.
   */
  it('rejects self-referential hit targets that step() can never record', () => {
    const base = fighting();
    acceptsState(withFighter(base, { hitTargets: [] }));
    acceptsState(withFighter(base, { hitTargets: ['P2'] }));
    rejectsState(withFighter(base, { hitTargets: ['P1'] }));
    // The self ID is rejected wherever it appears, not only when it is alone.
    rejectsState(withFighter(base, { hitTargets: ['P1', 'P2'] }));
    // Every fighter is checked, not only the first one.
    rejectsState(withFighter(base, { hitTargets: ['P2'] }, 1));
    // A valid opponent target still round-trips through the codec.
    const encoded = encodeStateSnapshot({ version: 1, state: withFighter(base, { hitTargets: ['P2'] }) });
    expect(decodeStateSnapshot(encoded).state.fighters[0].hitTargets).toEqual(['P2']);
  });

  it('never records a self-referential hit target during simulation', () => {
    let state = withFighter(fighting(), { x: 100, y: 148 });
    state = withFighter(state, { x: 120, y: 148 }, 1);
    for (let tick = 0; tick < 600; tick++) {
      const inputs = state.fighters.map(f => ({
        ...neutralPlayerInput(f.id),
        punch: tick % 7 === 0,
        kick: tick % 11 === 0,
      }));
      state = step(state, inputs);
      for (const fighter of state.fighters) expect(fighter.hitTargets).not.toContain(fighter.id);
      expect(() => encodeStateSnapshot({ version: 1, state })).not.toThrow();
    }
  });

  it('accepts only the button labels the simulation can record', () => {
    const base = fighting();
    acceptsState(withFighter(base, { previousButtons: [...BUTTON_LABELS] }));
    for (const label of BUTTON_LABELS) acceptsState(withFighter(base, { previousButtons: [label] }));
    acceptsState(withFighter(base, { previousButtons: [] }));
    for (const bad of [['punch', 'taunt'], ['attack'], ['Jump'], ['up'], ['punch', 'punch']]) {
      rejectsState(withFighter(base, { previousButtons: bad }));
    }
  });

  it('keeps simulation-emitted button state inside the accepted label set', () => {
    let state = fighting();
    const seen = new Set<string>();
    for (let tick = 0; tick < 120; tick++) {
      state = step(state, [{
        playerId: 'P1', moveX: 0, moveY: 0, jump: tick % 3 === 0,
        punch: tick % 5 === 0, kick: tick % 7 === 0, jumpkick: tick % 11 === 0,
      }]);
      for (const fighter of state.fighters) {
        for (const label of fighter.previousButtons) {
          seen.add(label);
          expect(BUTTON_LABELS).toContain(label);
        }
      }
      expect(() => encodeStateSnapshot({ version: 1, state })).not.toThrow();
    }
    expect(seen).toEqual(new Set(BUTTON_LABELS));
  });

  it('accepts a simulation-produced knockout state with a residual attack cooldown', () => {
    // P2 charges a punch facing away from P1, so only P1's punch can land.
    let state = withFighter(fighting(), { x: 100, y: 148 });
    state = withFighter(state, {
      x: 120, y: 148, facing: 1, health: 10,
      attackMove: 'punch', attackFrames: attackDuration('punch'), attackCooldown: attackDuration('punch'),
    }, 1);
    state = step(state, [{ ...neutralPlayerInput('P1'), punch: true }]);
    for (let tick = 0; tick < 8 && state.fighters[1].koTimer === 0; tick++) state = step(state, []);
    const ko = state.fighters[1];
    expect(ko.koTimer).toBe(180);
    expect(ko.attackMove).toBeNull();
    expect(ko.attackFrames).toBe(0);
    // The knockout path clears the move but not the cooldown captured this tick.
    expect(ko.attackCooldown).toBeGreaterThan(0);
    expect(() => decodeStateSnapshot(encodeStateSnapshot({ version: 1, state }))).not.toThrow();
  });

  it('keeps every accepted boundary snapshot encodable after exactly one step', () => {
    const cases = [
      createState(['P1', 'P2'], 'lobby'),
      createState(['P1', 'P2'], 'countdown'),
      { ...createState(['P1', 'P2'], 'countdown'), countdownTicks: 1 },
      { ...fighting(), remainingTicks: 1, tick: MAX_SNAPSHOT_TICK - 1 },
      { ...fighting(), remainingTicks: MATCH_TICKS },
      { ...createState(['P1', 'P2'], 'results'), remainingTicks: 0 },
      withFighter(fighting(), { health: 0, koTimer: 1 }),
      withFighter(fighting(), { z: 10, vz: 2.5 }),
      withFighter(fighting(), { attackMove: 'punch', attackFrames: 1, attackCooldown: 1 }),
      withFighter(fighting(), { attackMove: 'jumpkick', attackFrames: attackDuration('jumpkick'), attackCooldown: attackDuration('jumpkick'), z: 5 }),
      withFighter(fighting(), { hitsReceived: Number.MAX_SAFE_INTEGER - 3 }),
      {
        ...fighting(),
        events: [{ tick: 0, type: 'HitLanded' as const, attacker: 'P1', target: 'P2', move: 'kick' as const }],
      },
    ];
    for (const state of cases) {
      const parsed = parseStateSnapshot({ version: 1, state });
      const inputs = parsed.state.fighters.map(f => neutralPlayerInput(f.id));
      const next = step(parsed.state, inputs);
      expect(() => decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: next }))).not.toThrow();
    }
  });

  it('parses and encodes terminal snapshots for inspection but refuses to advance them', () => {
    const terminal = { ...fighting(), tick: MAX_SNAPSHOT_TICK };
    const encoded = encodeStateSnapshot({ version: 1, state: terminal });
    expect(decodeStateSnapshot(encoded)).toEqual({ version: 1, state: terminal });
    const inputs = terminal.fighters.map(f => neutralPlayerInput(f.id));
    expect(() => assertEncodableState(step(terminal, inputs))).toThrow(/not encodable/);
  });

  it('tracks simulation health and attack-duration constants', () => {
    expect(createState(['P1']).fighters[0].health).toBe(MAX_HEALTH);
    const ko = withFighter(fighting(), { health: 0, koTimer: 1 });
    expect(step(ko, []).fighters[0].health).toBe(MAX_HEALTH);
    // A knockout leaves a residual cooldown with no active move, capped by the longest move.
    acceptsState(withFighter(fighting(), { attackCooldown: maxAttackDuration() }));
    for (const move of ['punch', 'kick', 'jumpkick'] as const) {
      const frames = attackDuration(move);
      acceptsState(withFighter(fighting(), { attackMove: move, attackFrames: frames, attackCooldown: frames }));
      rejectsState(withFighter(fighting(), { attackMove: move, attackFrames: frames + 1, attackCooldown: frames + 1 }));
    }
  });

  it('applies the strict event schema to snapshot event history', () => {
    const state = fighting();
    const valid = [
      { tick: 0, type: 'MatchStarted' as const },
      { tick: 0, type: 'HitLanded' as const, attacker: 'P1', target: 'P2', move: 'punch' as const },
      { tick: 0, type: 'Knockout' as const, attacker: 'P1', target: 'P2' },
      { tick: 0, type: 'Respawned' as const, target: 'P2' },
      { tick: 0, type: 'MatchEnded' as const },
    ];
    acceptsState({ ...state, events: valid });
    for (const event of [
      { tick: 0, type: 'HitLanded', attacker: 'P1', target: 'P2' },
      { tick: 0, type: 'HitLanded', target: 'P2', move: 'punch' },
      { tick: 0, type: 'HitLanded', attacker: 'P1', target: 'P1', move: 'punch' },
      { tick: 0, type: 'Knockout', attacker: 'P1', target: 'P2', move: 'kick' },
      { tick: 0, type: 'Respawned', target: 'P2', attacker: 'P1' },
      { tick: 0, type: 'MatchEnded', target: 'P2' },
      { tick: 1, type: 'MatchEnded' },
      { tick: 0, type: 'HitLanded', attacker: 'P3', target: 'P2', move: 'punch' },
      { tick: 0, type: 'MatchEnded', extra: true },
    ]) rejectsState({ ...state, events: [event] });
  });

  it('keeps the strict event schema consistent with simulation output', () => {
    let state = withFighter(fighting(), { x: 100, y: 148 });
    state = withFighter(state, { x: 120, y: 148 }, 1);
    const seen = new Set<string>();
    for (let tick = 0; tick < 600; tick++) {
      const inputs = state.fighters.map(f => ({
        ...neutralPlayerInput(f.id),
        punch: tick % 7 === 0,
        kick: tick % 11 === 0,
      }));
      state = step(state, inputs);
      const roster = new Set(state.fighters.map(f => f.id));
      for (const event of state.events) {
        expect(parseGameEvent(event, state.tick, roster)).toEqual(event);
        seen.add(event.type);
      }
    }
    expect(seen.has('HitLanded')).toBe(true);
    expect(seen.has('Knockout')).toBe(true);
  });

  it('preserves simulation state and deterministic replay after restore', () => {
    const inputs = [{ playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: false, punch: true }];
    let original = createState(['P1', 'P2'], 'fighting');
    for (let tick = 0; tick < 30; tick++) original = step(original, tick === 0 ? inputs : []);
    let restored = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: original })).state;
    for (let tick = 0; tick < 120; tick++) {
      original = step(original, tick % 40 === 0 ? inputs : []);
      restored = step(restored, tick % 40 === 0 ? inputs : []);
    }
    expect(restored).toEqual(original);
    expect(encodeStateSnapshot({ version: 1, state: restored })).toBe(encodeStateSnapshot({ version: 1, state: original }));
  });
});
