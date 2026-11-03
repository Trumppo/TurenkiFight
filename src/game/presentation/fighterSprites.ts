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

/** Hand-built silhouettes for the expanded slots. These use the same 32x48 cell and pose API. */
function drawExpandedSlot(ctx: CanvasRenderingContext2D, player: number, pose: FighterPose, frame: number, uniform: string, accent: string): void {
  const rect = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const ko = pose === 'ko';
  const hit = pose === 'hit';
  const kick = pose === 'kick' || pose === 'jumpkick';
  const punch = pose === 'punch' || pose === 'jumpkick';
  const airborne = pose === 'jump' || pose === 'jumpkick';
  const step = pose === 'walk' ? [0, 2, 0, -2][frame] : pose === 'depth' ? [0, 1, 0, -1][frame] : 0;
  // Jump height itself comes from the simulated Z offset in the scene; keep the drawn
  // headgear inside the source cell in every frame.
  const lift = 0;
  const bob = pose === 'idle' ? frame % 2 : 0;
  const y = lift + bob + (hit ? 1 : 0);
  const lean = hit ? -1 : 0;
  const boot = (x: number, top: number, width = 6): void => {
    rect(x, top, width, 11, O);
    rect(x + 1, top + 2, width - 2, 7, SHADOW);
    rect(x - 1, top + 8, width + 2, 3, O);
  };
  const arm = (x: number, top: number, width: number, color = uniform): void => {
    rect(x, top, width, 5, O);
    rect(x + 1, top + 1, Math.max(1, width - 2), 3, color);
    rect(x + width - 2, top, 3, 5, SKIN);
  };

  if (ko) {
    // A low, unmistakably fallen pose; character accessories remain visible instead of
    // collapsing all four silhouettes into the same horizontal capsule.
    const width = player === 6 ? 26 : player === 7 ? 24 : 22;
    rect(4, 35, width, 9, O);
    rect(6, 37, width - 5, 5, uniform);
    rect(8, 42, 6, 4, SHADOW);
    rect(16, 42, 6, 4, O);
    rect(24, 34, 6, 8, O);
    rect(25, 36, 4, 4, SKIN);
    if (player === 5) { // station-master's peaked cap
      rect(22, 31, 8, 3, accent); rect(24, 29, 4, 2, O);
      rect(8, 39, 4, 3, accent); // long-coat cuff
    } else if (player === 6) { // vendor's apron and visor
      rect(9, 38, 10, 4, accent); rect(23, 32, 8, 2, O); rect(24, 30, 6, 2, accent);
    } else if (player === 7) { // hood and backpack
      rect(2, 34, 7, 9, O); rect(3, 36, 5, 5, accent); rect(23, 32, 7, 6, O);
    } else { // commuter's beanie and long scarf
      rect(23, 31, 7, 3, accent); rect(4, 37, 11, 3, O); rect(2, 38, 5, 3, accent);
    }
    return;
  }

  // Supporting legs are deliberately separate from strike extensions; all boot pixels
  // stay inside the cell and stand on the same bottom-center anchor as P1-P4.
  if (airborne) {
    boot(10 + step, 34 + y, 5);
    boot(19 - step, 32 + y, 5);
  } else {
    boot(10 + step, 35 + y, 5);
    boot(19 - step, 35 - step + y, 5);
  }

  if (player === 5) {
    // P5 / Station-master: tall narrow frame, peaked cap, long split-tail coat.
    rect(8 + lean, 17 + y, 17, 19, O);
    rect(10 + lean, 18 + y, 13, 16, uniform);
    rect(7 + lean, 30 + y, 8, 6, O); rect(18 + lean, 30 + y, 8, 6, O);
    rect(9 + lean, 32 + y, 5, 3, uniform); rect(19 + lean, 32 + y, 5, 3, uniform);
    rect(11 + lean, 20 + y, 2, 12, accent); rect(20 + lean, 20 + y, 2, 12, accent);
    rect(15 + lean, 20 + y, 3, 3, LIGHT); rect(15 + lean, 25 + y, 3, 3, LIGHT);
    arm(4 + lean, 22 + y, 6);
    arm(20 + lean, 22 + y, punch ? [4, 6, 8, 5][frame] : 5);
    rect(10 + lean, 5 + y, 13, 13, O); rect(12 + lean, 8 + y, 9, 8, SKIN);
    rect(14 + lean, 0 + y, 6, 2, O); rect(12 + lean, 1 + y, 10, 2, accent);
    rect(10 + lean, 3 + y, 14, 3, O); rect(12 + lean, 4 + y, 10, 1, accent);
    rect(8 + lean, 6 + y, 18, 2, O); rect(10 + lean, 6 + y, 14, 1, LIGHT);
  } else if (player === 6) {
    // P6 / Kiosk vendor: low, broad shoulders and a flared front apron.
    rect(4 + lean, 17 + y, 24, 19, O); rect(6 + lean, 18 + y, 20, 16, uniform);
    rect(7 + lean, 24 + y, 18, 11, O); rect(9 + lean, 25 + y, 14, 8, accent);
    rect(8 + lean, 25 + y, 2, 9, LIGHT); rect(22 + lean, 25 + y, 2, 9, LIGHT);
    rect(5 + lean, 20 + y, 4, 10, O); rect(23 + lean, 20 + y, 4, 10, O);
    rect(3 + lean, 26 + y, 5, 5, SKIN); rect(24 + lean, 26 + y, 5, 5, SKIN);
    arm(3 + lean, 21 + y, 6);
    arm(20 + lean, 21 + y, punch ? [4, 6, 8, 5][frame] : 5);
    rect(9 + lean, 5 + y, 15, 13, O); rect(12 + lean, 8 + y, 9, 8, SKIN);
    rect(9 + lean, 3 + y, 17, 4, O); rect(11 + lean, 2 + y, 13, 3, accent);
    rect(7 + lean, 7 + y, 21, 2, O); // flat kiosk-visor brim
  } else if (player === 7) {
    // P7 / Hooded student: angular hood and a backpack bulging behind one shoulder.
    rect(2 + lean, 18 + y, 9, 17, O); rect(3 + lean, 20 + y, 7, 13, accent);
    rect(2 + lean, 18 + y, 8, 3, SHADOW); // backpack flap
    rect(6 + lean, 20 + y, 3, 13, O); // backpack strap
    rect(9 + lean, 18 + y, 14, 17, O); rect(11 + lean, 19 + y, 10, 14, uniform);
    rect(10 + lean, 30 + y, 12, 3, accent);
    arm(6 + lean, 22 + y, 5);
    arm(20 + lean, 22 + y, punch ? [4, 6, 8, 5][frame] : 5);
    rect(7 + lean, 4 + y, 19, 15, O); rect(9 + lean, 6 + y, 15, 11, accent);
    rect(11 + lean, 8 + y, 11, 8, O); rect(13 + lean, 9 + y, 7, 6, SKIN);
    rect(12 + lean, 2 + y, 10, 3, O); // hood peak
    rect(9 + lean, 16 + y, 16, 3, O); // hood's shoulder drape
  } else {
    // P8 / Commuter: compact knit cap, fitted coat, and a long trailing scarf.
    rect(8 + lean, 17 + y, 17, 19, O); rect(10 + lean, 18 + y, 13, 16, uniform);
    rect(11 + lean, 24 + y, 11, 2, accent); rect(11 + lean, 29 + y, 11, 2, accent);
    rect(15 + lean, 20 + y, 3, 4, LIGHT); // coat buttons
    rect(11 + lean, 7 + y, 12, 11, O); rect(13 + lean, 9 + y, 8, 7, SKIN);
    rect(10 + lean, 4 + y, 15, 4, O); rect(12 + lean, 2 + y, 11, 3, accent);
    rect(16 + lean, 1 + y, 3, 2, O); // knit-cap crown
    rect(8 + lean, 16 + y, 16, 5, O); rect(10 + lean, 17 + y, 12, 2, accent);
    rect(19 + lean, 16 + y, 11, 4, O); rect(20 + lean, 17 + y, 9, 2, accent);
    rect(26 + lean, 19 + y, 4, 5, O); rect(27 + lean, 20 + y, 2, 3, accent);
    rect(8 + lean, 19 + y, 5, 9, O); rect(9 + lean, 20 + y, 3, 7, accent);
    arm(5 + lean, 22 + y, 5);
    arm(20 + lean, 22 + y, punch ? [4, 6, 8, 5][frame] : 5);
  }

  if (kick) {
    const extension = [3, 7, 10, 6][frame];
    rect(17, 33 + y, extension, 6, O);
    rect(18, 34 + y, Math.max(1, extension - 2), 3, SHADOW);
    rect(17 + extension, 32 + y, 3, 5, accent);
  }
  if (pose === 'depth') rect(14 + lean, 13 + y, 5, 2, O);
  if (hit) { rect(3, 14, 4, 4, LIGHT); rect(1, 18, 2, 2, LIGHT); }
  if (pose === 'respawn') {
    ctx.globalAlpha = 0.2 + frame * 0.15;
    rect(4, 4, 25, 41, LIGHT);
    ctx.globalAlpha = 1;
  }
}

/** Original pixel sprites. No third-party textures; generated at startup. */
export function createFighterTextures(scene: Phaser.Scene): void {
  for (let player = 1; player <= 8; player++) {
    const id = `P${player}`;
    const uniform = hex(playerColor(id));
    // Eight distinct color/pattern identities so added slots do not alias P1-P4.
    const variant = player - 1;
    const accent = ['#f7d3a4', '#c6f0e7', '#3b3540', '#eee0ff', '#ffe2a7', '#f4f4c1', '#d4e8ff', '#ffe0bd'][variant];
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
      if (variant >= 4) {
        drawExpandedSlot(ctx, player, pose, frame, uniform, accent);
        tex.refresh();
        continue;
      }
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
        if (variant === 4) { rect(10 + lean, 20 + y, 3, 11, accent); rect(20 + lean, 20 + y, 3, 11, accent); }
        if (variant === 5) { rect(15 + lean, 20 + y, 3, 12, accent); rect(11 + lean, 30 + y, 11, 2, accent); }
        if (variant === 6) { rect(11 + lean, 22 + y, 11, 2, accent); rect(15 + lean, 26 + y, 3, 6, accent); }
        if (variant === 7) { rect(11 + lean, 20 + y, 11, 4, accent); rect(12 + lean, 28 + y, 9, 3, accent); }
        rect(9 + lean, 6 + y, 15, 13, O);
        rect(12 + lean, 9 + y, 9, 8, SKIN);
        rect(10 + lean, 5 + y, 13, 4, SHADOW);
        // Unique head silhouettes, rather than palette-only identification.
        if (variant === 0) rect(9 + lean, 5 + y, 16, 3, accent); // cap
        if (variant === 1) rect(11 + lean, 2 + y, 11, 6, accent); // high hair
        if (variant === 2) { rect(8 + lean, 6 + y, 3, 10, accent); rect(22 + lean, 6 + y, 3, 10, accent); } // ear guards
        if (variant === 3) rect(10 + lean, 4 + y, 14, 2, accent); // headband
        if (variant === 4) { rect(9 + lean, 4 + y, 16, 4, accent); rect(11 + lean, 8 + y, 12, 2, SHADOW); } // helmet and visor
        if (variant === 5) { rect(11 + lean, 3 + y, 12, 4, accent); rect(22 + lean, 7 + y, 5, 11, accent); } // high side tail
        if (variant === 6) { rect(14 + lean, 1 + y, 7, 7, accent); rect(10 + lean, 7 + y, 4, 7, accent); } // crest
        if (variant === 7) { rect(10 + lean, 3 + y, 14, 4, accent); rect(10 + lean, 10 + y, 15, 3, accent); } // band and face guard
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
