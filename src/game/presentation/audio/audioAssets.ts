import type { AudioCue } from './cueBridge';
import type { VoiceShape } from './synthVoice';

/**
 * Replaceable audio-asset boundary. Current cue definitions are deliberately
 * generic synthesized placeholders; a later mixer can switch any entry to a
 * decoded sample buffer without changing cue callers or scene wiring.
 */
export type AudioVoiceAsset =
  | { readonly kind: 'synth'; readonly shape: VoiceShape }
  | { readonly kind: 'sample'; readonly buffer: AudioBuffer; readonly playbackRate?: number; readonly peak?: number };

/** Every cue has an explicit, intentionally simple placeholder definition. */
export const PLACEHOLDER_CUE_ASSETS: Readonly<Record<AudioCue, AudioVoiceAsset>> = {
  hit: { kind: 'synth', shape: { frequency: 260, duration: 0.075, waveform: 'square', peak: 0.11, noise: 0.035, noiseDuration: 0.035 } },
  kick: { kind: 'synth', shape: { frequency: 145, duration: 0.12, waveform: 'triangle', peak: 0.14, pitchDrop: 0.7, noise: 0.075, noiseDuration: 0.07 } },
  jump: { kind: 'synth', shape: { frequency: 540, duration: 0.09, waveform: 'square', peak: 0.095 } },
  land: { kind: 'synth', shape: { frequency: 112, duration: 0.11, waveform: 'triangle', peak: 0.12, noise: 0.055, noiseDuration: 0.06 } },
  ko: { kind: 'synth', shape: { frequency: 220, duration: 0.18, waveform: 'square', peak: 0.13, pitchDrop: 0.72, noise: 0.04, noiseDuration: 0.08 } },
  respawn: { kind: 'synth', shape: { frequency: 680, duration: 0.11, waveform: 'triangle', peak: 0.1 } },
  join: { kind: 'synth', shape: { frequency: 760, duration: 0.065, waveform: 'square', peak: 0.085 } },
  'match-start': { kind: 'synth', shape: { frequency: 880, duration: 0.14, waveform: 'square', peak: 0.11 } },
  'time-warning': { kind: 'synth', shape: { frequency: 990, duration: 0.075, waveform: 'square', peak: 0.095, noise: 0.02, noiseDuration: 0.035 } },
  'match-end': { kind: 'synth', shape: { frequency: 350, duration: 0.2, waveform: 'triangle', peak: 0.11, pitchDrop: 0.78 } },
  confirm: { kind: 'synth', shape: { frequency: 620, duration: 0.06, waveform: 'square', peak: 0.075 } },
};
