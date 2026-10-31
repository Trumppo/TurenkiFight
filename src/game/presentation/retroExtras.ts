import Phaser from 'phaser';
import { fighterKey, POSES, FRAMES_PER_POSE } from './fighterSprites';
import { fighterRig, transformRig, type Joint, type RigPose } from './fighterRig';

/** Original pixel-art P3/P4 characters. Art only: no simulation or input changes. */
export const RETRO_EXTRA_SIZE = { width: 32, height: 48 } as const;

const fighters = {
  P3: {
    ink: '#271b2c', coat: '#9b493c', highlight: '#e1794e',
    shade: '#633044', legs: '#48364c', boots: '#251e2d',
    skin: '#b67b58', hair: '#29212d', accent: '#eac26a',
    width: 1.12, height: 0.98,
  },
  P4: {
    ink: '#182d2b', coat: '#4d8164', highlight: '#8db77a',
    shade: '#285447', legs: '#394f3b', boots: '#202e2b',
    skin: '#d8a27c', hair: '#70492f', accent: '#d9e3bb',
    width: 0.95, height: 1.02,
  },
} as const;

const rigPose = (pose: string): RigPose =>
  pose === 'punch' || pose === 'hit' ? pose :
  pose === 'kick' || pose === 'jumpkick' ? 'kick' :
  pose === 'walk' || pose === 'depth' ? 'walk' :
  pose === 'jump' ? 'jump' : 'idle';

export function createRetroExtraTextures(scene: Phaser.Scene): void {
  for (const id of ['P3', 'P4'] as const) {
    const c = fighters[id];
    for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
      const key = fighterKey(id, pose, frame);
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const texture = scene.textures.createCanvas(key, 32, 48);
      if (!texture) throw new Error('Cannot create retro texture ' + key);
      const g = texture.context;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 48);
      const rect = (x: number, y: number, w: number, h: number, color: string) => {
        g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      };
      const poly = (points: readonly Joint[], color: string) => {
        g.fillStyle = color; g.beginPath();
        g.moveTo(Math.round(points[0][0]), Math.round(points[0][1]));
        for (const [x,y] of points.slice(1)) g.lineTo(Math.round(x), Math.round(y));
        g.closePath(); g.fill();
      };
      const limb = (a: Joint, b: Joint, width: number, color: string) => {
        g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'square';
        g.beginPath(); g.moveTo(Math.round(a[0]), Math.round(a[1]));
        g.lineTo(Math.round(b[0]), Math.round(b[1])); g.stroke();
      };
      if (pose === 'ko') {
        poly([[2,43],[6,39],[15,38],[24,40],[30,44],[29,47],[3,47]],c.ink);
        poly([[6,40],[13,38],[22,41],[24,45],[7,45]],c.coat);
        rect(4,45,8,2,c.boots); rect(13,45,8,2,c.boots);
        poly([[23,39],[27,36],[30,39],[29,43]],c.skin);
        rect(25,37,5,2,c.hair);
      } else {
        const jumping = pose === 'jump' || pose === 'jumpkick';
        const lift = jumping ? [2,5,8,4][frame] : 0;
        const bob = pose === 'idle' || pose === 'walk' || pose === 'depth' ? frame % 2 : 0;
        g.save(); g.translate(pose === 'hit' ? -2 : 0, bob - lift);
        const rig = transformRig(fighterRig(rigPose(pose),frame), {
          scaleX:c.width,scaleY:c.height,offsetX:0,offsetY:0,
        });
        const leg = (l: typeof rig.leftLeg) => {
          limb(l.hip,l.knee,7,c.ink); limb(l.hip,l.knee,5,c.legs);
          limb(l.knee,l.ankle,7,c.ink); limb(l.knee,l.ankle,5,c.legs);
          rect(l.ankle[0]-3,l.ankle[1]-1,7,3,c.boots);
        };
        leg(rig.leftLeg);
        if (pose !== 'kick' && pose !== 'jumpkick') leg(rig.rightLeg);
        if (id === 'P3') {
          // Broad-shouldered red bomber jacket and bright diagonal sash.
          poly([[7,19],[12,17],[22,17],[27,20],[25,34],[9,34]],c.ink);
          poly([[9,20],[14,18],[22,18],[25,21],[23,32],[11,32]],c.coat);
          poly([[11,20],[14,19],[20,30],[18,32],[16,31]],c.accent);
          rect(10,31,14,2,c.shade); rect(22,24,2,3,c.highlight);
        } else {
          // Green long coat with distinct split hem and pale collar.
          poly([[10,18],[14,17],[22,17],[25,20],[25,39],[19,36],[16,39],[9,38]],c.ink);
          poly([[11,20],[15,19],[21,19],[24,21],[23,36],[19,34],[16,37],[11,36]],c.coat);
          poly([[13,19],[16,21],[18,19],[21,19],[18,24]],c.accent);
          rect(16,25,2,10,c.shade); rect(21,29,2,3,c.highlight);
        }
        if (pose === 'kick' || pose === 'jumpkick') leg(rig.rightLeg);
        rect(14,16,6,5,c.ink); rect(15,16,4,4,c.skin);
        if (id === 'P3') {
          // Dark cropped hair, squared jaw and red headband.
          poly([[11,7],[15,5],[21,5],[24,9],[23,16],[20,19],[14,19],[11,15]],c.ink);
          poly([[13,9],[16,8],[21,8],[22,15],[19,17],[14,16]],c.skin);
          rect(12,7,11,3,c.hair); rect(12,9,11,2,c.accent);
        } else {
          // Taller auburn swept hair, narrow face and pale neck wrap.
          poly([[12,8],[16,5],[21,6],[23,10],[22,16],[19,19],[14,18],[12,14]],c.ink);
          poly([[14,9],[17,8],[21,9],[21,15],[18,17],[15,16]],c.skin);
          poly([[11,10],[13,5],[16,3],[19,5],[22,4],[24,8],[19,7],[15,9]],c.hair);
          rect(13,19,9,2,c.accent);
        }
        rect(15,12,2,1,c.ink); rect(20,12,2,1,c.ink);
        const arm = (a: typeof rig.leftArm, sleeve: string) => {
          limb(a.shoulder,a.elbow,6,c.ink); limb(a.shoulder,a.elbow,4,sleeve);
          limb(a.elbow,a.wrist,5,c.ink); limb(a.elbow,a.wrist,3,c.skin);
          rect(Math.min(28,a.wrist[0]-2),a.wrist[1]-2,4,4,c.skin);
        };
        arm(rig.leftArm,c.shade); arm(rig.rightArm,c.highlight);
        if (pose === 'respawn') {
          g.globalAlpha = 0.15 + frame * 0.1; rect(10,4,15,40,c.accent); g.globalAlpha = 1;
        }
        g.restore();
      }
      texture.refresh();
    }
  }
}
