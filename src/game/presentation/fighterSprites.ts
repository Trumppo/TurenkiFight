import Phaser from 'phaser';
import { playerColor } from './visualTheme';

/** Generates tiny, nearest-neighbour fighter textures once at scene creation.
 * No dependency on simulation; each texture is a reusable 32×48 pixel frame.
 */
export type FighterPose = 'idle' | 'walk' | 'depth' | 'punch' | 'kick' | 'jump' | 'jumpkick' | 'hit' | 'ko' | 'respawn';
export const POSES: FighterPose[] = ['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn'];
export const FRAMES_PER_POSE = 4;
export const fighterKey = (id: string, pose: FighterPose, frame: number): string =>
  `fighter-${id}-${pose}-${frame % FRAMES_PER_POSE}`;

export function createFighterTextures(scene: Phaser.Scene): void {
  for (let player = 1; player <= 4; player++) {
    const id = `P${player}`;
    const color = playerColor(id);
    for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
      const key = fighterKey(id, pose, frame);
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, 32, 48);
      if (!tex) continue;
      const ctx = tex.context;
      const fill = (x: number, y: number, w: number, h: number, c: string) => {
        ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h);
      };
      const uniform = '#' + color.toString(16).padStart(6, '0');
      const outline = '#202a36', skin = '#e9bd93', boot = '#28323e';
      const bob = pose === 'idle' ? frame % 2 : pose === 'walk' ? frame % 2 : 0;
      const down = pose === 'ko' ? 23 : pose === 'hit' ? 3 : 0;
      const lean = pose === 'punch' || pose === 'kick' || pose === 'jumpkick' ? 2 : pose === 'hit' ? -3 : 0;
      if (pose === 'ko') {
        fill(4, 37, 25, 6, outline); fill(7, 36, 17, 5, uniform); fill(23, 35, 7, 6, skin);
      } else {
        const leg = pose === 'walk' ? (frame % 2 ? 4 : -4) : 0;
        fill(9 + leg, 34 + down, 6, 11, boot); fill(18 - leg, 34 + down, 6, 11, boot);
        fill(8 + lean, 16 + bob + down, 17, 21, outline);
        fill(10 + lean, 18 + bob + down, 13, 17, uniform);
        fill(10 + lean, 6 + bob + down, 13, 12, outline);
        fill(12 + lean, 9 + bob + down, 9, 8, skin);
        fill(10 + lean, 5 + bob + down, 13, 4, boot);
        const striking = pose === 'punch' || pose === 'jumpkick';
        fill(23 + lean, 21 + bob + down, striking ? 9 : 5, 5, skin);
        fill(4 + lean, 22 + bob + down, 5, 5, skin);
        if (pose === 'kick' || pose === 'jumpkick') {
          fill(21, 34, 10, 6, boot); fill(27, 31, 5, 6, skin);
        }
        if (pose === 'depth') fill(13, 11, 6, 3, outline);
        if (pose === 'hit') fill(5, 14, 4, 4, '#fff1b7');
        if (pose === 'respawn') { ctx.globalAlpha = 0.25 + frame * 0.2; fill(7, 4, 20, 41, '#fff1b7'); ctx.globalAlpha = 1; }
      }
      tex.refresh();
    }
  }
}
