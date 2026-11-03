import Phaser from 'phaser';
import { createState, step, standings, TICK_RATE } from '../simulation/step';
import type { EndReason, GameState, ModeId, PlayerInput, Fighter } from '../simulation/types';
import { VISUAL_ASSETS, publicAssetUrl } from './visualAssets';
import { VIEWPORT, cameraScale } from './viewport';
import { createFighterTextures, fighterKey, type FighterPose } from './fighterSprites';
import { createRetroP1Textures, RETRO_PREVIEW } from './retroPrototype';
import { createRetroP2Textures } from './retroP2';
import { createRetroExtraTextures } from './retroExtras';
import { keyboardPlayerInput } from '../input/keyboardMapping';
import { botInput } from '../input/botPolicy';
import { audioControlsHost, createAudioPresentation, type AudioPresentation } from './audio/audioControls';
import { CueBridge } from './audio/cueBridge';
import { arenaBackdropTextureKey, resolveArenaSelection, type ArenaSelection } from './arenaVisuals';
import { MAX_PLAYERS } from '../protocol/players';

const PLAYER_IDS = Array.from({ length: MAX_PLAYERS }, (_, index) => `P${index + 1}`);

const MODE_NAMES: Record<ModeId, string> = {
  'score-brawl': 'Score Brawl',
  'last-man-standing': 'Last Man Standing',
  deathmatch: 'Deathmatch',
};

/**
 * The reset control has two deliberately different outcomes, so the accessible
 * label states both instead of only naming the button.
 */
const RESET_LABEL = 'Reset (Esc). In a match, countdown or results: return to the lobby and keep the '
  + 'players and mode. In the lobby: remove bots and joined players, leaving only P1. The mode is kept.';

function resultReason(state: GameState): EndReason | 'draw' {
  const event = [...state.events].reverse().find(item => item.type === 'MatchEnded');
  if (event?.reason) return event.reason;
  if (state.mode === 'last-man-standing' || state.mode === 'deathmatch') return 'time';
  return 'time';
}

function resultWinner(state: GameState): string | null {
  const event = [...state.events].reverse().find(item => item.type === 'MatchEnded');
  if (event && event.winner !== undefined) return event.winner;
  if (!state.fighters.length) return null;
  const top = standings(state).filter(item => item.rank === 1);
  return top.length === 1 ? top[0].id : null;
}

export class StationScene extends Phaser.Scene {
  private readonly arenaSelection: ArenaSelection;
  private state: GameState = createState(['P1'], 'lobby');
  private selectedMode: ModeId = 'score-brawl';
  private elapsedMs = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private fighterSprites = new Map<string, Phaser.GameObjects.Image>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private domHud?: {
    timer: HTMLElement;
    status: HTMLElement;
    modeSelect: HTMLSelectElement;
    resetButton?: HTMLButtonElement;
    playerList: HTMLElement;
    players: Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement; name: HTMLElement; action: HTMLButtonElement }>;
  };
  private previous = new Map<string, { x: number; y: number; health: number }>();
  private hitFlash = new Map<string, number>();
  private gamepadSlots = new Map<number, string>();
  private reclaimableGamepadSlots = new Set<string>();
  /**
   * Placeholder local-bot roster. Slots in this set are driven by the pure
   * seeded policy from `src/game/input/botPolicy.ts`; P1 is always human.
   * Graphics owns the final lobby control, so this is deliberately a minimal
   * keyboard toggle (B add / V remove) alongside per-slot lobby controls.
   */
  private botSlots = new Set<string>();
  private static readonly BOT_SEED = 0x5eed;
  private lastBotAdd = false;
  private lastBotRemove = false;
  private lastResetKey = false;
  private lastStart = false;
  private lastPadStart = new Map<number, boolean>();
  private lastKeyboardJoin = false;
  private lastJoinButtons = new Map<number, boolean>();
  private lastResult?: { mode: ModeId; reason: EndReason; winner: string | null };
  private audio?: AudioPresentation;
  private audioBridge?: CueBridge;

  constructor(arenaSelection = resolveArenaSelection(window.location.search, RETRO_PREVIEW ? 'retro' : 'classic'), mode: ModeId = 'score-brawl') {
    super('StationScene');
    this.arenaSelection = arenaSelection;
    this.selectedMode = mode;
    this.state = createState({ ids: ['P1'], phase: 'lobby', mode });
  }

  preload(): void {
    const backdrop = VISUAL_ASSETS.station.backdrop;
    const key = arenaBackdropTextureKey(this.arenaSelection.manifest.id);
    const path = this.arenaSelection.backdropPath;
    const retro = this.arenaSelection.style === 'retro';
    this.load.svg(key, publicAssetUrl(import.meta.env.BASE_URL, path), { width: retro ? 640 : backdrop.width, height: retro ? 360 : backdrop.height });
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      if (file.key !== key) return;
      const message = `Could not load ${this.arenaSelection.manifest.displayName} arena art: ${path}`;
      console.error(message);
      const description = document.getElementById('arena-description');
      if (description) description.textContent = message;
    });
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
    const textureKey = arenaBackdropTextureKey(this.arenaSelection.manifest.id);
    const backgroundDepth = this.arenaSelection.layers.find(layer => layer.id === 'architecture')?.depth ?? -100;
    if (this.textures.exists(textureKey)) {
      this.add.image(0, 0, textureKey).setOrigin(0, 0)
        .setDisplaySize(VIEWPORT.logicalWidth, VIEWPORT.logicalHeight).setDepth(backgroundDepth);
    } else {
      this.add.text(12, 42, `ARENA ART ERROR\n${this.arenaSelection.manifest.displayName}\n${this.arenaSelection.backdropPath}`, {
        color: '#fff1b7', backgroundColor: '#172536', fontFamily: 'monospace', fontSize: '14px', padding: { x: 8, y: 6 },
      }).setDepth(1000);
    }
    // Scores, player labels and match status are rendered in the responsive
    // DOM HUD. It occupies the reserved scoreboard band on desktop and moves
    // above the playfield on narrow screens.
    this.initDomHud();
    this.audio = createAudioPresentation(audioControlsHost());
    this.audioBridge = new CueBridge(cue => this.audio?.director.playCue(cue));
    this.audioBridge.observe(this.state);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audioBridge?.reset();
      this.audio?.dispose();
      this.audioBridge = undefined;
      this.audio = undefined;
    });
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,F,G,H,L,K,J,U,B,V,SPACE,ENTER,SHIFT,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
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
    // Explicit reset (Esc / HUD button). It runs before the other edge-triggered
    // actions and re-arms their "already handled" flags, so a held Start, Join
    // or bot key cannot immediately re-apply the action the reset just undid.
    const resetKey = this.keys.ESC.isDown;
    if (resetKey && !this.lastResetKey) this.resetLocal();
    this.lastResetKey = resetKey;
    // The host occupies P1; every additional player must explicitly join.
    const keyboardJoin = this.keys.SHIFT.isDown;
    if (this.state.phase === 'lobby' && keyboardJoin && !this.lastKeyboardJoin && !this.state.fighters.some(f => f.id === 'P2') && ![...this.gamepadSlots.values()].includes('P2')) {
      this.state = createState([...this.state.fighters.map(f => f.id), 'P2'], 'lobby', { mode: this.selectedMode });
    }
    this.lastKeyboardJoin = keyboardJoin;
    // B/V remain keyboard shortcuts for filling/removing bot slots.
    const addBot = this.keys.B.isDown;
    if (addBot && !this.lastBotAdd) this.addBotSlot();
    this.lastBotAdd = addBot;
    const removeBot = this.keys.V.isDown;
    if (removeBot && !this.lastBotRemove) this.removeBotSlot();
    this.lastBotRemove = removeBot;
    // Only a deliberate Start press by the host begins the match.
    // Gamepad button 9 is Start; button 8 is the dedicated Join button.
    if (this.state.phase === 'lobby') {
      for (const pad of pads) {
        const join = !!pad.buttons[8]?.pressed;
        if (join && !this.lastJoinButtons.get(pad.index) && !this.gamepadSlots.has(pad.index)) {
          const assigned = new Set(this.gamepadSlots.values());
          const joinableSlots = PLAYER_IDS.slice(1);
          const id = joinableSlots.find(candidate => this.reclaimableGamepadSlots.has(candidate) && this.state.fighters.some(f => f.id === candidate) && !assigned.has(candidate))
            ?? joinableSlots.find(candidate => !this.state.fighters.some(f => f.id === candidate));
          if (!id) continue;
          this.gamepadSlots.set(pad.index, id);
          this.reclaimableGamepadSlots.delete(id);
          if (!this.state.fighters.some(f => f.id === id)) this.state = createState([...this.state.fighters.map(f => f.id), id], 'lobby', { mode: this.selectedMode });
        }
      }
    }
    for (const pad of pads) this.lastJoinButtons.set(pad.index, !!pad.buttons[8]?.pressed);
    // P1 is initially keyboard-hosted. An unassigned controller may explicitly
    // claim P1 with Start; controllers assigned to another slot cannot start.
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
      this.state = createState(this.state.fighters.map(f => f.id), 'countdown', { mode: this.selectedMode });
      this.lastResult = undefined;
      this.audioBridge?.reset();
      this.previous.clear();
      this.hitFlash.clear();
    }
    this.lastStart = start;

    // A finished match is terminal for the presentation loop. `step` keeps its
    // existing results early-out, which still advances `tick` and clears
    // `events`; calling it here therefore reported ticks beyond the recorded
    // MatchEnded tick (QA finding F2). Countdown and fighting keep the exact
    // fixed-step accumulator below; results does not step at all.
    if (this.state.phase === 'results') {
      // Do not bank wall time while the results screen is open: a rematch must
      // start from an empty accumulator rather than a catch-up burst.
      this.elapsedMs = 0;
    } else {
      this.elapsedMs = Math.min(this.elapsedMs + delta, 250);
      const interval = 1000 / TICK_RATE;
      while (this.elapsedMs >= interval) {
        this.state = step(this.state, this.readInputs(pads));
        this.observeAudio(this.state);
        this.elapsedMs -= interval;
        // The step that ends the match is the last one: stop before the next
        // tick so `state.tick` equals the MatchEnded event tick.
        if (this.state.phase === 'results') {
          this.elapsedMs = 0;
          break;
        }
      }
    }
    this.observeAudio(this.state);
    this.drawFighters();
  }

  /**
   * True when reset would change something: every non-lobby phase, and a lobby
   * that has more than the host in it. The HUD button is disabled otherwise.
   */
  private canResetLocal(): boolean {
    return this.state.phase !== 'lobby' || this.state.fighters.length > 1;
  }

  /**
   * Return to the lobby without reloading the page.
   *
   * - From countdown/fighting/results the roster (humans and bots) and the
   *   selected mode are kept, while the match state itself is recreated: tick,
   *   timer, scores, health, events and the results summary all start fresh.
   * - In the lobby, bots and joined non-host slots are cleared, leaving a
   *   P1-only lobby; the selected mode stays.
   *
   * Presentation state is reset with the simulation state so a finished match
   * cannot animate, flash or report scores into the new lobby.
   */
  private resetLocal(): void {
    if (!this.canResetLocal()) return;
    const clearingLobby = this.state.phase === 'lobby';
    const ids = clearingLobby ? ['P1'] : this.state.fighters.map(fighter => fighter.id);
    if (clearingLobby) {
      this.botSlots.clear();
      this.gamepadSlots.clear();
      this.reclaimableGamepadSlots.clear();
      this.lastPadStart.clear();
      this.lastJoinButtons.clear();
    }
    this.state = createState(ids, 'lobby', { mode: this.selectedMode });
    this.lastResult = undefined;
    this.elapsedMs = 0;
    this.previous.clear();
    this.hitFlash.clear();
    // Clear the cue bridge's seen events and previous frame: the results cue
    // and the results music duck must not carry over into the fresh lobby.
    this.audioBridge?.reset();
    this.audio?.director.setMusicDucked(false);
    // Consume whatever is physically held right now, so the reset does not
    // hand a held key to the lobby action it was just used for.
    const down = (key: string): boolean => this.keys?.[key]?.isDown ?? false;
    this.lastStart = down('ENTER');
    this.lastKeyboardJoin = down('SHIFT');
    this.lastBotAdd = down('B');
    this.lastBotRemove = down('V');
    this.drawFighters();
  }

  /**
   * Fill the requested (or next free) non-host slot with a bot.
   */
  private addBotSlot(requestedId?: string): string | null {
    if (this.state.phase !== 'lobby') return null;
    const id = requestedId
      ? PLAYER_IDS.slice(1).includes(requestedId) && !this.state.fighters.some(fighter => fighter.id === requestedId) ? requestedId : undefined
      : PLAYER_IDS.slice(1).find(candidate => !this.state.fighters.some(fighter => fighter.id === candidate));
    if (!id) return null;
    this.botSlots.add(id);
    this.state = createState([...this.state.fighters.map(fighter => fighter.id), id], 'lobby', { mode: this.selectedMode });
    return id;
  }

  /** Removes the requested bot, or highest-numbered bot; never touches humans. */
  private removeBotSlot(requestedId?: string): string | null {
    if (this.state.phase !== 'lobby') return null;
    const id = requestedId
      ? this.botSlots.has(requestedId) ? requestedId : undefined
      : [...PLAYER_IDS].reverse().find(candidate => this.botSlots.has(candidate));
    if (!id) return null;
    this.botSlots.delete(id);
    const ids = this.state.fighters.map(fighter => fighter.id).filter(candidate => candidate !== id);
    this.state = createState(ids, 'lobby', { mode: this.selectedMode });
    return id;
  }

  /** Read-only audio diagnostics used by browser QA; no simulation state is exposed. */
  audioDiagnostics(): { state: string; muted: boolean; volume: number } {
    const settings = this.audio?.director.settings;
    return { state: this.audio?.director.contextState ?? 'not-created', muted: settings?.muted ?? false, volume: settings?.volume ?? 0.55 };
  }

  private observeAudio(state: GameState): void {
    this.audioBridge?.observe(state);
    this.audio?.director.setMusicDucked(state.phase === 'results');
  }

  private readInputs(pads: Gamepad[]): PlayerInput[] {
    // P1 and human P2 use the keyboard. A bot occupying P2 must not receive
    // stray keyboard input, so P2's layout is only sampled for a human slot.
    const inputs: PlayerInput[] = [
      keyboardPlayerInput('P1', code => this.isKeyboardCodeDown(code)),
    ];
    if (this.state.fighters.some(fighter => fighter.id === 'P2') && !this.botSlots.has('P2')) {
      inputs.push(keyboardPlayerInput('P2', code => this.isKeyboardCodeDown(code)));
    }
    for (const [index, id] of this.gamepadSlots) {
      if (this.botSlots.has(id)) continue;
      const pad = pads.find(p => p.index === index);
      if (!pad) continue;
      const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
      const input: PlayerInput = { playerId: id, moveX: x < -0.3 ? -1 : x > 0.3 ? 1 : 0, moveY: y < -0.3 ? -1 : y > 0.3 ? 1 : 0,
        jump: !!pad.buttons[0]?.pressed, punch: !!pad.buttons[2]?.pressed, kick: !!pad.buttons[1]?.pressed, jumpkick: !!pad.buttons[3]?.pressed };
      const existing = inputs.findIndex(i => i.playerId === id);
      if (existing >= 0) inputs[existing] = input;
      else inputs.push(input);
    }
    for (const id of this.botSlots) {
      if (!this.state.fighters.some(fighter => fighter.id === id)) continue;
      inputs.push(botInput(this.state, id, StationScene.BOT_SEED));
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
    const liveIds = new Set(this.state.fighters.map(fighter => fighter.id));
    for (const [id, sprite] of this.fighterSprites) {
      if (liveIds.has(id)) continue;
      sprite.destroy();
      this.fighterSprites.delete(id);
      this.shadows.get(id)?.destroy();
      this.shadows.delete(id);
      this.previous.delete(id);
      this.hitFlash.delete(id);
    }
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
      } else if (f.eliminated) {
        sprite.setTintFill(0x4a5561).setAlpha(0.72);
      } else {
        sprite.clearTint();
        sprite.setAlpha(1);
      }
      this.previous.set(f.id, { x: f.x, y: f.y, health: f.health });
    }
    this.renderDomHud();
  }

  private initDomHud(): void {
    const timer = document.getElementById('match-timer');
    const status = document.getElementById('match-status');
    const modeSelect = document.getElementById('game-mode') as HTMLSelectElement | null;
    const resetButton = document.getElementById('reset-match') as HTMLButtonElement | null;
    const playerList = document.getElementById('player-hud');
    if (!timer || !status || !modeSelect || !playerList) return;
    const players = new Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement; name: HTMLElement; action: HTMLButtonElement }>();
    for (const node of Array.from(document.querySelectorAll('.hud-player[data-player]'))) {
      const root = node as HTMLElement;
      const id = root.dataset.player;
      const score = root.querySelector('.hud-score') as HTMLElement | null;
      const health = root.querySelector('.hud-health') as HTMLElement | null;
      const name = root.querySelector('.hud-name') as HTMLElement | null;
      const action = root.querySelector('.hud-slot-action') as HTMLButtonElement | null;
      if (id && score && health && name && action) {
        action.addEventListener('click', () => {
          if (this.botSlots.has(id)) this.removeBotSlot(id);
          else this.addBotSlot(id);
          this.drawFighters();
        });
        players.set(id, { root, score, health, name, action });
      }
    }
    modeSelect.value = this.selectedMode;
    modeSelect.addEventListener('change', () => {
      if (this.state.phase !== 'lobby') return;
      this.selectedMode = modeSelect.value as ModeId;
      this.state = createState(this.state.fighters.map(f => f.id), 'lobby', { mode: this.selectedMode });
      this.drawFighters();
    });
    if (resetButton) {
      // The label spells out both behaviours so the lobby case is not a surprise.
      resetButton.setAttribute('aria-label', RESET_LABEL);
      resetButton.title = RESET_LABEL;
      resetButton.addEventListener('click', () => {
        this.resetLocal();
        // Hand focus back to the page: otherwise Enter/Space would keep
        // activating this button instead of the lobby's next action.
        resetButton.blur();
      });
    }
    this.domHud = { timer, status, modeSelect, resetButton: resetButton ?? undefined, playerList, players };
    this.renderDomHud();
  }

  private renderDomHud(): void {
    const hud = this.domHud;
    if (!hud) return;
    if (this.state.phase === 'results') {
      const end = [...this.state.events].reverse().find(event => event.type === 'MatchEnded');
      if (end?.reason) this.lastResult = { mode: this.state.mode ?? 'score-brawl', reason: end.reason, winner: end.winner ?? null };
    }
    const seconds = Math.ceil(this.state.remainingTicks / TICK_RATE);
    const timerText = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (hud.timer.textContent !== timerText) hud.timer.textContent = timerText;
    hud.modeSelect.value = this.selectedMode;
    hud.modeSelect.disabled = this.state.phase !== 'lobby';
    if (hud.resetButton) {
      const resetEnabled = this.canResetLocal();
      if (hud.resetButton.disabled !== !resetEnabled) hud.resetButton.disabled = !resetEnabled;
    }
    hud.playerList.classList.toggle('mode-specific', this.state.mode === 'last-man-standing' || this.state.mode === 'deathmatch');
    for (const [id, nodes] of hud.players) {
      const fighter = this.state.fighters.find(f => f.id === id);
      const isBot = this.botSlots.has(id) && !!fighter;
      nodes.root.classList.toggle('is-empty', !fighter);
      nodes.root.classList.toggle('is-eliminated', !!fighter?.eliminated);
      nodes.root.classList.toggle('is-bot', isBot);
      nodes.root.classList.toggle('is-lobby-slot', this.state.phase === 'lobby');
      const slotNumber = Number(id.slice(1));
      nodes.name.textContent = this.state.phase === 'lobby'
        ? id === 'P1' ? 'P1 HOST' : isBot ? id : fighter ? `${id} HUMAN` : slotNumber === 2 ? `${id} KEY/PAD` : slotNumber <= 4 ? `${id} PAD` : `${id} PAD/BOT`
        : id;
      const canEditBot = this.state.phase === 'lobby' && id !== 'P1' && (!fighter || isBot);
      nodes.action.hidden = !canEditBot;
      nodes.action.textContent = isBot ? '−BOT' : 'BOT';
      nodes.action.setAttribute('aria-label', `${isBot ? 'Remove bot from' : 'Add bot to'} ${id}`);
      if (isBot) nodes.root.dataset.bot = 'true';
      else delete nodes.root.dataset.bot;
      const botTag = isBot ? ', bot' : '';
      let scoreText: string;
      let healthText: string;
      let scoreTitle: string;
      let healthTitle: string;
      let label: string;
      if (!fighter) {
        scoreText = '—';
        healthText = 'HP —';
        scoreTitle = 'No score';
        healthTitle = 'No fighter joined';
        label = `${id}, not joined`;
      } else if (this.state.mode === 'last-man-standing') {
        const status = fighter.eliminated ? 'ELIMINATED' : 'ALIVE';
        scoreText = `S${fighter.eliminated ? 0 : 1}`;
        healthText = fighter.eliminated ? 'OUT' : 'ALIVE';
        scoreTitle = `STOCK ${fighter.eliminated ? 0 : 1}`;
        healthTitle = status;
        label = `${id}${botTag}, stock ${fighter.eliminated ? 0 : 1}, ${status.toLowerCase()}`;
      } else if (this.state.mode === 'deathmatch') {
        const frags = fighter.frags ?? 0;
        const deaths = fighter.deaths ?? 0;
        scoreText = `F${frags}`;
        healthText = `D${deaths}`;
        scoreTitle = `FRAGS ${frags}`;
        healthTitle = `DEATHS ${deaths}`;
        label = `${id}${botTag}, ${frags} frags, ${deaths} deaths, health ${Math.max(0, Math.min(100, fighter.health))}`;
      } else {
        scoreText = String(fighter.score);
        healthText = `H${Math.max(0, Math.min(100, fighter.health))}`;
        scoreTitle = `SCORE ${fighter.score}`;
        healthTitle = `HP ${Math.max(0, Math.min(100, fighter.health))}`;
        label = `${id}${botTag}, score ${fighter.score}, health ${Math.max(0, Math.min(100, fighter.health))}`;
      }
      if (nodes.score.textContent !== scoreText) nodes.score.textContent = scoreText;
      if (nodes.health.textContent !== healthText) nodes.health.textContent = healthText;
      nodes.score.title = scoreTitle;
      nodes.health.title = healthTitle;
      if (nodes.root.getAttribute('aria-label') !== label) nodes.root.setAttribute('aria-label', label);
    }
    let statusText: string;
    let fullStatusText: string;
    if (this.state.phase === 'lobby') {
      fullStatusText = 'LOBBY · P1 HOST · P2 KEYBOARD/GAMEPAD · P3–P4 GAMEPAD · P5–P8 GAMEPAD OR BOT · B/V BOT SHORTCUTS · ENTER/PAD START';
      statusText = window.innerHeight <= 540 ? 'SHIFT/PAD JOIN · START' : 'SHIFT/PAD JOIN · ENTER';
    }
    else if (this.state.phase === 'results') {
      const winner = this.lastResult?.mode === (this.state.mode ?? 'score-brawl') ? this.lastResult.winner : resultWinner(this.state);
      const reason = this.lastResult?.mode === (this.state.mode ?? 'score-brawl') ? this.lastResult.reason : resultReason(this.state);
      if (this.state.mode === 'last-man-standing') {
        const roster = this.state.fighters.map(f => `${f.id} ${f.eliminated ? 'OUT' : 'STOCK 1'}`).join(' · ');
        fullStatusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reason} · ${roster} · ENTER: REMATCH`;
        statusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reason} · ENTER: REMATCH`;
      } else if (this.state.mode === 'deathmatch') {
        const roster = this.state.fighters.map(f => `${f.id} ${f.frags ?? 0}F/${f.deaths ?? 0}D`).join(' · ');
        fullStatusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reason} · ${roster} · ENTER: REMATCH`;
        statusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reason} · ENTER: REMATCH`;
      } else {
        const scoreTable = standings(this.state).map(s => `#${s.rank} ${s.id}: ${s.score}`).join(' · ');
        fullStatusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reason} · ${scoreTable} · ENTER: REMATCH`;
        statusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reason} · ENTER: REMATCH`;
      }
    }
    else if (this.state.phase === 'countdown') {
      const countdown = `START ${Math.ceil(this.state.countdownTicks / TICK_RATE)}`;
      fullStatusText = statusText = this.state.mode ? `${countdown} · ${MODE_NAMES[this.state.mode].toUpperCase()}` : countdown;
    }
    else {
      const fightStatus = this.state.fighters.filter(f => f.koTimer > 0).map(f => `${f.id} KO`).join(' · ') || 'FIGHT';
      fullStatusText = statusText = this.state.mode ? `${fightStatus} · ${MODE_NAMES[this.state.mode].toUpperCase()}` : fightStatus;
    }
    if (hud.status.textContent !== statusText) hud.status.textContent = statusText;
    hud.status.classList.toggle('is-results', this.state.phase === 'results');
    if (hud.status.getAttribute('aria-label') !== fullStatusText) hud.status.setAttribute('aria-label', fullStatusText);
    if (hud.status.title !== fullStatusText) hud.status.title = fullStatusText;
  }

  private pose(f: Fighter, prev?: { x: number; y: number; health: number }): FighterPose {
    if (f.eliminated) return 'ko';
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
