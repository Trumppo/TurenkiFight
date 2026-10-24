import Phaser from 'phaser';
import { playerColor } from './visualTheme';

/** Stable texture API: 32x48 pixels, bottom-centre foot anchor, four frames per pose. */
export type FighterPose = 'idle' | 'walk' | 'depth' | 'punch' | 'kick' | 'jump' | 'jumpkick' | 'hit' | 'ko' | 'respawn';
export const POSES: FighterPose[] = ['idle', 'walk', 'depth', 'punch', 'kick', 'jump', 'jumpkick', 'hit', 'ko', 'respawn'];
export const FRAMES_PER_POSE = 4;
export const fighterKey = (id: string, pose: FighterPose, frame: number): string =>
  `fighter-${id}-${pose}-${frame % FRAMES_PER_POSE}`;

const hex = (color: number): string => '#' + color.toString(16).padStart(6, '0');
const O = '#202a36', SKIN = '#e9bd93', SHADOW = '#26313e', LIGHT = '#fff1b7';

/** Original pixel sprites. No third-party textures; generated at startup. */
export function createFighterTextures(scene: Phaser.Scene): void {
  for (let player = 1; player <= 8; player++) {
    const id = `P${player}`;
    const uniform = hex(playerColor(id));
    // Four independent silhouettes: headgear, stripe, belt and trouser trim.
    const variant = (player - 1) % 4;
    const accent = ['#f7d3a4', '#c6f0e7', '#3b3540', '#eee0ff'][variant];
    for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
      const key = fighterKey(id, pose, frame);
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, 32, 48);
      if (!tex) continue;
      const ctx = tex.context;
      ctx.clearRect(0, 0, 32, 48);
      const rect = (x: number, y: number, w: number, h: number, c: string) => {
        ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h);
      };
      const bounce = pose === 'idle' ? frame % 2 : pose === 'walk' || pose === 'depth' ? frame % 2 : 0;
      const walk = pose === 'walk' ? [0, 3, 0, -3][frame] : 0;
      const depth = pose === 'depth' ? [0, 1, 0, -1][frame] : 0;
      const airborne = pose === 'jump' || pose === 'jumpkick';
      const strike = pose === 'punch' || pose === 'jumpkick';
      const kick = pose === 'kick' || pose === 'jumpkick';
      const hit = pose === 'hit';
      const lean = hit ? -3 : strike || kick ? 2 : 0;
      const y = bounce + depth + (hit ? 2 : 0) - (airborne ? [0, 2, 3, 1][frame] : 0);
      if (pose === 'ko') {
        const squash = frame === 0 ? 2 : 0;
        rect(3, 35 - squash, 27, 8 + squash, O);
        rect(7, 36 - squash, 16, 5 + squash, uniform);
        rect(23, 35 - squash, 6, 6, SKIN);
        rect(8, 34 - squash, 5, 2, accent);
      } else {
        // Feet remain within the 32x48 cell, including exaggerated kick silhouettes.
        rect(8 + walk, 34 + y, 7, airborne ? 7 : 10, O);
        rect(18 - walk, 34 + y, 7, airborne ? 7 : 10, O);
        rect(9 + walk, 36 + y, 5, airborne ? 5 : 7, SHADOW);
        rect(19 - walk, 36 + y, 5, airborne ? 5 : 7, SHADOW);
        rect(8 + lean, 17 + y, 17, 20, O);
        rect(10 + lean, 19 + y, 13, 16, uniform);
        rect(11 + lean, 31 + y, 11, 3, SHADOW);
        // Stripe position varies by player, readable in monochrome too.
        if (variant === 0) rect(12 + lean, 20 + y, 3, 11, accent);
        if (variant === 1) rect(18 + lean, 20 + y, 3, 11, accent);
        if (variant === 2) rect(11 + lean, 27 + y, 11, 3, accent);
        if (variant === 3) { rect(11 + lean, 20 + y, 11, 2, accent); rect(11 + lean, 25 + y, 11, 2, accent); }
        rect(9 + lean, 6 + y, 15, 13, O);
        rect(12 + lean, 9 + y, 9, 8, SKIN);
        rect(10 + lean, 5 + y, 13, 4, SHADOW);
        // Unique head silhouettes, rather than palette-only identification.
        if (variant === 0) rect(9 + lean, 5 + y, 16, 3, accent); // cap
        if (variant === 1) rect(11 + lean, 2 + y, 11, 6, accent); // high hair
        if (variant === 2) { rect(8 + lean, 6 + y, 3, 10, accent); rect(22 + lean, 6 + y, 3, 10, accent); } // ear guards
        if (variant === 3) rect(10 + lean, 4 + y, 14, 2, accent); // headband
        // Distinct punch extension across active frames.
        const reach = strike ? [3, 7, 9, 5][frame] : 3;
        rect(21 + lean, 21 + y, Math.min(reach, 9), 5, SKIN);
        rect(4 + lean, 22 + y, 5, 5, SKIN);
        if (kick) {
          const extension = [3, 7, 10, 5][frame];
          rect(17, 33 + y, extension, 6, SHADOW);
          rect(17 + extension, 32 + y, 4, 5, accent);
        }
        if (pose === 'depth') rect(14 + lean, 12 + y, 5, 2, O);
        if (hit) { rect(4, 14, 4, 4, LIGHT); rect(2, 18, 2, 2, LIGHT); }
        if (pose === 'respawn') {
          ctx.globalAlpha = 0.2 + frame * 0.15;
          rect(7, 4, 19, 41, LIGHT);
          ctx.globalAlpha = 1;
        }
      }
      tex.refresh();
    }
  }
}
