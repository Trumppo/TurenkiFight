import Phaser from 'phaser';
import { createState, step, TICK_RATE } from '../simulation/step';
import type { GameState, PlayerInput } from '../simulation/types';
import { VISUAL } from './visualTheme';
import { createFighterTextures, fighterKey, type FighterPose } from './fighterSprites';

export class StationScene extends Phaser.Scene {
  private state: GameState = createState();
  private elapsedMs = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private fighterSprites = new Map<string, Phaser.GameObjects.Image>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private scoreLabel!: Phaser.GameObjects.Text;
  private hudTimer!: Phaser.GameObjects.Text;
  private elapsedRound = 0;
  private readonly roundLength = 180;
  private previous = new Map<string, { x: number; y: number; health: number }>();
  private hitFlash = new Map<string, number>();

  constructor() { super('StationScene'); }

  preload(): void {
    this.load.svg('station-backdrop', `${import.meta.env.BASE_URL}assets/station/turenki-station-background.svg`, { width: 384, height: 216 });
  }

  create(): void {
    createFighterTextures(this);
    this.add.image(0, 0, 'station-backdrop').setOrigin(0, 0).setDepth(-100);
    // Non-interactive foreground trim remains behind the depth-sorted fighters.
    const hud = this.add.graphics().setDepth(1000);
    hud.fillStyle(0x172536, 0.92).fillRect(0, 0, 384, VISUAL.hudHeight);
    hud.lineStyle(1, VISUAL.colors.cream).lineBetween(0, 23, 384, 23);
    this.scoreLabel = this.add.text(7, 6, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7'
    }).setDepth(1001);
    this.hudTimer = this.add.text(330, 6, '03:00', {
      fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7'
    }).setDepth(1001);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,F,L,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.drawFighters();
  }

  update(_time: number, delta: number): void {
    this.elapsedMs = Math.min(this.elapsedMs + delta, 250);
    const interval = 1000 / TICK_RATE;
    while (this.elapsedMs >= interval) {
      this.state = step(this.state, this.readInputs());
      this.elapsedMs -= interval;
      this.elapsedRound += interval / 1000;
    }
    this.drawFighters();
  }

  private readInputs(): PlayerInput[] {
    const k = this.keys;
    return [
      { playerId: 'P1', moveX: axis(k.A.isDown, k.D.isDown), moveY: axis(k.W.isDown, k.S.isDown), jump: k.SPACE.isDown, attack: k.F.isDown },
      { playerId: 'P2', moveX: axis(this.cursors.left.isDown, this.cursors.right.isDown), moveY: axis(this.cursors.up.isDown, this.cursors.down.isDown), jump: false, attack: k.L.isDown },
    ];
  }

  private drawFighters(): void {
    for (const f of this.state.fighters) {
      if (!this.fighterSprites.has(f.id)) {
        const shadow = this.add.ellipse(0, 0, 22, 7, 0x283640, 0.55);
        const sprite = this.add.image(0, 0, fighterKey(f.id, 'idle', 0)).setOrigin(0.5, 1);
        const label = this.add.text(0, 0, f.id, {
          fontFamily: 'monospace', fontSize: '9px', color: '#fff1b7',
          backgroundColor: '#202a36'
        }).setOrigin(0.5, 1);
        this.shadows.set(f.id, shadow);
        this.fighterSprites.set(f.id, sprite);
        this.labels.set(f.id, label);
      }
      const prev = this.previous.get(f.id);
      const movingX = prev ? Math.abs(prev.x - f.x) > 0.05 : false;
      const movingY = prev ? Math.abs(prev.y - f.y) > 0.05 : false;
      if (prev && f.health < prev.health) this.hitFlash.set(f.id, this.state.tick + 12);
      const hit = (this.hitFlash.get(f.id) ?? 0) > this.state.tick;
      const pose: FighterPose = hit ? 'hit' : f.attackFrames > 0
        ? (f.z > 0 ? 'jumpkick' : 'punch')
        : f.z > 0 ? 'jump' : movingX ? 'walk' : movingY ? 'depth' : 'idle';
      const frame = Math.floor(this.state.tick / (pose === 'idle' ? 15 : 6)) % 4;
      const x = Math.round(f.x), y = Math.round(f.y);
      this.shadows.get(f.id)!.setPosition(x, y).setDepth(y - 0.2);
      this.fighterSprites.get(f.id)!
        .setTexture(fighterKey(f.id, pose, frame))
        .setPosition(x, y - Math.round(f.z))
        .setFlipX(f.facing < 0)
        .setDepth(y);
      this.labels.get(f.id)!.setPosition(x, y - Math.round(f.z) - 47).setDepth(y + 0.1);
      this.previous.set(f.id, { x: f.x, y: f.y, health: f.health });
    }
    this.scoreLabel.setText(this.state.fighters.slice(0, 8).map(f => `${f.id}:${f.score}`).join('  '));
    this.scoreLabel.setFontSize(this.state.fighters.length > 4 ? '7px' : '10px');
    const remaining = Math.max(0, Math.ceil(this.roundLength - this.elapsedRound));
    this.hudTimer.setText(`${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`);
  }
}

function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  return negative === positive ? 0 : negative ? -1 : 1;
}
