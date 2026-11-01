import { MUSIC_ARRANGEMENT, midiFrequency, musicStepSeconds } from './musicArrangement';
import { PLACEHOLDER_CUE_ASSETS } from './audioAssets';
import { playAudioAsset } from './audioAssetPlayer';
import type { AudioCue } from './cueBridge';

export const AUDIO_SETTINGS_KEY = 'turenkifight.audio.v1';
export type AudioSettings = { muted: boolean; volume: number };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type TimerHandle = ReturnType<typeof setInterval>;
type AudioContextLike = AudioContext;

type AudioDirectorOptions = {
  contextFactory?: () => AudioContextLike;
  storage?: StorageLike | null;
  gestureTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  setIntervalFn?: (callback: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
  lookaheadSeconds?: number;
  schedulerIntervalMs?: number;
};

const DEFAULT_SETTINGS: AudioSettings = { muted: false, volume: 0.55 };

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readSettings(storage: StorageLike | null): AudioSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(storage.getItem(AUDIO_SETTINGS_KEY) ?? 'null') as Partial<AudioSettings> | null;
    return {
      muted: typeof parsed?.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted,
      volume: typeof parsed?.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_SETTINGS.volume,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

/** Presentation-only Web Audio owner. Context creation is deferred until a user gesture. */
export class AudioDirector {
  private readonly storage: StorageLike | null;
  private readonly contextFactory: () => AudioContextLike;
  private readonly target: AudioDirectorOptions['gestureTarget'];
  private readonly setIntervalFn: (callback: () => void, ms: number) => TimerHandle;
  private readonly clearIntervalFn: (handle: TimerHandle) => void;
  private readonly lookaheadSeconds: number;
  private readonly schedulerIntervalMs: number;
  private currentSettings: AudioSettings;
  private context: AudioContextLike | null = null;
  private masterBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private scheduler: TimerHandle | null = null;
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private readonly voiceNodes = new Set<AudioNode>();
  private nextStepTime = 0;
  private stepIndex = 0;
  private musicDuck = 1;
  private disposed = false;
  private readonly onGesture = (): void => { void this.unlock(); };

  constructor(options: AudioDirectorOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.contextFactory = options.contextFactory ?? (() => {
      const Context = globalThis.AudioContext;
      if (!Context) throw new Error('Web Audio is unavailable');
      return new Context();
    });
    this.target = options.gestureTarget === undefined
      ? (typeof window === 'undefined' ? null : window) : options.gestureTarget;
    this.setIntervalFn = options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
    this.clearIntervalFn = options.clearIntervalFn ?? (handle => clearInterval(handle));
    this.lookaheadSeconds = options.lookaheadSeconds ?? 0.12;
    this.schedulerIntervalMs = options.schedulerIntervalMs ?? 25;
    this.currentSettings = readSettings(this.storage);
    this.target?.addEventListener('keydown', this.onGesture);
    this.target?.addEventListener('pointerdown', this.onGesture);
    this.target?.addEventListener('touchstart', this.onGesture);
  }

  get settings(): AudioSettings { return { ...this.currentSettings }; }
  get activeVoiceCount(): number { return this.sources.size; }
  get contextState(): AudioContextState | 'unavailable' | 'not-created' {
    if (!this.context) return this.disposed ? 'unavailable' : 'not-created';
    return this.context.state;
  }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        this.masterBus = this.context.createGain();
        this.musicBus = this.context.createGain();
        this.sfxBus = this.context.createGain();
        this.musicBus.connect(this.masterBus);
        this.sfxBus.connect(this.masterBus);
        this.masterBus.connect(this.context.destination);
        this.applyGains();
        this.nextStepTime = this.context.currentTime;
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (this.context.state === 'running') this.startScheduler();
    } catch {
      // Audio is optional; autoplay restrictions and missing implementations never block play.
    }
  }

  setMuted(muted: boolean): void {
    this.currentSettings = { ...this.currentSettings, muted };
    this.persist();
    this.applyGains();
  }

  setVolume(volume: number): void {
    this.currentSettings = { ...this.currentSettings, volume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0)) };
    this.persist();
    this.applyGains();
  }

  playCue(cue: AudioCue): void {
    if (!this.context || !this.sfxBus || this.disposed || this.currentSettings.muted || this.context.state !== 'running') return;
    try {
      playAudioAsset(this.context, this.sfxBus, PLACEHOLDER_CUE_ASSETS[cue],
        (source, nodes) => this.track(source, nodes), this.context.currentTime + 0.004);
    } catch { /* optional effect; a failed voice must not affect gameplay */ }
  }

  setMusicDucked(ducked: boolean): void {
    this.musicDuck = ducked ? 0.22 : 1;
    this.applyGains();
  }

  /** Public for deterministic tests; the browser calls it from the lookahead interval. */
  scheduleAhead(): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus || context.state !== 'running' || this.disposed) return;
    const horizon = context.currentTime + this.lookaheadSeconds;
    while (this.nextStepTime < horizon) {
      const index = this.stepIndex % MUSIC_ARRANGEMENT.notes.length;
      const note = MUSIC_ARRANGEMENT.notes[index];
      const duration = musicStepSeconds;
      if (!this.currentSettings.muted) playAudioAsset(context, bus, { kind: 'synth', shape: {
        frequency: midiFrequency(note), duration, waveform: MUSIC_ARRANGEMENT.waveform,
        peak: MUSIC_ARRANGEMENT.level, attack: 0.004, release: 0.035,
      } }, (source, nodes) => this.track(source, nodes), this.nextStepTime);
      this.nextStepTime += musicStepSeconds;
      this.stepIndex++;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target?.removeEventListener('keydown', this.onGesture);
    this.target?.removeEventListener('pointerdown', this.onGesture);
    this.target?.removeEventListener('touchstart', this.onGesture);
    if (this.scheduler !== null) this.clearIntervalFn(this.scheduler);
    this.scheduler = null;
    for (const source of this.sources) {
      try { source.onended = null; source.stop(); } catch { /* one-shot may already have ended */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    this.sources.clear();
    for (const node of this.voiceNodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    this.voiceNodes.clear();
    for (const node of [this.musicBus, this.sfxBus, this.masterBus]) {
      try { node?.disconnect(); } catch { /* already disconnected */ }
    }
    this.musicBus = this.sfxBus = this.masterBus = null;
    const context = this.context;
    this.context = null;
    if (context) {
      try { void context.close().catch(() => undefined); } catch { /* unsupported/blocked context shutdown */ }
    }
  }

  private startScheduler(): void {
    if (this.scheduler !== null) return;
    this.scheduler = this.setIntervalFn(() => this.scheduleAhead(), this.schedulerIntervalMs);
    this.scheduleAhead();
  }

  private track(source: AudioScheduledSourceNode, ownedNodes: readonly AudioNode[] = []): void {
    this.sources.add(source);
    for (const node of ownedNodes) this.voiceNodes.add(node);
    const ended = source.onended;
    source.onended = event => {
      this.sources.delete(source);
      try { source.disconnect(); } catch { /* already disconnected */ }
      for (const node of ownedNodes) {
        this.voiceNodes.delete(node);
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
      ended?.call(source, event);
    };
  }

  private applyGains(): void {
    const now = this.context?.currentTime ?? 0;
    const master = this.masterBus?.gain;
    if (master) {
      const target = this.currentSettings.muted ? 0 : this.currentSettings.volume;
      master.cancelScheduledValues(now);
      master.setTargetAtTime(target, now, 0.018);
    }
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(0.18 * this.musicDuck, now, 0.04);
    }
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(0.3, now, 0.015);
  }

  private persist(): void {
    try { this.storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(this.currentSettings)); } catch { /* unavailable or quota-limited storage */ }
  }
}
