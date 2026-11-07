import type { AudioCue } from './cueBridge';
import type { VoiceShape } from './synthVoice';

/**
 * Replaceable audio-asset boundary. Current cue definitions are deliberately
 * generic synthesized placeholders; a later mixer can switch any entry to a
 * decoded sample buffer without changing cue callers or scene wiring.
 */
export type AudioVoiceAsset =
  | {
    readonly kind: 'synth';
    readonly shape: VoiceShape;
    /** Optional short melodic phrase, scheduled as individual procedural notes. */
    readonly notes?: readonly { readonly frequency: number; readonly offset: number }[];
  }
  | { readonly kind: 'sample'; readonly buffer: AudioBuffer; readonly playbackRate?: number; readonly peak?: number };

/** Every cue has an explicit, intentionally simple placeholder definition. */
export const PLACEHOLDER_CUE_ASSETS: Readonly<Record<AudioCue, AudioVoiceAsset>> = {
  hit: { kind: 'synth', shape: { frequency: 300, duration: 0.06, waveform: 'square', peak: 0.12, attack: 0.003, release: 0.025, noise: 0.04, noiseDuration: 0.025 } },
  kick: { kind: 'synth', shape: { frequency: 165, duration: 0.095, waveform: 'triangle', peak: 0.15, attack: 0.003, release: 0.03, pitchDrop: 0.72, noise: 0.08, noiseDuration: 0.055 } },
  jump: { kind: 'synth', shape: { frequency: 540, duration: 0.09, waveform: 'square', peak: 0.095 } },
  land: { kind: 'synth', shape: { frequency: 112, duration: 0.11, waveform: 'triangle', peak: 0.12, noise: 0.055, noiseDuration: 0.06 } },
  ko: { kind: 'synth', shape: { frequency: 220, duration: 0.18, waveform: 'square', peak: 0.13, pitchDrop: 0.72, noise: 0.04, noiseDuration: 0.08 } },
  respawn: { kind: 'synth', shape: { frequency: 680, duration: 0.11, waveform: 'triangle', peak: 0.1 } },
  join: { kind: 'synth', shape: { frequency: 760, duration: 0.065, waveform: 'square', peak: 0.085 } },
  'match-start': { kind: 'synth', shape: { frequency: 880, duration: 0.14, waveform: 'square', peak: 0.11 } },
  'time-warning': { kind: 'synth', shape: { frequency: 990, duration: 0.075, waveform: 'square', peak: 0.095, noise: 0.02, noiseDuration: 0.035 } },
  'match-end': { kind: 'synth', shape: { frequency: 350, duration: 0.2, waveform: 'triangle', peak: 0.11, pitchDrop: 0.78 } },
  victory: {
    kind: 'synth',
    shape: { frequency: 523.25, duration: 0.12, waveform: 'square', peak: 0.12, attack: 0.004, release: 0.035 },
    notes: [
      { frequency: 523.25, offset: 0 },
      { frequency: 659.25, offset: 0.105 },
      { frequency: 783.99, offset: 0.21 },
      { frequency: 1046.5, offset: 0.315 },
    ],
  },
  confirm: { kind: 'synth', shape: { frequency: 620, duration: 0.06, waveform: 'square', peak: 0.075 } },
  'item-pickup': { kind: 'synth', shape: { frequency: 740, duration: 0.055, waveform: 'triangle', peak: 0.075, attack: 0.002, release: 0.02 } },
  'item-throw': { kind: 'synth', shape: { frequency: 430, duration: 0.085, waveform: 'square', peak: 0.09, pitchDrop: 0.68, noise: 0.025, noiseDuration: 0.035 } },
  'item-break': { kind: 'synth', shape: { frequency: 185, duration: 0.12, waveform: 'triangle', peak: 0.105, pitchDrop: 0.52, noise: 0.08, noiseDuration: 0.07 } },
  'shop-bell': {
    kind: 'synth',
    shape: { frequency: 784, duration: 0.15, waveform: 'triangle', peak: 0.07, attack: 0.004, release: 0.07 },
    notes: [{ frequency: 784, offset: 0 }, { frequency: 988, offset: 0.09 }],
  },
  'station-train': {
    kind: 'synth',
    shape: { frequency: 392, duration: 0.24, waveform: 'triangle', peak: 0.055, attack: 0.012, release: 0.12 },
    notes: [{ frequency: 392, offset: 0 }, { frequency: 523.25, offset: 0.15 }],
  },
};
