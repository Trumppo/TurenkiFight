import Phaser from 'phaser';
import { StationScene } from './game/presentation/StationScene';
import './style.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 384,
  height: 216,
  backgroundColor: '#172536',
  pixelArt: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [StationScene],
});

// Development-only browser test hook; omitted from production bundles.
if (import.meta.env.DEV) (window as typeof window & { __turenkiGame?: Phaser.Game }).__turenkiGame = game;
