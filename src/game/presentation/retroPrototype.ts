import Phaser from 'phaser';
import { fighterKey, POSES, FRAMES_PER_POSE } from './fighterSprites';

/** Presentation-only opt-in; no simulation imports. */
export const RETRO_PREVIEW = import.meta.env.VITE_VISUAL_STYLE === 'retro';
export const RETRO_STATION_PATH = 'assets/station/turenki-station-retro.svg';
export const RETRO_PALETTE = {
  ink: '#151c28', outline: '#27313b', skin: '#dca47f', light: '#ffd4a0',
  hair: '#4b342d', coat: '#9c3d3e', coatLight: '#df7654',
  jeans: '#344e6a', jeansLight: '#7990a0', boot: '#292d35', gold: '#f1c978',
} as const;

/** 32x48 detail pass: 1px facial highlights and fabric shading, 2px broad contours.
 * 320x180 remains the *background* art grid, not a limit on fighter detail.
 * Foot anchor remains bottom-centre, all texture keys and frames unchanged.
 */
export function createRetroP1Textures(scene: Phaser.Scene): void {
  const C = RETRO_PALETTE;
  for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
    const key = fighterKey('P1', pose, frame);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, 32, 48);
    if (!tex) throw new Error('Cannot allocate retro texture ' + key);
    const g = tex.context;
    g.imageSmoothingEnabled = false;
    const r = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(Math.round(x), Math.round(y), w, h);
    };
    const move = pose === 'walk' || pose === 'depth';
    const stride = move ? [0, 3, 0, -3][frame] : 0;
    const bounce = pose === 'idle' ? [0, 0, -1, 0][frame] : move ? [0, -1, 0, -1][frame] : 0;
    const air = pose === 'jump' || pose === 'jumpkick';
    const lift = air ? [1, 3, 5, 2][frame] : 0;
    const recoil = pose === 'hit' ? [-2, -3, -1, 0][frame] : 0;
    const thrust = pose === 'punch' || pose === 'jumpkick' ? [1, 4, 7, 2][frame] : 0;
    const kicking = pose === 'kick' || pose === 'jumpkick';
    const kick = kicking ? [0, 4, 8, 3][frame] : 0;
    const dy = bounce - lift + (pose === 'hit' ? 2 : 0);
    const dx = recoil;
    if (pose === 'ko') {
      // Sideways collapsed silhouette; never use the standing foot position.
      r(2, 38, 28, 7, C.ink);
      r(4, 39, 17, 4, C.coat); r(6, 39, 6, 1, C.coatLight);
      r(20, 37, 9, 7, C.ink); r(21, 38, 7, 5, C.skin);
      r(22, 38, 6, 2, C.hair); r(4, 44, 9, 2, C.boot);
      r(13, 44, 8, 2, C.jeans);
    } else {
      // Anatomical two-leg stance, stepped boots and trousers with fabric folds.
      const left = 9 + stride;
      const right = 19 - stride;
      r(left - 1, 32 + dy, 9, 12, C.ink);
      r(right - 1, 32 + dy, 9, 12, C.ink);
      r(left, 33 + dy, 6, 8, C.jeans);
      r(right, 33 + dy, 6, 8, C.jeans);
      r(left + 1, 35 + dy, 2, 5, C.jeansLight);
      r(right + 3, 34 + dy, 2, 5, C.jeansLight);
      r(left - 2, 42 + dy, 10, 3, C.boot);
      r(right - 1, 42 + dy, 10, 3, C.boot);
      r(left - 2, 44 + dy, 10, 1, C.ink);
      r(right - 1, 44 + dy, 10, 1, C.ink);
      // Silhouette: broad shoulders, tapered red jacket, shadowed sleeves.
      r(6 + dx, 18 + dy, 20, 17, C.ink);
      r(8 + dx, 20 + dy, 16, 13, C.coat);
      r(9 + dx, 21 + dy, 4, 10, C.coatLight);
      r(13 + dx, 21 + dy, 2, 12, C.outline);
      r(16 + dx, 21 + dy, 2, 11, C.gold);
      r(21 + dx, 22 + dy, 2, 8, C.coatLight);
      r(9 + dx, 31 + dy, 14, 2, C.outline);
      r(10 + dx, 33 + dy, 12, 2, C.jeans);
      // Neck and original recognizable face: jaw, nose, eyes, eyebrows, moustache.
      r(13 + dx, 16 + dy, 7, 5, C.skin);
      r(10 + dx, 5 + dy, 14, 14, C.ink);
      r(12 + dx, 7 + dy, 10, 10, C.skin);
      r(12 + dx, 12 + dy, 2, 4, '#b67c60');
      r(21 + dx, 12 + dy, 2, 3, '#b67c60');
      r(12 + dx, 5 + dy, 11, 4, C.hair);
      r(10 + dx, 7 + dy, 3, 7, C.hair);
      r(21 + dx, 7 + dy, 3, 3, C.hair);
      r(13 + dx, 10 + dy, 3, 1, C.hair);
      r(19 + dx, 10 + dy, 3, 1, C.hair);
      r(14 + dx, 11 + dy, 1, 2, C.ink);
      r(20 + dx, 11 + dy, 1, 2, C.ink);
      r(17 + dx, 12 + dy, 2, 3, C.light);
      r(16 + dx, 15 + dy, 5, 1, C.hair);
      r(17 + dx, 17 + dy, 3, 1, '#a66c58');
      r(13 + dx, 8 + dy, 3, 1, '#7b5340');
      // Left guard arm and glove; right arm extends across punch keyframes.
      r(4 + dx, 21 + dy, 5, 12, C.ink);
      r(5 + dx, 22 + dy, 3, 8, C.coatLight);
      r(4 + dx, 31 + dy, 6, 4, C.skin);
      const armX = 23 + dx;
      const armY = (thrust ? 21 : 24) + dy;
      r(armX, armY, 4 + thrust, 5, C.ink);
      r(armX, armY + 1, 3 + thrust, 3, C.coatLight);
      r(Math.min(28, armX + 2 + thrust), armY, 3, 5, C.skin);
      if (kicking) {
        // Clear forward knee and sole, at the expense of the standing leg.
        r(19, 33 + dy, Math.min(11, 5 + kick), 7, C.ink);
        r(21, 34 + dy, Math.min(9, 3 + kick), 4, C.jeansLight);
        r(Math.min(28, 23 + kick), 33 + dy, 4, 7, C.boot);
      }
      if (pose === 'hit') {
        r(2, 14, 4, 4, C.gold); r(0, 19, 3, 2, C.light);
        r(27, 10, 3, 2, C.gold);
      }
      if (pose === 'respawn') {
        g.globalAlpha = 0.2 + frame * 0.18;
        r(7, 3, 19, 42, C.gold);
        g.globalAlpha = 1;
      }
    }
    tex.refresh();
  }
}
