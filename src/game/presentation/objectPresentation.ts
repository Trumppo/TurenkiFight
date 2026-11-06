import type Phaser from 'phaser';
import type { GameState, SimObject } from '../simulation/types';

const TEXTURE_CLASSIC = 'm12-bottle-classic';
const TEXTURE_RETRO = 'm12-bottle-retro';

type ObjectDrawDiagnostic = {
  id: string;
  state: SimObject['state'];
  x: number;
  y: number;
  z: number;
  screenX: number;
  screenY: number;
  visible: boolean;
};

/** Snapshot-only object art shared by the local and online Phaser scenes. */
export class ObjectPresentation {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private readonly hint?: HTMLElement;
  private readonly textureKey: string;

  constructor(private readonly scene: Phaser.Scene, retro: boolean) {
    this.textureKey = retro ? TEXTURE_RETRO : TEXTURE_CLASSIC;
    if (!scene.textures.exists(this.textureKey)) this.createBottleTexture(retro);
    this.hint = document.getElementById('object-hint') ?? undefined;
    if (this.hint) this.hint.hidden = true;
  }

  draw(state: GameState | null): void {
    const objects = state?.objects ?? [];
    const liveIds = new Set(objects.map(object => object.id));
    for (const [id, sprite] of this.sprites) {
      if (liveIds.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
      this.shadows.get(id)?.destroy();
      this.shadows.delete(id);
    }

    for (const object of objects) {
      let sprite = this.sprites.get(object.id);
      if (!sprite) {
        sprite = this.scene.add.image(0, 0, this.textureKey).setOrigin(0.5, 0.5);
        this.sprites.set(object.id, sprite);
        this.shadows.set(object.id, this.scene.add.ellipse(0, 0, 11, 3, 0x172536, 0.72));
      }
      const shadow = this.shadows.get(object.id)!;
      const floorX = Math.round(object.x);
      const floorY = Math.round(object.y);
      const holder = object.state === 'held' ? state?.fighters.find(fighter => fighter.id === object.holder) : undefined;

      if (object.state === 'held' && holder) {
        // Offset the bottle to the front hand instead of drawing it over the
        // fighter's torso. Its anchor follows the holder's facing and jump pose.
        sprite.setPosition(
          Math.round(object.x + holder.facing * 15),
          Math.round(object.y - holder.z - 25),
        ).setAngle(0).setDepth(Math.round(holder.y) + 0.25);
        shadow.setVisible(false);
      } else if (object.state === 'airborne') {
        // x/y/z are authoritative snapshot coordinates. The presentation only
        // projects z upward; it never replays or recomputes the flight arc.
        sprite.setPosition(floorX, Math.round(object.y - object.z))
          .setAngle((object.vx ?? 1) < 0 ? -34 : 34).setDepth(floorY + 0.25);
        shadow.setPosition(floorX, floorY + 1).setScale(0.8, 0.65).setDepth(floorY - 0.25).setVisible(true);
      } else {
        // Ground bottles lie across the floor, away from the amber zone posts.
        sprite.setPosition(floorX, floorY - 2).setAngle(90).setDepth(floorY + 0.25);
        shadow.setPosition(floorX, floorY + 1).setScale(1, 0.75).setDepth(floorY - 0.25).setVisible(true);
      }
      sprite.setVisible(true);
    }

    if (this.hint) this.hint.hidden = !objects.length || state?.phase !== 'fighting';
  }

  diagnostics(state: GameState | null): ObjectDrawDiagnostic[] {
    return (state?.objects ?? []).map(object => {
      const sprite = this.sprites.get(object.id);
      return {
        id: object.id, state: object.state, x: object.x, y: object.y, z: object.z,
        screenX: sprite?.x ?? 0, screenY: sprite?.y ?? 0, visible: sprite?.visible ?? false,
      };
    });
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    for (const shadow of this.shadows.values()) shadow.destroy();
    this.sprites.clear();
    this.shadows.clear();
    if (this.hint) this.hint.hidden = true;
  }

  private createBottleTexture(retro: boolean): void {
    const graphics = this.scene.make.graphics({ x: 0, y: 0 });
    const outline = retro ? 0x182b31 : 0x172536;
    const glass = retro ? 0x3e8c7f : 0x267d71;
    const glassLight = retro ? 0x91d8bc : 0x8ad8bc;
    const label = retro ? 0xffe39a : 0xffefc0;
    const cap = retro ? 0xf17358 : 0xe66e59;

    // Block-by-block bottle silhouette: dark outline, flared shoulders, neck,
    // bright cap and a cream label remain legible after nearest-neighbor scale.
    graphics.fillStyle(outline, 1).fillRect(7, 1, 6, 3);
    graphics.fillStyle(cap, 1).fillRect(8, 2, 4, 1);
    graphics.fillStyle(outline, 1).fillRect(8, 4, 4, 5);
    graphics.fillStyle(glass, 1).fillRect(9, 5, 2, 3);
    graphics.fillStyle(outline, 1).fillRect(6, 8, 8, 3);
    graphics.fillStyle(outline, 1).fillRect(5, 10, 10, 8);
    graphics.fillStyle(outline, 1).fillRect(6, 17, 8, 2);
    graphics.fillStyle(glass, 1).fillRect(7, 9, 6, 8);
    graphics.fillStyle(glass, 1).fillRect(6, 11, 8, 5);
    graphics.fillStyle(glassLight, 1).fillRect(7, 10, 1, 6);
    graphics.fillStyle(label, 1).fillRect(8, 11, 5, 4);
    graphics.fillStyle(retro ? 0x41534a : 0x496655, 1).fillRect(9, 12, 3, 1);
    graphics.fillStyle(glass, 1).fillRect(7, 16, 6, 1);
    graphics.generateTexture(this.textureKey, 20, 20);
    graphics.destroy();
  }
}
