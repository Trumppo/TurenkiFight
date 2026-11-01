import Phaser from 'phaser';
import { StationScene } from './game/presentation/StationScene';
import './style.css';
import { VIEWPORT } from './game/presentation/viewport';

const displayScale = new URLSearchParams(window.location.search).get('scale') === '2' ? '2' : 'fit';
if (displayScale === '2') document.body.classList.add('integer-scale-2');
const scaleSelect = document.getElementById('display-scale') as HTMLSelectElement | null;
if (scaleSelect) {
  scaleSelect.value = displayScale;
  scaleSelect.addEventListener('change', () => {
    const next = new URL(window.location.href);
    if (scaleSelect.value === '2') next.searchParams.set('scale', '2');
    else next.searchParams.delete('scale');
    window.location.assign(next);
  });
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEWPORT.renderWidth,
  height: VIEWPORT.renderHeight,
  backgroundColor: '#172536',
  pixelArt: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [StationScene],
});

// Development-only browser test hook; omitted from production bundles.
if (import.meta.env.DEV) (window as typeof window & { __turenkiGame?: Phaser.Game }).__turenkiGame = game;
