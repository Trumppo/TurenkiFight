import Phaser from 'phaser';
import { createState, step, standings, TICK_RATE } from '../simulation/step';
import type { GameState, PlayerInput, Fighter } from '../simulation/types';
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
  private statusLabel!: Phaser.GameObjects.Text;
  private previous = new Map<string, { x: number; y: number; health: number }>();
  private hitFlash = new Map<string, number>();
  private gamepadSlots = new Map<number, string>();
  private lastRematch = false;

  constructor() { super('StationScene'); }

  preload(): void {
    this.load.svg('station-backdrop', `${import.meta.env.BASE_URL}assets/station/turenki-station-background.svg`, { width: 384, height: 216 });
  }

  create(): void {
    createFighterTextures(this);
    this.add.image(0, 0, 'station-backdrop').setOrigin(0, 0).setDepth(-100);
    const hud = this.add.graphics().setDepth(1000);
    hud.fillStyle(0x172536, 0.92).fillRect(0, 0, 384, VISUAL.hudHeight);
    hud.lineStyle(1, VISUAL.colors.cream).lineBetween(0, 23, 384, 23);
    this.scoreLabel = this.add.text(7, 6, '', { fontFamily: 'monospace', fontSize: '9px', color: '#fff1b7' }).setDepth(1001);
    this.hudTimer = this.add.text(332, 6, '02:00', { fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7' }).setDepth(1001);
    this.statusLabel = this.add.text(192, 34, '', { fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7', backgroundColor: '#172536', align: 'center' }).setOrigin(0.5, 0).setDepth(1002);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,F,G,H,L,K,J,SPACE,ENTER') as Record<string, Phaser.Input.Keyboard.Key>;
    this.drawFighters();
  }

  update(_time: number, delta: number): void {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null) : [];
    if (this.state.phase === 'countdown' && this.state.tick === 0) {
      for (const pad of pads) {
        if (pad.buttons.some(b => b.pressed) && !this.gamepadSlots.has(pad.index) && this.state.fighters.length < 4) {
          const id = `P${this.state.fighters.length + 1}`;
          this.gamepadSlots.set(pad.index, id);
          this.state = createState([...this.state.fighters.map(f => f.id), id]);
        }
      }
    }
    const rematch = this.keys.ENTER.isDown;
    if (this.state.phase === 'results' && rematch && !this.lastRematch) {
      this.state = createState(this.state.fighters.map(f => f.id));
      this.previous.clear();
    }
    this.lastRematch = rematch;
    this.elapsedMs = Math.min(this.elapsedMs + delta, 250);
    const interval = 1000 / TICK_RATE;
    while (this.elapsedMs >= interval) {
      this.state = step(this.state, this.readInputs(pads));
      this.elapsedMs -= interval;
    }
    this.drawFighters();
  }

  private readInputs(pads: Gamepad[]): PlayerInput[] {
    const k = this.keys;
    const inputs: PlayerInput[] = [
      { playerId: 'P1', moveX: axis(k.A.isDown, k.D.isDown), moveY: axis(k.W.isDown, k.S.isDown), jump: k.SPACE.isDown, punch: k.F.isDown, kick: k.G.isDown, jumpkick: k.H.isDown },
      { playerId: 'P2', moveX: axis(this.cursors.left.isDown, this.cursors.right.isDown), moveY: axis(this.cursors.up.isDown, this.cursors.down.isDown), jump: k.K.isDown, punch: k.L.isDown, kick: k.J.isDown, jumpkick: k.K.isDown && k.L.isDown },
    ];
    for (const [index, id] of this.gamepadSlots) {
      const pad = pads.find(p => p.index === index);
      if (!pad) continue;
      const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
      const input: PlayerInput = { playerId: id, moveX: x < -0.3 ? -1 : x > 0.3 ? 1 : 0, moveY: y < -0.3 ? -1 : y > 0.3 ? 1 : 0,
        jump: !!pad.buttons[0]?.pressed, punch: !!pad.buttons[2]?.pressed, kick: !!pad.buttons[1]?.pressed, jumpkick: !!pad.buttons[3]?.pressed };
      const existing = inputs.findIndex(i => i.playerId === id);
      if (existing >= 0) inputs[existing] = input;
      else inputs.push(input);
    }
    return inputs;
  }

  private drawFighters(): void {
    for (const f of this.state.fighters) {
      if (!this.fighterSprites.has(f.id)) {
        this.shadows.set(f.id, this.add.ellipse(0, 0, 22, 7, 0x283640, 0.55));
        this.fighterSprites.set(f.id, this.add.image(0, 0, fighterKey(f.id, 'idle', 0)).setOrigin(0.5, 1));
        this.labels.set(f.id, this.add.text(0, 0, f.id, { fontFamily: 'monospace', fontSize: '9px', color: '#fff1b7', backgroundColor: '#202a36' }).setOrigin(0.5, 1));
      }
      const prev = this.previous.get(f.id);
      if (prev && f.health < prev.health) this.hitFlash.set(f.id, this.state.tick + 12);
      const pose = this.pose(f, prev);
      const frame = Math.floor(this.state.tick / (pose === 'idle' ? 15 : 6)) % 4;
      const x = Math.round(f.x), y = Math.round(f.y);
      this.shadows.get(f.id)!.setPosition(x, y).setDepth(y - 0.2).setVisible(f.koTimer === 0);
      this.fighterSprites.get(f.id)!.setTexture(fighterKey(f.id, pose, frame)).setPosition(x, y - Math.round(f.z)).setFlipX(f.facing < 0).setDepth(y);
      this.labels.get(f.id)!.setPosition(x, y - Math.round(f.z) - 47).setDepth(y + 0.1);
      this.previous.set(f.id, { x: f.x, y: f.y, health: f.health });
    }
    this.scoreLabel.setText(this.state.fighters.map(f => `${f.id}:${f.score}`).join(' '));
    const seconds = Math.ceil(this.state.remainingTicks / TICK_RATE);
    this.hudTimer.setText(`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    if (this.state.phase === 'countdown') this.statusLabel.setText(`START ${Math.ceil(this.state.countdownTicks / TICK_RATE)} | Pad: press button to join`);
    else if (this.state.phase === 'results') this.statusLabel.setText('RESULTS\n' + standings(this.state).map(s => `#${s.rank} ${s.id}: ${s.score}`).join('\n') + '\nENTER: REMATCH');
    else this.statusLabel.setText(this.state.fighters.filter(f => f.koTimer > 0).map(f => `${f.id} KO`).join(' '));
  }

  private pose(f: Fighter, prev?: { x: number; y: number; health: number }): FighterPose {
    if (f.koTimer) return 'ko';
    if (f.protection > 0) return 'respawn';
    if ((this.hitFlash.get(f.id) ?? 0) > this.state.tick) return 'hit';
    if (f.attackMove) return f.attackMove;
    if (f.z > 0) return 'jump';
    if (prev && Math.abs(prev.x - f.x) > 0.05) return 'walk';
    if (prev && Math.abs(prev.y - f.y) > 0.05) return 'depth';
    return 'idle';
  }
}
function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  return negative === positive ? 0 : negative ? -1 : 1;
}
