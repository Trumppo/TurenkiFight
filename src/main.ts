import Phaser from 'phaser';
import { StationScene } from './game/presentation/StationScene';
import './style.css';

new Phaser.Game({
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
