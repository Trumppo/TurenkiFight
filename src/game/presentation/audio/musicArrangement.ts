/** Placeholder-only mix controls: a plain, single-voice repeating chiptune bed. */
export const MUSIC_ARRANGEMENT = {
  tempoBpm: 104,
  stepsPerBeat: 1,
  /** MIDI pitches; each step is one plain quarter-note blip. */
  notes: [60, 64, 67, 72, 67, 64, 62, 65] as const,
  waveform: 'square' as OscillatorType,
  level: 0.09,
} as const;

export const musicStepSeconds = 60 / MUSIC_ARRANGEMENT.tempoBpm / MUSIC_ARRANGEMENT.stepsPerBeat;

export function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}
