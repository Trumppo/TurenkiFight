import { AudioDirector } from './audioDirector';

export type AudioPresentation = {
  director: AudioDirector;
  dispose(): void;
};

/** Mount compact retro controls in the page header, outside the playfield HUD. */
export function mountAudioControls(host: HTMLElement, director: AudioDirector): () => void {
  // A presentation may be mounted by the title bootstrap and then handed to a
  // scene, or a scene may be restarted by Phaser. Keep the page-level control
  // contract singular across those lifecycle transitions.
  host.querySelectorAll(':scope > .audio-controls').forEach(existing => existing.remove());
  const root = document.createElement('div');
  root.className = 'audio-controls';
  root.setAttribute('aria-label', 'Audio controls');
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.id = 'audio-mute';
  mute.className = 'audio-mute';
  const volumeLabel = document.createElement('label');
  volumeLabel.htmlFor = 'audio-volume';
  volumeLabel.className = 'audio-volume-label sr-only';
  volumeLabel.textContent = 'VOL';
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.id = 'audio-volume';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.01';
  volume.setAttribute('aria-label', 'Audio volume');
  volume.title = 'Audio volume';
  volume.value = String(director.settings.volume);

  const update = (): void => {
    mute.textContent = director.settings.muted ? 'OFF' : 'MUTE';
    mute.setAttribute('aria-label', director.settings.muted ? 'Unmute audio' : 'Mute audio');
    mute.setAttribute('aria-pressed', String(director.settings.muted));
  };
  const onMute = (): void => { director.setMuted(!director.settings.muted); update(); };
  const onVolume = (): void => director.setVolume(Number(volume.value));
  mute.addEventListener('click', onMute);
  volume.addEventListener('input', onVolume);
  update();
  root.append(mute, volumeLabel, volume);
  host.append(root);

  return () => {
    mute.removeEventListener('click', onMute);
    volume.removeEventListener('input', onVolume);
    root.remove();
  };
}

export function audioControlsHost(): HTMLElement | null {
  // The full-screen integer 2x layout hides the page header; retain controls in
  // its HUD toolbar while keeping the normal responsive layout independent.
  if (document.body.classList.contains('integer-scale-2')) {
    return document.querySelector('.hud-toolbar');
  }
  return document.querySelector('.page-header');
}

export function createAudioPresentation(host: HTMLElement | null): AudioPresentation {
  const director = new AudioDirector();
  const unmount = host ? mountAudioControls(host, director) : () => undefined;
  return {
    director,
    dispose: () => { unmount(); director.dispose(); },
  };
}
