import { describe, expect, it } from 'vitest';
import { AUDIO_SETTINGS_KEY, AudioDirector } from '../src/game/presentation/audio/audioDirector';
import { PLACEHOLDER_CUE_ASSETS } from '../src/game/presentation/audio/audioAssets';
import { playAudioAsset } from '../src/game/presentation/audio/audioAssetPlayer';
import { CueBridge, cueForGameEvent, type AudioCue } from '../src/game/presentation/audio/cueBridge';
import { MUSIC_ARRANGEMENT, musicStepSeconds } from '../src/game/presentation/audio/musicArrangement';
import type { VoiceContext } from '../src/game/presentation/audio/synthVoice';
import { createState } from '../src/game/simulation/step';
import type { GameEvent, GameState } from '../src/game/simulation/types';

class FakeParam {
  value = 1;
  values: number[] = [];
  setValueAtTime(value: number): void { this.value = value; this.values.push(value); }
  linearRampToValueAtTime(value: number): void { this.value = value; }
  exponentialRampToValueAtTime(value: number): void { this.value = value; }
  setTargetAtTime(value: number): void { this.value = value; }
  cancelScheduledValues(): void {}
}

class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode): void { this.connections.push(node); }
  disconnect(): void { this.disconnected = true; this.connections = []; }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  onended: ((event: Event) => void) | null = null;
  startAt: number | undefined;
  stopAt: number | undefined;
  stopped = false;
  start(when = 0): void { this.startAt = when; }
  stop(when = 0): void { this.stopped = true; this.stopAt = when; }
}

class FakeOscillator extends FakeSource {
  frequency = new FakeParam();
  type: OscillatorType = 'sine';
}

class FakeBuffer {
  samples: Float32Array;
  constructor(length: number) { this.samples = new Float32Array(length); }
  getChannelData(): Float32Array { return this.samples; }
}

class FakeBufferSource extends FakeSource {
  buffer: AudioBuffer | null = null;
  playbackRate = new FakeParam();
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  nodes: FakeNode[] = [];
  closed = false;
  resumeCalls = 0;
  async resume(): Promise<void> { this.resumeCalls++; this.state = 'running'; }
  async close(): Promise<void> { this.closed = true; this.state = 'closed'; }
  createGain(): GainNode { const node = new FakeGain(); this.nodes.push(node); return node as unknown as GainNode; }
  createOscillator(): OscillatorNode { const node = new FakeOscillator(); this.nodes.push(node); return node as unknown as OscillatorNode; }
  createBuffer(_channels: number, length: number): AudioBuffer { return new FakeBuffer(length) as unknown as AudioBuffer; }
  createBufferSource(): AudioBufferSourceNode { const node = new FakeBufferSource(); this.nodes.push(node); return node as unknown as AudioBufferSourceNode; }
  sources(): FakeSource[] { return this.nodes.filter((node): node is FakeSource => node instanceof FakeSource); }
  finishSources(): void {
    for (const source of this.sources()) source.onended?.(new Event('ended'));
  }
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function makeState(): GameState { return createState(['P1'], 'fighting'); }

describe('audio cue bridge', () => {
  it('defines every cue as a non-silent generic placeholder', () => {
    expect(Object.keys(PLACEHOLDER_CUE_ASSETS).sort()).toEqual([
      'confirm', 'hit', 'jump', 'kick', 'ko', 'land', 'join', 'match-end', 'match-start', 'respawn', 'time-warning', 'victory',
      'item-break', 'item-pickup', 'item-throw', 'shop-bell', 'station-train',
    ].sort());
    for (const asset of Object.values(PLACEHOLDER_CUE_ASSETS)) {
      expect(asset.kind).toBe('synth');
      if (asset.kind === 'synth') {
        expect(asset.shape.duration).toBeGreaterThan(0);
        expect(asset.shape.peak).toBeGreaterThan(0);
      }
    }
  });

  it('maps simulation event types and attack moves to stable sound cues', () => {
    const events: GameEvent[] = [
      { tick: 4, type: 'HitLanded', move: 'punch' },
      { tick: 5, type: 'HitLanded', move: 'kick' },
      { tick: 6, type: 'HitLanded', move: 'jumpkick' },
      { tick: 7, type: 'Knockout' },
      { tick: 8, type: 'Respawned' },
      { tick: 9, type: 'MatchStarted' },
      { tick: 10, type: 'MatchEnded' },
    ];
    expect(events.map(cueForGameEvent)).toEqual(['hit', 'kick', 'kick', 'ko', 'respawn', 'match-start', 'match-end']);
  });

  it('emits the shared match-end cue for Score Brawl, Last Man Standing and Deathmatch', () => {
    for (const mode of ['score-brawl', 'last-man-standing', 'deathmatch'] as const) {
      const state = createState({ ids: ['P1', 'P2'], phase: 'results', mode });
      state.events = [{ tick: 7200, type: 'MatchEnded' }];
      const cues: AudioCue[] = [];
      new CueBridge(cue => cues.push(cue)).observe(state);
      expect(cues).toEqual(['match-end']);
    }
  });

  it('emits join, jump, land and time-warning only on observed transitions', () => {
    const cues: AudioCue[] = [];
    const bridge = new CueBridge(cue => cues.push(cue));
    bridge.observe(makeState());
    const joined = makeState();
    joined.fighters.push({ ...joined.fighters[0]!, id: 'P2', z: 0, vz: 0 });
    bridge.observe(joined);
    const airborne = { ...joined, tick: 2, remainingTicks: 600, fighters: joined.fighters.map(f => f.id === 'P1' ? { ...f, z: 3 } : f) };
    bridge.observe(airborne);
    bridge.observe(airborne); // same snapshot can be observed on every online render frame
    const landed = { ...airborne, tick: 3, fighters: airborne.fighters.map(f => f.id === 'P1' ? { ...f, z: 0 } : f) };
    bridge.observe(landed);
    expect(cues).toEqual(['join', 'jump', 'time-warning', 'land']);
  });

  it('emits pickup, throw and break cues from observed object snapshot transitions', () => {
    const cues: AudioCue[] = [];
    const bridge = new CueBridge(cue => cues.push(cue));
    const base = makeState();
    const ground = { id: 'O1', kind: 'bottle' as const, x: 320, y: 180, z: 0, state: 'ground' as const };
    bridge.observe({ ...base, objects: [ground] });
    bridge.observe({ ...base, tick: 1, objects: [{ ...ground, state: 'held', holder: 'P1', z: 18 }] });
    bridge.observe({ ...base, tick: 2, objects: [{ ...ground, state: 'airborne', holder: 'P1', z: 24, vx: 4, vz: 3 }] });
    bridge.observe({ ...base, tick: 3 });
    bridge.observe({ ...base, tick: 3 }); // repeated render frames do not repeat a cue
    expect(cues).toEqual(['item-pickup', 'item-throw', 'item-break']);
  });

  it('announces the initial roster only when enabled for online entry', () => {
    const cues: AudioCue[] = [];
    const bridge = new CueBridge(cue => cues.push(cue), true);
    bridge.observe(makeState());
    expect(cues).toEqual(['join']);
  });
});

describe('audio director', () => {
  it('plays a rising four-note victory phrase, distinct from the falling match-end cue', async () => {
    const context = new FakeAudioContext();
    const director = new AudioDirector({
      contextFactory: () => context as unknown as AudioContext,
      storage: null,
      gestureTarget: null,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    await director.unlock();
    const before = context.sources().length;
    director.playCue('victory');
    const victorySources = context.sources().slice(before).filter(source => source instanceof FakeOscillator) as FakeOscillator[];
    expect(victorySources).toHaveLength(4);
    expect(victorySources.map(source => source.frequency.values[0])).toEqual([523.25, 659.25, 783.99, 1046.5]);
    expect(victorySources.map(source => source.startAt)).toEqual([0.004, 0.109, 0.214, 0.319]);
    expect(PLACEHOLDER_CUE_ASSETS.victory.kind).toBe('synth');
    expect(PLACEHOLDER_CUE_ASSETS.victory).not.toEqual(PLACEHOLDER_CUE_ASSETS['match-end']);

    const afterVictory = context.sources().length;
    director.setMuted(true);
    director.playCue('victory');
    expect(context.sources()).toHaveLength(afterVictory);
    director.setMuted(false);
    context.state = 'suspended';
    director.playCue('victory');
    expect(context.sources()).toHaveLength(afterVictory);
    expect(context.resumeCalls).toBe(1); // only the explicit unlock resumed it
    director.dispose();
  });

  it('plays a future sample-buffer asset through the same replaceable voice interface', () => {
    const context = new FakeAudioContext();
    const tracked: AudioScheduledSourceNode[] = [];
    playAudioAsset(context as unknown as VoiceContext, context.destination as unknown as AudioNode, {
      kind: 'sample', buffer: { duration: 0.2 } as AudioBuffer, playbackRate: 2, peak: 0.1,
    }, source => tracked.push(source), 0.25);
    const source = context.sources()[0]!;
    expect(source.startAt).toBe(0.25);
    expect(source.stopAt).toBeCloseTo(0.35);
    expect(tracked).toHaveLength(1);
  });

  it('creates/resumes context only after unlock and safely persists mute and volume', async () => {
    const context = new FakeAudioContext();
    const storage = new MemoryStorage();
    let factoryCalls = 0;
    const director = new AudioDirector({
      contextFactory: () => { factoryCalls++; return context as unknown as AudioContext; },
      storage,
      gestureTarget: null,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    expect(factoryCalls).toBe(0);
    expect(director.contextState).toBe('not-created');
    await director.unlock();
    expect(factoryCalls).toBe(1);
    expect(context.state).toBe('running');
    const buses = (context.nodes.filter(node => node instanceof FakeGain) as FakeGain[]).slice(0, 3);
    expect(buses).toHaveLength(3);
    expect(buses[0]!.gain.value).toBe(0.55);
    expect(buses[1]!.gain.value).toBeCloseTo(0.18);
    expect(buses[2]!.gain.value).toBeCloseTo(0.3);
    director.setMuted(true);
    expect(buses[0]!.gain.value).toBe(0);
    director.setVolume(0.72);
    expect(JSON.parse(storage.getItem(AUDIO_SETTINGS_KEY)!)).toEqual({ muted: true, volume: 0.72 });
    director.setMuted(false);
    expect(buses[0]!.gain.value).toBe(0.72);
    director.dispose();
  });

  it('registers a gesture unlock callback without constructing the context early', async () => {
    const callbacks = new Map<string, () => void>();
    const target = {
      addEventListener: (name: string, callback: EventListenerOrEventListenerObject) => callbacks.set(name, callback as () => void),
      removeEventListener: (name: string) => callbacks.delete(name),
    };
    const context = new FakeAudioContext();
    let calls = 0;
    const director = new AudioDirector({
      contextFactory: () => { calls++; return context as unknown as AudioContext; },
      storage: null,
      gestureTarget: target,
      setIntervalFn: () => 2 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    expect(calls).toBe(0);
    callbacks.get('keydown')?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(context.state).toBe('running');
    director.dispose();
    expect(callbacks.size).toBe(0);
  });

  it('schedules notes inside a rolling lookahead window and keeps the loop cursor continuous', async () => {
    const context = new FakeAudioContext();
    let timer: (() => void) | undefined;
    const director = new AudioDirector({
      contextFactory: () => context as unknown as AudioContext,
      storage: null,
      gestureTarget: null,
      lookaheadSeconds: 0.12,
      setIntervalFn: callback => { timer = callback; return 3 as unknown as ReturnType<typeof setInterval>; },
      clearIntervalFn: () => undefined,
    });
    await director.unlock();
    const firstTimes = context.sources().map(source => source.startAt!).sort((a, b) => a - b);
    expect(firstTimes.length).toBeGreaterThan(0);
    expect(Math.max(...firstTimes)).toBeLessThan(0.12);

    context.currentTime = 0.5;
    timer?.();
    const allTimes = context.sources().map(source => source.startAt!).sort((a, b) => a - b);
    const newlyPlanned = allTimes.filter(time => time >= 0.12);
    expect(newlyPlanned.length).toBeGreaterThan(0);
    expect(Math.max(...newlyPlanned)).toBeLessThan(0.5 + 0.12);
    expect(musicStepSeconds).toBeCloseTo(60 / MUSIC_ARRANGEMENT.tempoBpm / MUSIC_ARRANGEMENT.stepsPerBeat);
    director.dispose();
  });

  it('stops scheduler and disconnects all scheduled sources and buses on cleanup', async () => {
    const context = new FakeAudioContext();
    let cleared: ReturnType<typeof setInterval> | null = null;
    const director = new AudioDirector({
      contextFactory: () => context as unknown as AudioContext,
      storage: null,
      gestureTarget: null,
      setIntervalFn: () => 9 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: handle => { cleared = handle; },
    });
    await director.unlock();
    const sources = context.sources();
    expect(sources.length).toBeGreaterThan(0);
    director.dispose();
    expect(cleared).toBe(9 as unknown as ReturnType<typeof setInterval>);
    expect(sources.every(source => source.stopped && source.disconnected)).toBe(true);
    expect(context.nodes.filter(node => node instanceof FakeGain).every(node => node.disconnected)).toBe(true);
    expect(context.closed).toBe(true);
    expect(director.contextState).toBe('unavailable');
  });

  it('releases one-shot effect nodes as matches repeat', async () => {
    const context = new FakeAudioContext();
    const director = new AudioDirector({
      contextFactory: () => context as unknown as AudioContext,
      storage: null,
      gestureTarget: null,
      setIntervalFn: () => 7 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    await director.unlock();
    for (let match = 0; match < 4; match++) {
      for (const cue of ['hit', 'kick', 'jump', 'land', 'ko', 'respawn'] as const) director.playCue(cue);
      context.finishSources();
      expect(director.activeVoiceCount).toBe(0);
      expect(context.sources().every(source => source.disconnected)).toBe(true);
      expect(context.nodes.filter(node => node instanceof FakeGain).every((node, index) => index < 3 || node.disconnected)).toBe(true);
    }
    director.dispose();
  });

  it('uses the separately persisted settings on a subsequent director and tolerates missing audio', async () => {
    const storage = new MemoryStorage();
    storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ muted: true, volume: 0.32 }));
    const unavailable = new AudioDirector({ contextFactory: () => { throw new Error('no audio'); }, storage, gestureTarget: null });
    expect(unavailable.settings).toEqual({ muted: true, volume: 0.32 });
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    const restoredContext = new FakeAudioContext();
    const restored = new AudioDirector({
      contextFactory: () => restoredContext as unknown as AudioContext,
      storage,
      gestureTarget: null,
      setIntervalFn: () => 4 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    await restored.unlock();
    const master = restoredContext.nodes.find(node => node instanceof FakeGain) as FakeGain;
    expect(restored.settings).toEqual({ muted: true, volume: 0.32 });
    expect(master.gain.value).toBe(0);
    restored.dispose();
    unavailable.setMuted(false);
    expect(JSON.parse(storage.getItem(AUDIO_SETTINGS_KEY)!)).toEqual({ muted: false, volume: 0.32 });
    unavailable.dispose();
  });

  it('defines the shop bell as a quiet two-note presentation cue', async () => {
    const context = new FakeAudioContext();
    const director = new AudioDirector({
      contextFactory: () => context as unknown as AudioContext,
      storage: null,
      gestureTarget: null,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    await director.unlock();
    const before = context.sources().length;
    director.playCue('shop-bell');
    const notes = context.sources().slice(before).filter(source => source instanceof FakeOscillator) as FakeOscillator[];
    expect(notes.map(source => source.frequency.values[0])).toEqual([784, 988]);
    director.dispose();
  });

  it('keeps the station event cue procedural and silent while muted', async () => {
    const context = new FakeAudioContext();
    const director = new AudioDirector({
      contextFactory: () => context as unknown as AudioContext,
      storage: null,
      gestureTarget: null,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });
    await director.unlock();
    director.setMuted(true);
    const before = context.sources().length;
    director.playCue('station-train');
    expect(context.sources()).toHaveLength(before);
    director.dispose();
  });
});
