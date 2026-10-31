import Phaser from 'phaser';
import { createState, step, standings, TICK_RATE } from '../simulation/step';
import type { GameState, PlayerInput, Fighter } from '../simulation/types';
import { VISUAL } from './visualTheme';
import { VISUAL_ASSETS, publicAssetUrl } from './visualAssets';
import { VIEWPORT, cameraScale } from './viewport';
import { createFighterTextures, fighterKey, type FighterPose } from './fighterSprites';
import { createRetroP1Textures, RETRO_PREVIEW, RETRO_STATION_PATH } from './retroPrototype';
import { createRetroP2Textures } from './retroP2';
import { createRetroExtraTextures } from './retroExtras';

export class StationScene extends Phaser.Scene {
  private state: GameState = createState(['P1'], 'lobby');
  private elapsedMs = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private fighterSprites = new Map<string, Phaser.GameObjects.Image>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private scoreLabel!: Phaser.GameObjects.Text;
  private playerHud = new Map<string, Phaser.GameObjects.Text>();
  private hudTimer!: Phaser.GameObjects.Text;
  private statusLabel!: Phaser.GameObjects.Text;
  private previous = new Map<string, { x: number; y: number; health: number }>();
  private hitFlash = new Map<string, number>();
  private gamepadSlots = new Map<number, string>();
  private reclaimableGamepadSlots = new Set<string>();
  private lastStart = false;
  private lastPadStart = new Map<number, boolean>();
  private lastKeyboardJoin = false;
  private lastJoinButtons = new Map<number, boolean>();

  constructor() { super('StationScene'); }

  preload(): void {
    const backdrop = VISUAL_ASSETS.station.backdrop;
    const path = RETRO_PREVIEW ? RETRO_STATION_PATH : backdrop.path;
    this.load.svg(backdrop.key, publicAssetUrl(import.meta.env.BASE_URL, path), { width: RETRO_PREVIEW ? 640 : backdrop.width, height: RETRO_PREVIEW ? 360 : backdrop.height });
  }

  create(): void {
    this.cameras.main.setZoom(cameraScale(this.scale.width, this.scale.height));
    this.cameras.main.centerOn(VIEWPORT.logicalWidth / 2, VIEWPORT.logicalHeight / 2);
    createFighterTextures(this);
    if (RETRO_PREVIEW) {
      createRetroP1Textures(this);
      createRetroP2Textures(this);
      createRetroExtraTextures(this);
    }
    this.add.image(0, 0, VISUAL_ASSETS.station.backdrop.key).setOrigin(0, 0)
      .setDisplaySize(VIEWPORT.logicalWidth, VIEWPORT.logicalHeight).setDepth(-100);
    const hud = this.add.graphics().setDepth(1000);
    hud.fillStyle(0x172536, 0.92).fillRect(0, 0, VIEWPORT.logicalWidth, Math.max(35, VISUAL.hudHeight));
    hud.lineStyle(1, VISUAL.colors.cream).lineBetween(0, 35, VIEWPORT.logicalWidth, 35);
    if (RETRO_PREVIEW) {
      // Pixel-art scoreboard: crisp inset, corner pixels and four player slots.
      hud.fillStyle(0x101a27, 1).fillRect(2, 2, VIEWPORT.logicalWidth - 4, 31);
      hud.lineStyle(1, 0xc7a76a, 1).strokeRect(2, 2, VIEWPORT.logicalWidth - 4, 31);
      hud.lineStyle(1, 0x526a70, 1);
      for (let slot = 1; slot < 4; slot++) {
        const x = Math.round(slot * VIEWPORT.logicalWidth / 4);
        hud.lineBetween(x, 3, x, 32);
      }
      hud.fillStyle(0xf4d38d, 1);
      for (const x of [3, VIEWPORT.logicalWidth - 5]) {
        hud.fillRect(x, 3, 2, 2);
        hud.fillRect(x, 30, 2, 2);
      }
    }
    this.scoreLabel = this.add.text(7, 6, '', { fontFamily: 'monospace', fontSize: '9px', color: '#fff1b7' }).setDepth(1001).setVisible(false);
    this.hudTimer = this.add.text(192, 26, '02:00', { fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7' }).setOrigin(0.5, 0).setDepth(1001);
    this.statusLabel = this.add.text(192, 42, '', { fontFamily: 'monospace', fontSize: '10px', color: '#fff1b7', backgroundColor: '#172536', align: 'center' }).setOrigin(0.5, 0).setDepth(1002);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,F,G,H,L,K,J,U,SPACE,ENTER,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
    this.drawFighters();
  }

  update(_time: number, delta: number): void {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null) : [];
    // Release missing gamepads and their button-edge state. The roster remains
    // stable; an absent controller contributes no input until explicitly rejoined.
    const connected = new Set(pads.map(pad => pad.index));
    for (const [index, id] of this.gamepadSlots) {
      if (!connected.has(index)) {
        if (id !== 'P1') this.reclaimableGamepadSlots.add(id);
        this.gamepadSlots.delete(index);
      }
    }
    for (const index of this.lastPadStart.keys()) if (!connected.has(index)) this.lastPadStart.delete(index);
    for (const index of this.lastJoinButtons.keys()) if (!connected.has(index)) this.lastJoinButtons.delete(index);
    // The host occupies P1; every additional player must explicitly join.
    const keyboardJoin = this.keys.SHIFT.isDown;
    if (this.state.phase === 'lobby' && keyboardJoin && !this.lastKeyboardJoin && !this.state.fighters.some(f => f.id === 'P2') && ![...this.gamepadSlots.values()].includes('P2')) {
      this.state = createState([...this.state.fighters.map(f => f.id), 'P2'], 'lobby');
    }
    this.lastKeyboardJoin = keyboardJoin;
    // Only a deliberate Start press by the host begins the match.
    // Gamepad button 9 is Start; button 8 is the dedicated Join button.
    if (this.state.phase === 'lobby') {
      for (const pad of pads) {
        const join = !!pad.buttons[8]?.pressed;
        if (join && !this.lastJoinButtons.get(pad.index) && !this.gamepadSlots.has(pad.index)) {
          const assigned = new Set(this.gamepadSlots.values());
          const id = ['P2', 'P3', 'P4'].find(candidate => this.reclaimableGamepadSlots.has(candidate) && this.state.fighters.some(f => f.id === candidate) && !assigned.has(candidate))
            ?? (this.state.fighters.length < 4 ? ['P2', 'P3', 'P4'].find(candidate => !this.state.fighters.some(f => f.id === candidate)) : undefined);
          if (!id) continue;
          this.gamepadSlots.set(pad.index, id);
          this.reclaimableGamepadSlots.delete(id);
          if (!this.state.fighters.some(f => f.id === id)) this.state = createState([...this.state.fighters.map(f => f.id), id], 'lobby');
        }
      }
    }
    for (const pad of pads) this.lastJoinButtons.set(pad.index, !!pad.buttons[8]?.pressed);
    // P1 is initially keyboard-hosted. An unassigned controller may explicitly
    // claim P1 with Start; controllers already assigned to P2-P4 cannot start.
    // Never auto-claim merely because a controller is connected.
    const padHostStart = pads.some(p => {
      const pressed = !!p.buttons[9]?.pressed;
      const fresh = pressed && !this.lastPadStart.get(p.index);
      if (fresh && this.state.fighters.length >= 2 && !this.gamepadSlots.has(p.index) && ![...this.gamepadSlots.values()].includes('P1')) {
        this.gamepadSlots.set(p.index, 'P1');
      }
      return fresh && this.gamepadSlots.get(p.index) === 'P1';
    });
    for (const pad of pads) this.lastPadStart.set(pad.index, !!pad.buttons[9]?.pressed);
    const start = this.keys.ENTER.isDown;
    if (((start && !this.lastStart) || padHostStart) && (this.state.phase === 'results' || (this.state.phase === 'lobby' && this.state.fighters.length >= 2))) {
      this.state = createState(this.state.fighters.map(f => f.id));
      this.previous.clear();
      this.hitFlash.clear();
    }
    this.lastStart = start;

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
      { playerId: 'P2', moveX: axis(this.cursors.left.isDown, this.cursors.right.isDown), moveY: axis(this.cursors.up.isDown, this.cursors.down.isDown), jump: k.K.isDown, punch: k.L.isDown, kick: k.J.isDown, jumpkick: k.U.isDown },
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
      const sprite = this.fighterSprites.get(f.id)!;
      sprite.setTexture(fighterKey(f.id, pose, frame)).setPosition(x, y - Math.round(f.z)).setFlipX(f.facing < 0).setDepth(y);
      // Retro-only high-contrast hit confirmation. Clear tint on the first non-hit frame
      // so reused sprites never retain a flash after KO, respawn or a new match.
      if (RETRO_PREVIEW && (this.hitFlash.get(f.id) ?? 0) > this.state.tick && this.state.tick % 6 < 3) {
        sprite.setTintFill(0xffe3a0);
      } else {
        sprite.clearTint();
      }
      this.labels.get(f.id)!.setPosition(x, y - Math.round(f.z) - 47).setDepth(y + 0.1);
      this.previous.set(f.id, { x: f.x, y: f.y, health: f.health });
    }
    const segment = VIEWPORT.logicalWidth / this.state.fighters.length;
    for (const [index, f] of this.state.fighters.entries()) {
      if (!this.playerHud.has(f.id)) {
        this.playerHud.set(f.id, this.add.text(0, 3, '', {
          fontFamily: 'monospace', fontSize: '9px', color: '#fff1b7',
        }).setDepth(1001));
      }
      this.playerHud.get(f.id)!.setPosition(Math.round(index * segment + 4), 3)
        .setText(`${f.id} HP ${Math.max(0, Math.min(100, f.health))}\n${f.score} ${f.koTimer ? 'KO' : ''}`);
    }
    const seconds = Math.ceil(this.state.remainingTicks / TICK_RATE);
    this.hudTimer.setText(`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    if (this.state.phase === 'lobby') {
      const joined = this.state.fighters.map(f => `${f.id}:${[...this.gamepadSlots.entries()].find(([, id]) => id === f.id)?.[0] !== undefined ? 'PAD' : 'KEY'}`).join(' ');
      this.statusLabel.setText(`LOBBY ${joined}\nSHIFT/PAD SELECT: JOIN | P1 ENTER/PAD START`);
    }
    else if (this.state.phase === 'countdown') this.statusLabel.setText(`START ${Math.ceil(this.state.countdownTicks / TICK_RATE)}`);
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
