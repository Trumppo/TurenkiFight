import { createSynthVoice, type VoiceContext } from './synthVoice';
import type { AudioVoiceAsset } from './audioAssets';

/** Shared playback boundary for current synth placeholders and future decoded sample buffers. */
export function playAudioAsset(
  context: VoiceContext,
  destination: AudioNode,
  asset: AudioVoiceAsset,
  track: (source: AudioScheduledSourceNode, ownedNodes?: readonly AudioNode[]) => void,
  when = context.currentTime,
): void {
  if (asset.kind === 'synth') {
    createSynthVoice(context, destination, asset.shape, track, when);
    return;
  }

  const source = context.createBufferSource();
  const envelope = context.createGain();
  const playbackRate = asset.playbackRate ?? 1;
  const duration = asset.buffer.duration / Math.max(0.01, playbackRate);
  const peak = asset.peak ?? 0.16;
  source.buffer = asset.buffer;
  source.playbackRate.setValueAtTime(playbackRate, when);
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.linearRampToValueAtTime(peak, when + Math.min(0.005, duration / 4));
  envelope.gain.setValueAtTime(peak, when + Math.max(0.005, duration - 0.025));
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(envelope);
  envelope.connect(destination);
  source.onended = () => { try { source.disconnect(); envelope.disconnect(); } catch { /* already disconnected */ } };
  track(source, [envelope]);
  source.start(when);
  source.stop(when + duration);
}
