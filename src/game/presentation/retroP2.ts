import Phaser from 'phaser';
import { fighterKey, POSES, FRAMES_PER_POSE } from './fighterSprites';
import { fighterRig, transformRig, type RigPose, type Joint } from './fighterRig';

/** Original cool-blue arcade fighter. Independent 32x48 artwork, shared anatomical rig. */
export const RETRO_P2_SIZE = { width: 32, height: 48 } as const;
export const RETRO_P2_PALETTE = {
  ink: '#152331', jacket: '#285b87', jacketLight: '#559bc3',
  jacketShadow: '#203c60', trousers: '#29394e', seam: '#829db2',
  boot: '#192331', skin: '#e2af89', skinShade: '#aa755c',
  hair: '#c7ad6d', hairLight: '#f1d895', scarf: '#e5c46f',
} as const;

const P = RETRO_P2_PALETTE;
const rigPose = (pose: string): RigPose =>
  pose === 'punch' || pose === 'hit' ? pose :
  pose === 'kick' || pose === 'jumpkick' ? 'kick' :
  pose === 'walk' || pose === 'depth' ? 'walk' :
  pose === 'jump' ? 'jump' : 'idle';

/** P2 remains narrower through the torso/limbs, while retaining P1's bottom-centre anchor. */
export function createRetroP2Textures(scene: Phaser.Scene): void {
  for (const pose of POSES) for (let frame = 0; frame < FRAMES_PER_POSE; frame++) {
    const key = fighterKey('P2', pose, frame);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, RETRO_P2_SIZE.width, RETRO_P2_SIZE.height);
    if (!texture) throw new Error('Cannot create P2 texture ' + key);
    const g = texture.context;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 32, 48);
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };
    const poly = (points: readonly Joint[], color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(Math.round(points[0][0]), Math.round(points[0][1]));
      for (const [x, y] of points.slice(1)) g.lineTo(Math.round(x), Math.round(y));
      g.closePath();
      g.fill();
    };
    const limb = (a: Joint, b: Joint, width: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'square';
      g.beginPath(); g.moveTo(Math.round(a[0]), Math.round(a[1]));
      g.lineTo(Math.round(b[0]), Math.round(b[1])); g.stroke();
    };

    if (pose === 'ko') {
      // Horizontal jacket, bent legs and swept-back blond hair.
      poly([[3,43],[7,39],[14,38],[21,40],[27,43],[28,46],[3,46]], P.ink);
      poly([[9,39],[17,39],[22,42],[19,45],[7,44]], P.jacket);
      rect(3,44,7,2,P.boot); rect(10,45,7,2,P.boot);
      poly([[21,39],[26,37],[30,39],[29,43],[24,44]],P.skinShade);
      poly([[22,38],[26,35],[30,37],[30,39],[24,40]],P.hair);
      rect(25,37,3,1,P.hairLight);
    } else {
      const jumping = pose === 'jump' || pose === 'jumpkick';
      const lift = jumping ? [2,5,8,4][frame] : 0;
      const bob = pose === 'idle' || pose === 'walk' || pose === 'depth' ? frame % 2 : 0;
      const recoil = pose === 'hit' ? [-2,-3,-2,-1][frame] : 0;
      g.save();
      g.translate(recoil, bob - lift);
      const rig = transformRig(fighterRig(rigPose(pose), frame), {
        scaleX: 0.91, scaleY: 1.04, offsetX: 0, offsetY: -0.7,
      });
      const kick = pose === 'kick' || pose === 'jumpkick';
      const drawLeg = (leg: typeof rig.leftLeg) => {
        limb(leg.hip,leg.knee,6,P.ink); limb(leg.hip,leg.knee,4,P.trousers);
        limb(leg.knee,leg.ankle,6,P.ink); limb(leg.knee,leg.ankle,4,P.trousers);
        rect(leg.ankle[0]-3,leg.ankle[1]-1,7,3,P.boot);
        rect(leg.knee[0],leg.knee[1]+2,1,3,P.seam);
      };
      drawLeg(rig.leftLeg);
      if (!kick) drawLeg(rig.rightLeg);
      // Slim tailored jacket, asymmetrical lapels and yellow neck scarf.
      poly([[11,18],[14,17],[20,17],[23,19],[24,30],[21,34],[13,34],[10,30]],P.ink);
      poly([[12,19],[15,18],[17,20],[16,32],[13,32],[11,28]],P.jacketLight);
      poly([[18,19],[21,18],[23,21],[22,31],[18,33],[17,27]],P.jacket);
      poly([[15,19],[18,22],[17,27],[14,23]],P.scarf);
      poly([[18,20],[20,22],[18,28],[17,28]],P.jacketShadow);
      rect(13,31,9,2,P.jacketShadow); rect(19,30,1,2,P.scarf);
      rect(21,25,1,2,P.seam); // jacket pocket
      if (kick) drawLeg(rig.rightLeg); // kick crosses jacket, never becomes a third leg
      // Long narrow neck, angular jaw and distinct swept-up light hair.
      poly([[15,15],[19,15],[20,20],[14,20]],P.ink);
      rect(15,16,4,3,P.skinShade);
      poly([[12,7],[15,5],[20,5],[23,9],[22,16],[19,19],[15,19],[12,16],[11,11]],P.ink);
      poly([[13,8],[16,7],[20,7],[21,10],[21,15],[18,17],[15,17],[13,14]],P.skin);
      poly([[11,9],[13,5],[16,3],[19,4],[22,2],[23,5],[21,8],[18,7],[15,8],[13,11]],P.hair);
      poly([[14,5],[17,2],[20,4],[23,2],[22,5],[18,6]],P.hairLight);
      rect(15,11,2,1,P.ink); rect(19,11,2,1,P.ink);
      rect(18,12,1,2,P.skinShade); rect(17,16,3,1,P.skinShade);
      // Both arms use the shared pose rig; punches extend, hits recoil.
      const drawArm = (arm: typeof rig.leftArm, sleeve: string) => {
        limb(arm.shoulder,arm.elbow,5,P.ink);
        limb(arm.shoulder,arm.elbow,3,sleeve);
        limb(arm.elbow,arm.wrist,4,P.ink);
        limb(arm.elbow,arm.wrist,2,P.skin);
        rect(Math.min(29,arm.wrist[0]-2),arm.wrist[1]-2,4,4,P.skinShade);
      };
      drawArm(rig.leftArm,P.jacketShadow);
      drawArm(rig.rightArm,P.jacketLight);
      if (pose === 'hit') {
        rect(2,12,3,2,P.scarf); rect(28,10,3,2,P.hairLight);
      }
      if (pose === 'respawn') {
        g.globalAlpha = 0.14 + frame * 0.12;
        rect(11,3,13,42,P.scarf);
        g.globalAlpha = 1;
      }
      g.restore();
    }
    texture.refresh();
  }
}
