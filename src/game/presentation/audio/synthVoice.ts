export type VoiceShape = {
  readonly frequency: number;
  readonly duration: number;
  readonly waveform?: OscillatorType;
  readonly peak?: number;
  readonly attack?: number;
  readonly release?: number;
  readonly pitchDrop?: number;
  readonly noise?: number;
  readonly noiseDuration?: number;
};

export type VoiceContext = Pick<BaseAudioContext,
  'currentTime' | 'sampleRate' | 'createOscillator' | 'createGain' | 'createBuffer' | 'createBufferSource'>;

/** Creates an envelope-shaped oscillator/noise voice without coupling to any asset format. */
export function createSynthVoice(
  context: VoiceContext,
  destination: AudioNode,
  shape: VoiceShape,
  track: (source: AudioScheduledSourceNode, ownedNodes?: readonly AudioNode[]) => void,
  when = context.currentTime,
): void {
  const duration = Math.max(0.025, shape.duration);
  const attack = Math.min(Math.max(0.003, shape.attack ?? 0.008), duration / 3);
  const release = Math.min(Math.max(0.012, shape.release ?? duration * 0.35), duration / 2);
  const peak = Math.max(0.0001, shape.peak ?? 0.15);
  const amp = context.createGain();
  const osc = context.createOscillator();
  osc.type = shape.waveform ?? 'square';
  osc.frequency.setValueAtTime(Math.max(20, shape.frequency), when);
  if (shape.pitchDrop) osc.frequency.exponentialRampToValueAtTime(Math.max(20, shape.frequency * shape.pitchDrop), when + duration * 0.7);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(peak, when + attack);
  amp.gain.setValueAtTime(peak, when + Math.max(attack, duration - release));
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(amp);
  amp.connect(destination);
  osc.onended = () => { try { osc.disconnect(); amp.disconnect(); } catch { /* already disconnected */ } };
  track(osc, [amp]);
  osc.start(when);
  osc.stop(when + duration + 0.005);

  const noiseLevel = shape.noise ?? 0;
  if (noiseLevel > 0) {
    const noiseDuration = Math.max(0.02, Math.min(shape.noiseDuration ?? duration * 0.4, duration));
    const frameCount = Math.max(1, Math.ceil(context.sampleRate * noiseDuration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    // Fixed-seed noise keeps voice construction reproducible and avoids Math.random side effects.
    let seed = 0x51f15e;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = ((seed / 0xffffffff) * 2 - 1) * 0.7;
    }
    const noise = context.createBufferSource();
    const noiseGain = context.createGain();
    noise.buffer = buffer;
    noiseGain.gain.setValueAtTime(Math.max(0.0001, noiseLevel), when);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + noiseDuration);
    noise.connect(noiseGain);
    noiseGain.connect(destination);
    noise.onended = () => { try { noise.disconnect(); noiseGain.disconnect(); } catch { /* already disconnected */ } };
    track(noise, [noiseGain]);
    noise.start(when);
    noise.stop(when + noiseDuration + 0.005);
  }
}
