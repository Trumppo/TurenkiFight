import Phaser from 'phaser';
import { fighterKey, POSES, FRAMES_PER_POSE } from './fighterSprites';

/** Original 1990s arcade-inspired martial artist, not a licensed character. */
export const RETRO_PREVIEW = import.meta.env.VITE_VISUAL_STYLE === 'retro';
export const RETRO_STATION_PATH = 'assets/station/turenki-station-retro.svg';
export const RETRO_PALETTE = {
  ink: '#151c28', outline: '#27313b', skin: '#dca47f', light: '#ffd4a0',
  hair: '#4b342d', coat: '#9c3d3e', coatLight: '#df7654',
  jeans: '#344e6a', jeansLight: '#7990a0', boot: '#292d35', gold: '#f1c978',
} as const;

/** 32×48 cel art. Pixel polygons describe human anatomy instead of stacked rectangles.
 * Pose-specific joint positions change the silhouette; texture API remains unchanged.
 */
export function createRetroP1Textures(scene: Phaser.Scene): void {
  const P = RETRO_PALETTE;
  const skinShade = '#ac7058', skinMid = '#f0b58b';
  const giDark = '#642b37', giMid = '#b94b42', giLight = '#f18a64';
  const belt = '#e2c99b', shadow = '#1e2734';
  for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
    const key = fighterKey('P1', pose, frame);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, 32, 48);
    if (!tex) throw new Error('Cannot create fighter texture ' + key);
    const g = tex.context;
    g.clearRect(0, 0, 32, 48);
    g.imageSmoothingEnabled = false;
    const poly = (points: number[][], color: string) => {
      g.fillStyle = color; g.beginPath();
      g.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) g.lineTo(x, y);
      g.closePath(); g.fill();
    };
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      g.fillStyle = color; g.fillRect(x, y, w, h);
    };
    const limb = (a: number[], b: number[], width: number, color: string) => {
      g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'square';
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    };
    const walking = pose === 'walk' || pose === 'depth';
    const stride = walking ? [0, 3, 0, -3][frame] : 0;
    const bob = pose === 'idle' ? [0, -1, 0, -1][frame] : walking ? [0, -1, 0, -1][frame] : 0;
    const airborne = pose === 'jump' || pose === 'jumpkick';
    const lift = airborne ? [2, 5, 8, 4][frame] : 0;
    const punch = pose === 'punch';
    const kick = pose === 'kick' || pose === 'jumpkick';
    const hit = pose === 'hit';
    const lean = hit ? [-3, -4, -2, -1][frame] : punch ? [0, 1, 2, 1][frame] : 0;
    const active = punch || kick ? frame === 1 || frame === 2 : false;
    const dy = bob - lift + (hit ? 1 : 0);

    if (pose === 'ko') {
      // Recognizable human figure lying sideways: feet, torso, arms and head.
      poly([[2,40],[13,38],[22,40],[26,43],[27,46],[3,46]], P.ink);
      poly([[5,40],[15,39],[20,41],[21,44],[5,44]], giMid);
      poly([[19,38],[25,36],[29,39],[30,43],[24,44],[19,42]], skinShade);
      poly([[21,37],[27,36],[30,38],[28,40],[23,39]], P.hair);
      rect(8,45,8,2,P.boot); rect(1,43,5,3,P.boot);
    } else {
      g.save();
      g.translate(lean, dy);
      // Boots and lower limbs: angled thighs, articulated knees, separate calves.
      const rearFoot = 9 + stride;
      const frontFoot = 22 - stride;
      poly([[11,31],[16,32],[rearFoot+3,39],[rearFoot+1,43],[rearFoot-4,42],[7,37]], P.ink);
      poly([[12,32],[15,33],[rearFoot+1,39],[rearFoot-1,41],[rearFoot-3,39],[9,36]], P.jeans);
      poly([[18,31],[23,31],[frontFoot+3,38],[frontFoot+1,43],[frontFoot-4,42],[17,36]], P.ink);
      poly([[19,32],[22,32],[frontFoot+1,39],[frontFoot-1,41],[frontFoot-3,39],[18,35]], P.jeans);
      limb([rearFoot-1,37],[rearFoot,41],2,P.jeansLight);
      limb([frontFoot-1,36],[frontFoot,40],2,P.jeansLight);
      poly([[rearFoot-4,41],[rearFoot+3,41],[rearFoot+5,45],[rearFoot-6,45]],P.ink);
      poly([[rearFoot-4,42],[rearFoot+3,42],[rearFoot+3,44],[rearFoot-5,44]],P.boot);
      poly([[frontFoot-4,41],[frontFoot+3,41],[frontFoot+6,45],[frontFoot-5,45]],P.ink);
      poly([[frontFoot-4,42],[frontFoot+3,42],[frontFoot+5,44],[frontFoot-4,44]],P.boot);

      // Anatomical shoulder/chest/waist taper; open martial-arts jacket and belt.
      poly([[8,19],[12,17],[22,17],[26,21],[24,29],[22,34],[11,34],[8,29]],P.ink);
      poly([[9,20],[13,18],[17,20],[16,31],[12,33],[9,29]],giMid);
      poly([[20,18],[24,20],[24,29],[21,33],[16,31],[17,21]],giDark);
      poly([[12,20],[16,23],[16,30],[12,29]],giLight);
      poly([[18,20],[20,21],[17,29],[16,30]],skinShade);
      poly([[16,21],[18,23],[17,27],[15,26]],skinMid);
      poly([[11,31],[22,31],[23,34],[10,34]],P.ink);
      rect(12,32,10,2,belt); rect(18,33,3,1,P.gold);
      poly([[19,33],[22,33],[21,38],[19,38]],belt);

      // Human neck, jaw and side-lit head; short tousled hair, eyes, nose, mouth.
      poly([[13,16],[20,16],[21,21],[12,21]],P.ink);
      poly([[14,16],[20,16],[19,21],[13,19]],skinShade);
      poly([[11,7],[14,4],[20,4],[24,8],[23,14],[20,18],[15,19],[11,16],[10,11]],P.ink);
      poly([[12,8],[15,6],[20,6],[22,9],[22,14],[19,17],[15,17],[12,14]],skinShade);
      poly([[13,8],[17,6],[21,8],[21,12],[19,15],[15,15],[13,13]],skinMid);
      poly([[12,7],[14,4],[19,3],[23,5],[24,9],[21,8],[19,6],[16,7],[13,10]],P.hair);
      poly([[14,4],[17,2],[19,4],[22,3],[24,7],[20,6],[17,5]],'#765044');
      rect(14,10,3,1,P.hair); rect(19,10,3,1,P.hair);
      rect(15,11,1,1,P.ink); rect(20,11,1,1,P.ink);
      poly([[18,11],[19,12],[20,14],[18,15]],P.light);
      rect(17,16,3,1,skinShade);
      rect(11,12,1,3,skinShade); // ear and jaw shadow

      // Rear arm guards face. Hand is separately shaded and connected at elbow.
      limb([10,21],[7,26],6,P.ink);
      limb([10,21],[7,26],4,giMid);
      limb([7,26],[10,20],5,P.ink);
      limb([7,26],[10,20],3,giLight);
      poly([[7,17],[11,17],[12,21],[9,24],[6,22]],P.ink);
      poly([[8,18],[11,18],[11,21],[9,22],[7,21]],skinMid);

      if (punch) {
        // Frame 0: chamber, 1–2: extension, 3: recovery.
        const elbow = active ? [28,19] : [26,25];
        const fist = active ? [34,16] : [26,19];
        limb([24,22],elbow,7,P.ink); limb([24,22],elbow,5,giMid);
        limb(elbow,fist,6,P.ink); limb(elbow,fist,4,skinMid);
        poly([[Math.min(29,fist[0]-3),fist[1]-3],[31,fist[1]-3],[31,fist[1]+3],[Math.min(29,fist[0]-3),fist[1]+3]],P.ink);
        rect(Math.min(29,fist[0]-2),fist[1]-2,3,4,skinMid);
      } else {
        limb([24,22],[27,27],7,P.ink);
        limb([24,22],[27,27],5,giDark);
        limb([27,27],[24,20],6,P.ink);
        limb([27,27],[24,20],4,giMid);
        poly([[22,17],[26,17],[28,20],[26,23],[22,22]],P.ink);
        poly([[23,18],[26,18],[27,20],[25,22],[23,21]],skinMid);
      }
      if (airborne) {\n        // Raised knee makes the airborne silhouette distinct from standing.\n        limb([11,34],[7,31],7,P.ink); limb([11,34],[7,31],5,P.jeansLight);\n        rect(3,29,6,4,P.boot);\n      }\n      if (kick) {
        // Raised knee and extended shin, with foot pointing horizontally.
        const kneeX = active ? 24 : 21;
        const toeX = active ? 31 : 27;
        limb([19,33],[kneeX,31],9,P.ink);
        limb([19,33],[kneeX,31],6,P.jeans);
        limb([kneeX,31],[toeX,29],7,P.ink);
        limb([kneeX,31],[toeX,29],5,P.jeansLight);
        poly([[toeX-3,26],[31,26],[31,31],[toeX-3,32]],P.boot);
      }
      if (hit) {
        rect(2,12,3,3,P.gold); rect(0,17,2,2,P.light);
        rect(28,9,3,2,P.gold);
      }
      if (pose === 'respawn') {
        g.globalAlpha = 0.15 + frame * 0.13;
        rect(8,3,18,42,P.gold);
        g.globalAlpha = 1;
      }
      g.restore();
    }
    tex.refresh();
  }
}
