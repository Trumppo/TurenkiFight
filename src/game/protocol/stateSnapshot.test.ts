import { describe, expect, it } from 'vitest';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES, createState, step } from '../simulation/step';
import { neutralPlayerInput } from './inputFrame';
import { parseGameEvent } from './gameEvent';
import { stateSnapshotFingerprint } from './fingerprint';
import {
  SCORE_BRAWL_FIGHTING_BYTES, SCORE_BRAWL_FIGHTING_FINGERPRINT, SCORE_BRAWL_KNOCKOUT_BYTES,
  SCORE_BRAWL_KNOCKOUT_FINGERPRINT, SCORE_BRAWL_MATCH_ENDED_BYTES,
} from '../../../tests/fixtures/scoreBrawlSnapshotBytes';
import {
  FOUR_PLAYER_SCORE_BRAWL_FIGHTING_BYTES, FOUR_PLAYER_SCORE_BRAWL_FIGHTING_BYTE_LENGTH,
  FOUR_PLAYER_SCORE_BRAWL_STEPPED_BYTES, FOUR_PLAYER_SCORE_BRAWL_STEPPED_BYTE_LENGTH,
} from '../../../tests/fixtures/fourPlayerScoreBrawlBytes';
import {
  BUTTON_LABELS, MAX_HEALTH, MAX_SNAPSHOT_FIGHTERS, MAX_SNAPSHOT_TICK, assertEncodableState, decodeStateSnapshot, encodeStateSnapshot,
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
  it('round-trips a full eight-fighter roster and rejects nine', () => {
    const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
    const state = createState(ids, 'fighting');
    const encoded = encodeStateSnapshot({ version: 1, state });
    expect(decodeStateSnapshot(encoded).state.fighters.map(fighter => fighter.id)).toEqual(ids);
    const ninth = { ...state.fighters[0], id: 'P9' };
    expect(() => parseStateSnapshot({ version: 1, state: { ...state, fighters: [...state.fighters, ninth] } }))
      .toThrow(/Malformed/);
  });
  it('rejects oversized roster and event history', () => {
    const state = createState(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'], 'fighting');
    const ninth = { ...state.fighters[0], id: 'P9' };
    const event = { tick: state.tick, type: 'MatchStarted' as const };
    for (const bad of [
      { ...state, fighters: [...state.fighters, ninth] },
      { ...state, events: Array(65).fill(event) },
    ]) expect(() => parseStateSnapshot({ version: 1, state: bad })).toThrow();
  });

  it('keeps four-player Score Brawl snapshot bytes identical after the cap change', () => {
    const ids = ['P1', 'P2', 'P3', 'P4'];
    const encoded = encodeStateSnapshot({ version: 1, state: createState(ids, 'fighting') });
    expect(encoded).toBe(FOUR_PLAYER_SCORE_BRAWL_FIGHTING_BYTES);
    expect(new TextEncoder().encode(encoded).byteLength).toBe(FOUR_PLAYER_SCORE_BRAWL_FIGHTING_BYTE_LENGTH);
    expect(stateSnapshotFingerprint({ version: 1, state: createState(ids, 'fighting') }))
      .toBe('4461ff9a');

    let stepped = createState(ids, 'fighting');
    for (let tick = 0; tick < 300; tick++) stepped = step(stepped, []);
    expect(encodeStateSnapshot({ version: 1, state: stepped })).toBe(FOUR_PLAYER_SCORE_BRAWL_STEPPED_BYTES);
    expect(new TextEncoder().encode(
      encodeStateSnapshot({ version: 1, state: stepped }),
    ).byteLength).toBe(FOUR_PLAYER_SCORE_BRAWL_STEPPED_BYTE_LENGTH);
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
        punch: tick % 5 === 0, kick: tick % 7 === 0, jumpkick: tick % 11 === 0, grab: tick % 13 === 0,
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
      withFighter(fighting(), { hitsReceived: Number.MAX_SAFE_INTEGER - (MAX_SNAPSHOT_FIGHTERS - 1) }),
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
    state = withFighter(state, { x: 120, y: 148, health: 10 }, 1);
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

describe('M7 optional mode fields (ADR 0002)', () => {
  const lms = () => createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'last-man-standing' });
  const deathmatch = () => createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
  const without = (fighter: Record<string, unknown>, key: string) =>
    Object.fromEntries(Object.entries(fighter).filter(([name]) => name !== key));

  it('keeps the captured Score Brawl fixture bytes byte-identical', () => {
    const base = createState(['P1', 'P2'], 'fighting');
    expect(encodeStateSnapshot({ version: 1, state: base })).toBe(SCORE_BRAWL_FIGHTING_BYTES);
    expect(stateSnapshotFingerprint({ version: 1, state: base })).toBe(SCORE_BRAWL_FIGHTING_FINGERPRINT);

    let ko = withFighter(base, { x: 100, y: 148 });
    ko = withFighter(ko, { x: 120, y: 148, health: 10, facing: -1 }, 1);
    for (let tick = 0; tick < 10; tick++) {
      ko = step(ko, [{ playerId: 'P1', moveX: 0, moveY: 0, jump: false, punch: tick === 0 }]);
    }
    expect(encodeStateSnapshot({ version: 1, state: ko })).toBe(SCORE_BRAWL_KNOCKOUT_BYTES);
    expect(stateSnapshotFingerprint({ version: 1, state: ko })).toBe(SCORE_BRAWL_KNOCKOUT_FINGERPRINT);

    const ended = step({ ...base, remainingTicks: 1 }, []);
    expect(encodeStateSnapshot({ version: 1, state: ended })).toBe(SCORE_BRAWL_MATCH_ENDED_BYTES);
    // The Score Brawl event stream stays exactly `{ tick, type }`.
    expect(JSON.parse(SCORE_BRAWL_MATCH_ENDED_BYTES).state.events).toEqual([{ tick: 1, type: 'MatchEnded' }]);
  });

  it('round-trips Deathmatch counters and the mode id', () => {
    let state = deathmatch();
    state = step(state, []);
    const encoded = encodeStateSnapshot({ version: 1, state });
    const decoded = decodeStateSnapshot(encoded);
    expect(decoded.state.mode).toBe('deathmatch');
    for (const fighter of decoded.state.fighters) {
      expect(fighter.frags).toBe(0);
      expect(fighter.deaths).toBe(0);
      expect(fighter.damageDealt).toBe(0);
      expect(fighter).not.toHaveProperty('eliminated');
    }
    expect(encodeStateSnapshot(decoded)).toBe(encoded);
  });

  it('round-trips Last Man Standing and omits the alive marker', () => {
    const live = lms();
    const encoded = encodeStateSnapshot({ version: 1, state: live });
    const raw = JSON.parse(encoded) as { state: { mode: string; fighters: Array<Record<string, unknown>> } };
    expect(raw.state.mode).toBe('last-man-standing');
    // `createState` stores `eliminated: false`, but `false` carries no
    // information and the canonical wire form omits it.
    for (const fighter of raw.state.fighters) {
      expect(Object.prototype.hasOwnProperty.call(fighter, 'eliminated')).toBe(false);
      expect(fighter.damageDealt).toBe(0);
    }
    expect(decodeStateSnapshot(encoded).state.fighters.map(fighter => fighter.eliminated))
      .toEqual([undefined, undefined]);
    expect(encodeStateSnapshot(decodeStateSnapshot(encoded))).toBe(encoded);

    const defeated = withFighter(live, { health: 0, eliminated: true }, 1);
    const eliminatedBytes = encodeStateSnapshot({ version: 1, state: defeated });
    const eliminatedRaw = JSON.parse(eliminatedBytes) as { state: { fighters: Array<Record<string, unknown>> } };
    expect(eliminatedRaw.state.fighters[1].eliminated).toBe(true);
    expect(decodeStateSnapshot(eliminatedBytes).state.fighters[1].eliminated).toBe(true);
  });

  it('rejects mode fields that do not match the state mode', () => {
    const base = fighting();
    for (const state of [
      // No mode: every mode field is unknown for Score Brawl.
      withFighter(base, { eliminated: true, health: 0 }),
      withFighter(base, { frags: 0 }),
      withFighter(base, { deaths: 0 }),
      withFighter(base, { damageDealt: 0 }),
      // An explicit Score Brawl id is not the canonical omission.
      { ...base, mode: 'score-brawl' },
      { ...base, mode: 'duel' },
      // Last Man Standing does not track a frag table.
      withFighter(lms(), { frags: 0 }),
      withFighter(lms(), { deaths: 0 }),
      // Deathmatch does not eliminate.
      withFighter(deathmatch(), { eliminated: true, health: 0 }),
      // Deathmatch always carries both counters.
      { ...deathmatch(), fighters: deathmatch().fighters.map((f, i) => i === 0 ? without(f, 'frags') : f) },
      { ...deathmatch(), fighters: deathmatch().fighters.map((f, i) => i === 0 ? without(f, 'deaths') : f) },
    ]) rejectsState(state);
  });

  it('rejects an eliminated/living mismatch and non-canonical false', () => {
    for (const state of [
      // eliminated true on a living fighter
      withFighter(lms(), { eliminated: true }),
      // zero health without elimination
      withFighter(lms(), { health: 0 }),
      // false is omitted from the canonical form, so it is not accepted
      withFighter(lms(), { eliminated: false }),
    ]) rejectsState(state);
    // The accepted form is the canonical wire form, built by encoding first.
    const canonical = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: lms() })).state;
    acceptsState(withFighter(canonical, { health: 0, eliminated: true }, 1));
  });

  it('rejects negative, fractional and unsafe mode counters', () => {
    for (const patch of [
      { frags: -1 },
      { frags: 1.5 },
      { deaths: -1 },
      { deaths: 2.5 },
      { damageDealt: -1 },
      { damageDealt: Number.MAX_SAFE_INTEGER },
    ]) {
      const mode = 'frags' in patch || 'deaths' in patch ? 'deathmatch' : 'last-man-standing';
      rejectsState(withFighter(mode === 'deathmatch' ? deathmatch() : lms(), patch));
    }
  });

  it('still rejects unknown fighter and state fields', () => {
    rejectsState({ ...deathmatch(), fighters: deathmatch().fighters.map((fighter, index) =>
      index === 0 ? { ...fighter, kills: 1 } : fighter) });
    rejectsState({ ...deathmatch(), winner: 'P1' });
    rejectsState({ ...lms(), unexpected: true });
  });

  it('accepts only coherent MatchEnded outcomes', () => {
    const dm = { ...deathmatch(), phase: 'results' as const };
    acceptsState({ ...dm, events: [{ tick: 0, type: 'MatchEnded', reason: 'frag-limit', winner: 'P1' }] });
    acceptsState({ ...dm, events: [{ tick: 0, type: 'MatchEnded', reason: 'time', winner: null }] });
    for (const event of [
      { tick: 0, type: 'MatchEnded', reason: 'time' },
      { tick: 0, type: 'MatchEnded', winner: 'P1' },
      { tick: 0, type: 'MatchEnded', reason: 'nope', winner: 'P1' },
      { tick: 0, type: 'MatchEnded', reason: 'time', winner: 'P3' },
      { tick: 0, type: 'MatchEnded', reason: 'time', winner: 'P1', extra: true },
      { tick: 0, type: 'HitLanded', attacker: 'P1', target: 'P2', move: 'punch', reason: 'time', winner: 'P1' },
    ]) rejectsState({ ...dm, events: [event] });

    // Score Brawl keeps the historical event shape: no outcome fields.
    const sb = fighting();
    acceptsState({ ...sb, events: [{ tick: 0, type: 'MatchEnded' }] });
    rejectsState({ ...sb, events: [{ tick: 0, type: 'MatchEnded', reason: 'time', winner: 'P1' }] });
  });

  it('round-trips mode events without changing the Score Brawl shape', () => {
    const dm = { ...deathmatch(), phase: 'results' as const, events: [
      { tick: 0, type: 'MatchEnded' as const, reason: 'time' as const, winner: null },
    ] };
    const encoded = encodeStateSnapshot({ version: 1, state: dm });
    expect(decodeStateSnapshot(encoded).state.events).toEqual(dm.events);
    expect(parseGameEvent({ tick: 0, type: 'MatchEnded' }, 0)).toEqual({ tick: 0, type: 'MatchEnded' });
  });
});
