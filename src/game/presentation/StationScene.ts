import Phaser from 'phaser';
import { createState, step, standings, TICK_RATE } from '../simulation/step';
import type { GameState, PlayerInput, Fighter } from '../simulation/types';
import { VISUAL_ASSETS, publicAssetUrl } from './visualAssets';
import { VIEWPORT, cameraScale } from './viewport';
import { createFighterTextures, fighterKey, type FighterPose } from './fighterSprites';
import { createRetroP1Textures, RETRO_PREVIEW, RETRO_STATION_PATH } from './retroPrototype';
import { createRetroP2Textures } from './retroP2';
import { createRetroExtraTextures } from './retroExtras';
import { keyboardPlayerInput } from '../input/keyboardMapping';

export class StationScene extends Phaser.Scene {
  private state: GameState = createState(['P1'], 'lobby');
  private elapsedMs = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private fighterSprites = new Map<string, Phaser.GameObjects.Image>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private domHud?: {
    timer: HTMLElement;
    status: HTMLElement;
    players: Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement }>;
  };
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
    // Scores, player labels and match status are rendered in the responsive
    // DOM HUD. It occupies the reserved scoreboard band on desktop and moves
    // above the playfield on narrow screens.
    this.initDomHud();
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
    const inputs: PlayerInput[] = [
      keyboardPlayerInput('P1', code => this.isKeyboardCodeDown(code)),
      keyboardPlayerInput('P2', code => this.isKeyboardCodeDown(code)),
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

  /**
   * Adapter from the canonical DOM-key layout in `src/game/input` to Phaser's
   * key objects. Arrow keys come from `createCursorKeys()`; letter and Space
   * keys come from the named `addKeys` list created in `create()`.
   */
  private isKeyboardCodeDown(code: string): boolean {
    switch (code) {
      case 'ArrowLeft': return this.cursors.left.isDown;
      case 'ArrowRight': return this.cursors.right.isDown;
      case 'ArrowUp': return this.cursors.up.isDown;
      case 'ArrowDown': return this.cursors.down.isDown;
      case 'Space': return this.keys.SPACE.isDown;
      default: {
        const phaserKey = code.startsWith('Key') ? code.slice(3) : code;
        return this.keys[phaserKey]?.isDown ?? false;
      }
    }
  }

  private drawFighters(): void {
    for (const f of this.state.fighters) {
      if (!this.fighterSprites.has(f.id)) {
        this.shadows.set(f.id, this.add.ellipse(0, 0, 22, 7, 0x283640, 0.55));
        this.fighterSprites.set(f.id, this.add.image(0, 0, fighterKey(f.id, 'idle', 0)).setOrigin(0.5, 1));
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
      this.previous.set(f.id, { x: f.x, y: f.y, health: f.health });
    }
    this.renderDomHud();
  }

  private initDomHud(): void {
    const timer = document.getElementById('match-timer');
    const status = document.getElementById('match-status');
    if (!timer || !status) return;
    const players = new Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement }>();
    for (const node of Array.from(document.querySelectorAll('.hud-player[data-player]'))) {
      const root = node as HTMLElement;
      const id = root.dataset.player;
      const score = root.querySelector('.hud-score') as HTMLElement | null;
      const health = root.querySelector('.hud-health') as HTMLElement | null;
      if (id && score && health) players.set(id, { root, score, health });
    }
    this.domHud = { timer, status, players };
    this.renderDomHud();
  }

  private renderDomHud(): void {
    const hud = this.domHud;
    if (!hud) return;
    const seconds = Math.ceil(this.state.remainingTicks / TICK_RATE);
    const timerText = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (hud.timer.textContent !== timerText) hud.timer.textContent = timerText;
    for (const [id, nodes] of hud.players) {
      const fighter = this.state.fighters.find(f => f.id === id);
      nodes.root.classList.toggle('is-empty', !fighter);
      const scoreText = fighter ? String(fighter.score) : '—';
      const healthValue = fighter ? Math.max(0, Math.min(100, fighter.health)) : undefined;
      const healthText = healthValue === undefined ? 'HP —' : `HP ${healthValue}`;
      const label = fighter
        ? `${id}, score ${fighter.score}, health ${Math.max(0, Math.min(100, fighter.health))}`
        : `${id}, not joined`;
      if (nodes.score.textContent !== scoreText) nodes.score.textContent = scoreText;
      if (nodes.health.textContent !== healthText) nodes.health.textContent = healthText;
      if (nodes.root.getAttribute('aria-label') !== label) nodes.root.setAttribute('aria-label', label);
    }
    let statusText: string;
    let fullStatusText: string;
    if (this.state.phase === 'lobby') {
      fullStatusText = 'LOBBY · SHIFT/PAD JOIN · ENTER/PAD START';
      statusText = window.innerHeight <= 540 ? 'SHIFT/PAD JOIN · START' : fullStatusText;
    }
    else if (this.state.phase === 'countdown') fullStatusText = statusText = `START ${Math.ceil(this.state.countdownTicks / TICK_RATE)}`;
    else if (this.state.phase === 'results') fullStatusText = statusText = `RESULTS · ${standings(this.state).map(s => `#${s.rank} ${s.id}: ${s.score}`).join(' · ')} · ENTER: REMATCH`;
    else fullStatusText = statusText = this.state.fighters.filter(f => f.koTimer > 0).map(f => `${f.id} KO`).join(' · ') || 'FIGHT';
    if (hud.status.textContent !== statusText) hud.status.textContent = statusText;
    if (hud.status.getAttribute('aria-label') !== fullStatusText) hud.status.setAttribute('aria-label', fullStatusText);
    if (hud.status.title !== fullStatusText) hud.status.title = fullStatusText;
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
