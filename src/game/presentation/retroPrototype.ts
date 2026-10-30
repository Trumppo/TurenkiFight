import Phaser from 'phaser';
import { fighterKey, type FighterPose, POSES, FRAMES_PER_POSE } from './fighterSprites';

/** A reversible presentation-only proof. Never imports game simulation. */
export const RETRO_PREVIEW = import.meta.env.VITE_VISUAL_STYLE === 'retro';
export const RETRO_STATION_PATH = 'assets/station/turenki-station-retro.svg';
export const RETRO_PALETTE = {
  ink: '#171e29', outline: '#27313b', skin: '#e5b78e', light: '#ffd5a4',
  hair: '#49352e', coat: '#a34842', coatLight: '#d06a4c',
  jeans: '#36536b', jeansLight: '#627f95', boot: '#292d35', gold: '#f1c978',
} as const;

/** Raster art authored on a half-density pixel grid and scaled exactly 2x.
 * Output 32x48; bottom-centre origin and all legacy texture keys are retained.
 */
export function createRetroP1Textures(scene: Phaser.Scene): void {
  const S = RETRO_PALETTE;
  for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
    const key = fighterKey('P1', pose, frame);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const pixel = scene.textures.createCanvas(key, 32, 48);
    if (!pixel) throw new Error('Unable to allocate retro sprite: ' + key);
    const buffer = document.createElement('canvas');
    buffer.width = 16; buffer.height = 24;
    const g = buffer.getContext('2d')!;
    const r = (x: number, y: number, w: number, h: number, color: string) => {
      g.fillStyle = color; g.fillRect(x, y, w, h);
    };
    const walking = pose === 'walk' || pose === 'depth';
    const step = walking ? [0, 1, 0, -1][frame] : 0;
    const bob = pose === 'idle' ? [0, 0, -1, 0][frame] : 0;
    const impact = pose === 'hit' ? 1 : 0;
    const airborne = pose === 'jump' || pose === 'jumpkick';
    const up = airborne ? [1, 2, 3, 1][frame] : 0;
    const dx = pose === 'hit' ? -1 : pose === 'punch' || pose === 'kick' || pose === 'jumpkick' ? 1 : 0;
    const y = bob + impact - up;
    if (pose === 'ko') {
      r(2, 18, 13, 3, S.ink); r(3, 18, 8, 2, S.coat); r(11, 17, 3, 3, S.skin);
      r(3, 17, 4, 1, S.jeans); r(12, 18, 2, 1, S.hair);
    } else {
      // Offset feet create a readable four-frame walk. Boots retain bottom anchored cell.
      r(4 + step, 17 + y, 4, 6, S.ink); r(9 - step, 17 + y, 4, 6, S.ink);
      r(5 + step, 18 + y, 2, 4, S.jeans); r(10 - step, 18 + y, 2, 4, S.jeans);
      r(4 + step, 22 + y, 4, 1, S.boot); r(9 - step, 22 + y, 4, 1, S.boot);
      r(4 + dx, 9 + y, 9, 10, S.ink);
      r(5 + dx, 10 + y, 7, 7, S.coat);
      r(5 + dx, 11 + y, 2, 5, S.coatLight);
      r(8 + dx, 11 + y, 1, 5, S.gold);
      r(5 + dx, 17 + y, 7, 2, S.jeans);
      r(9 + dx, 17 + y, 2, 1, S.jeansLight);
      // Portrait: ochre face, nose highlight, dark eyes, parted brown hair and a tiny moustache.
      r(5 + dx, 2 + y, 7, 8, S.ink); r(6 + dx, 4 + y, 5, 5, S.skin);
      r(7 + dx, 5 + y, 1, 1, S.ink); r(10 + dx, 5 + y, 1, 1, S.ink);
      r(9 + dx, 6 + y, 1, 1, S.light); r(8 + dx, 7 + y, 2, 1, S.hair);
      r(5 + dx, 2 + y, 7, 2, S.hair);
      r(6 + dx, 3 + y, 2, 1, S.hair); r(10 + dx, 3 + y, 2, 1, S.hair);
      // Outlined left arm and an expressive right-hand punch with four reach phases.
      r(2 + dx, 11 + y, 3, 6, S.ink); r(3 + dx, 12 + y, 1, 4, S.coatLight);
      const reach = pose === 'punch' || pose === 'jumpkick' ? [2, 3, 4, 2][frame] : 2;
      r(12 + dx, 11 + y, reach, 3, S.ink);
      r(12 + dx, 12 + y, Math.max(1, reach - 1), 1, S.skin);
      if (pose === 'kick' || pose === 'jumpkick') {
        const kick = [1, 2, 3, 2][frame];
        r(11, 17 + y, kick + 1, 3, S.ink);
        r(12, 18 + y, kick, 1, S.jeansLight);
      }
      if (pose === 'hit') { r(1, 7, 2, 2, S.gold); r(0, 10, 1, 1, S.light); }
      if (pose === 'respawn') { r(3, 1, 11, 1, S.gold); r(2, 5 + frame, 1, 12, S.gold); }
    }
    const ctx = pixel.context;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 32, 48);
    ctx.drawImage(buffer, 0, 0, 32, 48);
    pixel.refresh();
  }
}
