import Phaser from 'phaser';
import { createState, step, TICK_RATE } from '../simulation/step';
import type { GameState, PlayerInput } from '../simulation/types';

export class StationScene extends Phaser.Scene {
  private state: GameState = createState();
  private elapsedMs = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private fighterGraphics!: Phaser.GameObjects.Graphics;
  private scoreLabel!: Phaser.GameObjects.Text;

  constructor() { super('StationScene'); }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(0x6d8999).fillRect(0, 0, 384, 120);
    g.fillStyle(0xc2a27d).fillRect(0, 38, 160, 85);
    g.fillStyle(0x58463e).fillRect(0, 32, 165, 9);
    for (const x of [13, 55, 97]) {
      g.fillStyle(0x3b5360).fillRect(x, 58, 29, 41);
      g.fillStyle(0xa6c7c9).fillRect(x + 4, 62, 21, 33);
    }
    g.fillStyle(0x293f45).fillRect(45, 44, 76, 17);
    this.add.text(52, 47, 'TURENKI', { fontFamily: 'monospace', fontSize: '11px', color: '#f4e5b4' });
    g.fillStyle(0x506c7c).fillRect(207, 72, 165, 49);
    for (const x of [216, 250, 284, 318]) {
      g.fillStyle(0xacc5c5).fillRect(x, 81, 25, 25);
    }
    g.fillStyle(0x76786f).fillRect(0, 122, 384, 94);
    g.lineStyle(3, 0xd7c9a5).lineBetween(0, 123, 384, 123);
    g.lineBetween(0, 209, 384, 209);
    g.lineStyle(1, 0x92968a).lineBetween(0, 166, 384, 166);

    this.fighterGraphics = this.add.graphics();
    this.scoreLabel = this.add.text(8, 7, '', { fontFamily: 'monospace', fontSize: '11px', color: '#fff1b7', backgroundColor: '#263747' });
    this.add.text(328, 7, 'v0.1', { fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7' });
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
    const g = this.fighterGraphics;
    g.clear();
    const fighters = [...this.state.fighters].sort((a, b) => a.y - b.y);
    for (const f of fighters) {
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      g.fillStyle(0x283640, 0.55).fillEllipse(x, y, 22, 7);
      const bodyY = y - Math.round(f.z);
      g.fillStyle(f.id === 'P1' ? 0xcf665c : 0x54b7ae).fillRect(x - 7, bodyY - 30, 14, 19);
      g.fillStyle(0xe5b58b).fillRect(x - 5, bodyY - 40, 10, 10);
      g.fillStyle(0x343c4d).fillRect(x - 7, bodyY - 43, 14, 4);
      g.fillStyle(0x343c4d).fillRect(x - 6, bodyY - 11, 5, 11).fillRect(x + 2, bodyY - 11, 5, 11);
      g.fillStyle(0xe5b58b).fillRect(x + f.facing * 6, bodyY - 25, f.attackFrames > 0 ? f.facing * 18 : f.facing * 9, 5);
    }
    this.scoreLabel.setText(this.state.fighters.map(f => `${f.id}: ${f.score}`).join('   '));
  }
}

function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  return negative === positive ? 0 : negative ? -1 : 1;
}
