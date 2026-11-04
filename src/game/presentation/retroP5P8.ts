import Phaser from 'phaser';
import { fighterKey, POSES, FRAMES_PER_POSE, type FighterPose } from './fighterSprites';
import { fighterRig, type RigPose, type Joint } from './fighterRig';

/** Retro 32×48 character art for the four expanded local slots. */
export const RETRO_P5_P8_SIZE = { width: 32, height: 48 } as const;

type Character = {
  ink: string; shadow: string; coat: string; light: string; legs: string;
  boot: string; skin: string; shade: string; accent: string; trim: string;
};

const characters: Record<'P5' | 'P6' | 'P7' | 'P8', Character> = {
  P5: { // Station master: peaked cap, brass buttons, long split coat.
    ink: '#202936', shadow: '#36414b', coat: '#48576b', light: '#78869a', legs: '#343d4b',
    boot: '#242a32', skin: '#d8a27c', shade: '#a66f59', accent: '#e0b85e', trim: '#c9d3cf',
  },
  P6: { // Kiosk vendor: flat visor, broad uniform and unmistakable apron.
    ink: '#202b31', shadow: '#34474a', coat: '#477b72', light: '#78aa8d', legs: '#3b4d4b',
    boot: '#252d31', skin: '#e0aa82', shade: '#a9755d', accent: '#e5c779', trim: '#d9e7d2',
  },
  P7: { // Hooded student: angular hood and a squared backpack behind one shoulder.
    ink: '#252433', shadow: '#3d394b', coat: '#514b70', light: '#827aa0', legs: '#3d4052',
    boot: '#292832', skin: '#c98f70', shade: '#8e5f50', accent: '#e08a63', trim: '#d8c8ac',
  },
  P8: { // Commuter: ribbed knit cap and a long, conspicuous trailing scarf.
    ink: '#202b2d', shadow: '#354346', coat: '#5e655b', light: '#929276', legs: '#434b45',
    boot: '#292e2e', skin: '#d6a27e', shade: '#a36f58', accent: '#c95e4c', trim: '#e3c992',
  },
};

const rigPose = (pose: FighterPose): RigPose =>
  pose === 'punch' || pose === 'hit' ? pose :
  pose === 'kick' || pose === 'jumpkick' ? 'kick' :
  pose === 'walk' || pose === 'depth' ? 'walk' :
  pose === 'jump' ? 'jump' : 'idle';

/** Draw P5-P8 into the established bottom-centre 32×48 cell contract. */
export function createRetroP5P8Textures(scene: Phaser.Scene): void {
  for (const id of ['P5', 'P6', 'P7', 'P8'] as const) {
    const c = characters[id];
    for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
      const key = fighterKey(id, pose, frame);
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const texture = scene.textures.createCanvas(key, RETRO_P5_P8_SIZE.width, RETRO_P5_P8_SIZE.height);
      if (!texture) throw new Error(`Cannot create retro texture ${key}`);
      const g = texture.context;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 48);
      // Be explicit that even a strike limb or scarf stays inside the authored cell.
      g.save();
      g.beginPath(); g.rect(0, 0, 32, 48); g.clip();
      const rect = (x: number, y: number, w: number, h: number, color: string) => {
        g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      };
      const poly = (points: readonly Joint[], color: string) => {
        g.fillStyle = color; g.beginPath();
        g.moveTo(Math.round(points[0][0]), Math.round(points[0][1]));
        for (const [x, y] of points.slice(1)) g.lineTo(Math.round(x), Math.round(y));
        g.closePath(); g.fill();
      };
      const limb = (a: Joint, b: Joint, width: number, color: string) => {
        g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'square';
        g.beginPath(); g.moveTo(Math.round(a[0]), Math.round(a[1]));
        g.lineTo(Math.round(b[0]), Math.round(b[1])); g.stroke();
      };

      if (pose === 'ko') {
        // Retain each character's signature accessory in the shared fallen pose.
        poly([[2,43],[6,39],[14,38],[22,40],[28,43],[29,46],[3,46]], c.ink);
        poly([[6,40],[14,39],[21,41],[23,44],[7,44]], c.coat);
        rect(3,44,8,2,c.boot); rect(12,45,8,2,c.boot);
        poly([[22,39],[27,36],[30,38],[30,42],[25,44],[21,42]], c.skin);
        if (id === 'P5') { rect(22,35,9,2,c.ink); rect(24,34,5,2,c.accent); rect(8,40,8,2,c.light); }
        if (id === 'P6') { rect(8,40,12,4,c.accent); rect(23,35,8,2,c.ink); }
        if (id === 'P7') { rect(2,38,7,7,c.ink); rect(3,39,5,5,c.accent); rect(21,36,9,4,c.ink); }
        if (id === 'P8') { rect(2,39,9,3,c.ink); rect(0,40,8,2,c.accent); rect(23,34,8,2,c.ink); rect(25,35,5,2,c.accent); }
      } else {
        const jumping = pose === 'jump' || pose === 'jumpkick';
        const walking = pose === 'walk' || pose === 'depth';
        const kick = pose === 'kick' || pose === 'jumpkick';
        // The scene applies simulated Z to the sprite's world position; keep
        // this cel lift subtle so hats/hoods stay inside the 48px texture.
        const lift = jumping ? [0,1,2,1][frame] : 0;
        const bob = pose === 'idle' || walking ? [0,-1,0,-1][frame] : 0;
        const recoil = pose === 'hit' ? [-2,-3,-2,-1][frame] : 0;
        g.save(); g.translate(recoil, bob - lift);
        const rig = fighterRig(rigPose(pose), frame);
        const drawLeg = (leg: typeof rig.leftLeg) => {
          limb(leg.hip,leg.knee,8,c.ink); limb(leg.hip,leg.knee,5,c.legs);
          limb(leg.knee,leg.ankle,7,c.ink); limb(leg.knee,leg.ankle,4,c.light);
          rect(leg.ankle[0]-4,leg.ankle[1]-1,8,3,c.boot);
          rect(leg.ankle[0]-2,leg.ankle[1],4,1,c.shadow);
        };
        drawLeg(rig.leftLeg); if (!kick) drawLeg(rig.rightLeg);

        if (id === 'P5') {
          // Long uniform coat with split tails, brass buttons and a badge.
          poly([[9,18],[13,16],[21,17],[25,20],[24,37],[22,41],[19,38],[17,42],[14,38],[11,41],[8,37],[8,21]], c.ink);
          poly([[11,19],[15,18],[17,20],[16,35],[13,38],[10,34]], c.coat);
          poly([[19,19],[22,19],[23,35],[20,38],[18,35],[18,21]], c.light);
          rect(16,20,2,13,c.accent); rect(14,23,2,2,c.trim); rect(19,28,2,2,c.trim);
          rect(19,23,3,3,c.accent); rect(20,24,1,1,c.trim);
        } else if (id === 'P6') {
          // Broad shoulders, apron pocket and high-contrast hem.
          poly([[6,18],[11,16],[23,17],[27,20],[25,34],[23,36],[9,35],[6,29]], c.ink);
          poly([[8,19],[12,18],[22,18],[24,21],[23,32],[10,32],[8,28]], c.coat);
          poly([[9,24],[23,24],[23,36],[18,39],[10,36]], c.ink);
          poly([[11,25],[21,25],[21,35],[18,36],[12,34]], c.accent);
          rect(14,27,5,3,c.light); rect(13,32,2,2,c.trim);
        } else if (id === 'P7') {
          // Backpack protrudes to the left of a narrower hooded silhouette.
          poly([[3,19],[10,17],[12,21],[11,35],[4,36],[2,31]], c.ink);
          poly([[4,21],[9,20],[9,32],[5,33]], c.accent);
          rect(8,20,3,13,c.trim);
          poly([[10,19],[14,17],[21,18],[24,21],[23,34],[11,34],[9,28]], c.ink);
          poly([[12,20],[15,19],[20,20],[22,23],[21,32],[12,32]], c.coat);
          rect(12,30,10,2,c.light);
        } else {
          // Fitted coat and scarf that wraps the neck then trails from the shoulder.
          poly([[9,19],[13,17],[21,17],[25,20],[24,35],[21,37],[10,35],[8,23]], c.ink);
          poly([[11,20],[15,18],[21,19],[23,22],[21,33],[12,34],[10,29]], c.coat);
          poly([[16,17],[20,18],[22,21],[18,24],[14,21]], c.accent);
          poly([[20,18],[30,18],[31,20],[29,22],[25,22],[27,25],[24,25],[21,23]], c.ink);
          poly([[22,19],[29,19],[29,21],[25,21],[26,23],[24,23],[22,22]], c.accent);
          rect(12,27,9,2,c.light); rect(16,31,5,2,c.trim);
        }

        if (kick) drawLeg(rig.rightLeg); // foreground kick overlays the coat, never a third leg
        const arm = (a: typeof rig.leftArm, sleeve: string) => {
          limb(a.shoulder,a.elbow,7,c.ink); limb(a.shoulder,a.elbow,4,sleeve);
          limb(a.elbow,a.wrist,5,c.ink); limb(a.elbow,a.wrist,3,c.skin);
          rect(Math.max(0,Math.min(28,a.wrist[0]-2)),a.wrist[1]-2,4,4,c.shade);
        };
        arm(rig.leftArm,c.shadow); arm(rig.rightArm,c.light);

        // Head and signature headgear. Hair/hat pixels sit above the face, not on it.
        poly([[14,15],[20,15],[21,20],[13,20]], c.ink);
        rect(15,16,4,3,c.shade);
        if (id === 'P5') {
          poly([[11,8],[14,5],[20,5],[23,8],[22,15],[19,18],[14,17],[11,13]], c.ink);
          poly([[13,9],[15,7],[20,7],[21,10],[20,14],[18,16],[14,15],[12,12]], c.skin);
          poly([[12,7],[12,5],[14,2],[19,2],[22,5],[22,7]], c.coat);
          rect(8,7,18,2,c.ink); rect(10,7,14,1,c.accent); rect(15,3,4,1,c.light);
          rect(17,10,1,1,c.ink); rect(14,12,1,1,c.ink);
        } else if (id === 'P6') {
          poly([[11,8],[14,5],[20,5],[23,8],[22,15],[19,18],[14,17],[11,13]], c.ink);
          poly([[13,9],[15,7],[20,7],[21,10],[20,14],[18,16],[14,15],[12,12]], c.skin);
          rect(10,5,15,3,c.ink); rect(11,3,14,3,c.light); rect(7,7,22,2,c.ink); // flat visor
          rect(15,11,1,1,c.ink); rect(19,11,1,1,c.ink);
        } else if (id === 'P7') {
          poly([[7,7],[11,3],[21,3],[26,8],[25,17],[21,20],[11,18],[7,13]], c.ink);
          poly([[10,8],[13,6],[20,6],[22,9],[21,14],[18,17],[12,15],[10,12]], c.skin);
          rect(9,4,14,3,c.coat); rect(6,8,4,8,c.light); rect(23,8,4,8,c.light); rect(12,17,11,3,c.ink);
          rect(14,10,1,1,c.ink); rect(19,10,1,1,c.ink);
        } else {
          poly([[11,8],[14,5],[20,5],[23,8],[22,15],[19,18],[14,17],[11,13]], c.ink);
          poly([[13,9],[15,7],[20,7],[21,10],[20,14],[18,16],[14,15],[12,12]], c.skin);
          rect(10,6,15,4,c.ink); rect(12,3,11,4,c.coat);
          rect(13,4,2,2,c.accent); rect(17,3,2,3,c.accent); rect(21,4,2,2,c.accent); // knit ribs
          rect(11,15,12,4,c.ink); rect(13,16,9,2,c.accent); // scarf at neck
          rect(15,11,1,1,c.ink); rect(19,11,1,1,c.ink);
        }
        if (pose === 'hit') { rect(2,11,3,3,c.trim); rect(0,16,2,2,c.accent); }
        if (pose === 'respawn') { g.globalAlpha = 0.15 + frame * 0.12; rect(8,3,17,42,c.trim); g.globalAlpha = 1; }
        g.restore();
      }
      g.restore();
      texture.refresh();
    }
  }
}
