import Phaser from 'phaser';
import { createState, step, standings, TICK_RATE, WAVE_RULES } from '../simulation/step';
import type { ArenaId, EndReason, GameEvent, GameState, ModeId, PlayerInput, Fighter, Team } from '../simulation/types';
import { VISUAL_ASSETS, publicAssetUrl } from './visualAssets';
import { VIEWPORT, cameraScale } from './viewport';
import { createFighterTextures, fighterKey, type FighterPose } from './fighterSprites';
import { createRetroP1Textures, RETRO_PREVIEW } from './retroPrototype';
import { createRetroP2Textures } from './retroP2';
import { createRetroExtraTextures } from './retroExtras';
import { createRetroP5P8Textures } from './retroP5P8';
import {
  KEYBOARD_BINDINGS, KEYBOARD_SLOTS, KeyboardMappingStore, bindingLabel, displayKey,
  keyboardPlayerInput, type KeyboardBinding, type KeyboardSlot,
} from '../input/keyboardMapping';
import { GAMEPAD_BUTTONS, gamepadPlayerInput } from '../input/gamepadMapping';
import { botInput } from '../input/botPolicy';
import { rankMatch } from '../simulation/ranking';
import type { MatchRanking, RankedEntry } from '../simulation/ranking';
import { playerColor } from './visualTheme';
import { createFighterMarker, fighterMarkerDiagnostics, fighterMarkerOffset, type FighterMarker } from './fighterMarker';
import { audioControlsHost, createAudioPresentation, type AudioPresentation } from './audio/audioControls';
import { CueBridge, type AudioCue } from './audio/cueBridge';
import { arenaBackdropTextureKey, resolveArenaSelection, type ArenaSelection } from './arenaVisuals';
import { MAX_PLAYERS } from '../protocol/players';
import { drawZoneGraphics, zonePresentation, zoneSummaryText } from './zonePresentation';
import { ObjectPresentation } from './objectPresentation';
import { ArenaTelegraphPresentation, hazardDamagePreemptedByKnockout, observedHazardDamage } from './arenaTelegraph';
import { StationEventPresentation } from './stationEvent';

const PLAYER_IDS = Array.from({ length: MAX_PLAYERS }, (_, index) => `P${index + 1}`);

const MODE_NAMES: Record<ModeId, string> = {
  'score-brawl': 'Score Brawl',
  'last-man-standing': 'Last Man Standing',
  deathmatch: 'Deathmatch',
  wave: 'Wave (Asemahalli)',
};

const RESULT_REASON_LABELS: Partial<Record<EndReason, string>> = { 'waves-cleared': 'WAVES CLEARED' };

/**
 * The reset control has two deliberately different outcomes, so the accessible
 * label states both instead of only naming the button.
 */
const RESET_LABEL = 'Reset (Esc). In a match, countdown or results: return to the lobby and keep the '
  + 'players and mode. In the lobby: remove bots and joined players, leaving only P1. The mode is kept.';
const ALL_BOT_RESET_LABEL = 'Reset (Esc). In the all-bot match, return to the lobby with a human P1 and no bots. '
  + 'Use ALL BOTS again to start another all-bot match.';

function resultReason(state: GameState): EndReason {
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
  private state!: GameState;
  private selectedMode: ModeId = 'score-brawl';
  private elapsedMs = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyboardStore!: KeyboardMappingStore;
  private readonly pressedKeyboardCodes = new Set<string>();
  private keyboardCapture?: { slot: KeyboardSlot; binding: KeyboardBinding };
  private keyboardCaptureMessage = '';
  private keyboardKeyDownHandler?: (event: KeyboardEvent) => void;
  private keyboardKeyUpHandler?: (event: KeyboardEvent) => void;
  private keyboardBlurHandler?: () => void;
  private fighterSprites = new Map<string, Phaser.GameObjects.Image>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private zoneGraphics?: Phaser.GameObjects.Graphics;
  private itemPresentation?: ObjectPresentation;
  private arenaTelegraph?: ArenaTelegraphPresentation;
  private stationEvent?: StationEventPresentation;
  private fighterMarkers = new Map<string, FighterMarker>();
  /** Kept as the existing presentation diagnostic interface; now always visible. */
  private koMarkers = new Map<string, Phaser.GameObjects.Text>();
  private domHud?: {
    timer: HTMLElement;
    status: HTMLElement;
    modeSelect: HTMLSelectElement;
    waveStatus?: HTMLElement;
    waveNumber?: HTMLElement;
    waveEnemies?: HTMLElement;
    waveCountdown?: HTMLElement;
    startButton?: HTMLButtonElement;
    allBotsButton?: HTMLButtonElement;
    zoneStatus?: HTMLElement;
    zoneSummary?: HTMLElement;
    zoneDanger?: HTMLElement;
    resetButton?: HTMLButtonElement;
    pauseButton?: HTMLButtonElement;
    allBotsPanel?: HTMLElement;
    waveHelp?: HTMLElement;
    playerList: HTMLElement;
    players: Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement; name: HTMLElement; action: HTMLButtonElement }>;
  };
  private previous = new Map<string, { x: number; y: number; health: number }>();
  private hitFlash = new Map<string, number>();
  private gamepadSlots = new Map<number, string>();
  private reclaimableGamepadSlots = new Set<string>();
  /** Restore an explicit pairing after reconnect when index and device id survive. */
  private rememberedGamepadSlots = new Map<number, { id: string; slot: string }>();
  private connectedGamepadIndices: number[] = [];
  /** Slots in this set are driven by the pure seeded bot policy. */
  private botSlots = new Set<string>();
  /** All-bot matches reset to the normal human P1 lobby, unlike ordinary rematches. */
  private allBotMatch = false;
  private static readonly BOT_SEED = 0x5eed;
  private lastBotAdd = false;
  private lastBotRemove = false;
  private lastAllBots = false;
  private lastResetKey = false;
  private paused = false;
  private lastStart = false;
  private lastPadStart = new Map<number, boolean>();
  private lastKeyboardJoin = false;
  private lastJoinButtons = new Map<number, boolean>();
  private lastResult?: { mode: ModeId; reason: EndReason; winner: string | null };
  /** Full event stream observed by this local scene; state.events is only one tick. */
  private matchEvents: GameEvent[] = [];
  private resultRanking?: MatchRanking;
  private resultPresentationReady = false;
  private revealTimer?: Phaser.Time.TimerEvent;
  private revealKeyHandler?: (event: KeyboardEvent) => void;
  private revealClickHandler?: () => void;
  private audio?: AudioPresentation;
  private audioBridge?: CueBridge;
  private readonly audioCueCounts: Partial<Record<AudioCue, number>> = {};
  private victoryCueEndKey?: string;
  private reducedMotionQuery?: MediaQueryList;
  private reducedMotionListener?: (event: MediaQueryListEvent) => void;
  private cameraShakeCount = 0;
  private lastCameraShake?: { reason: 'hit' | 'knockout'; duration: number; intensity: number };
  private lastDrawTick?: number;
  private lastHazardFeedbackTick = -1;

  constructor(arenaSelection = resolveArenaSelection(window.location.search, RETRO_PREVIEW ? 'retro' : 'classic'), mode: ModeId = 'score-brawl') {
    super('StationScene');
    this.arenaSelection = arenaSelection;
    this.selectedMode = mode;
    this.state = this.createLobbyState(['P1']);
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
    // Keep Phaser's existing host/join shortcuts ready before the DOM editor is
    // built; the deterministic browser harness also sets these polled keys.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,F,G,H,T,L,K,J,U,I,B,V,O,SPACE,ENTER,SHIFT,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cameras.main.setZoom(cameraScale(this.scale.width, this.scale.height));
    this.cameras.main.centerOn(VIEWPORT.logicalWidth / 2, VIEWPORT.logicalHeight / 2);
    createFighterTextures(this);
    if (RETRO_PREVIEW) {
      createRetroP1Textures(this);
      createRetroP2Textures(this);
      createRetroExtraTextures(this);
      createRetroP5P8Textures(this);
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
    this.zoneGraphics = this.add.graphics().setDepth(122).setVisible(false);
    this.itemPresentation = new ObjectPresentation(this, RETRO_PREVIEW);
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Private browsing may disable storage. */ }
    this.keyboardStore = new KeyboardMappingStore(storage);
    const persistedKeyboardSlots = (['P3', 'P4'] as const).filter(slot => this.keyboardStore.hasKeyboardBindings(slot));
    if (persistedKeyboardSlots.length) {
      this.state = this.createLobbyState([...this.state.fighters.map(fighter => fighter.id), ...persistedKeyboardSlots]);
    }
    // Scores, player labels and match status are rendered in the responsive
    // DOM HUD. It occupies the reserved scoreboard band on desktop and moves
    // above the playfield on narrow screens.
    this.initDomHud();
    this.audio = createAudioPresentation(audioControlsHost());
    this.audioBridge = new CueBridge(cue => this.playAudioCue(cue));
    if (this.arenaSelection.manifest.id === 'station') {
      const status = document.getElementById('station-event-status');
      if (status) this.stationEvent = new StationEventPresentation(this, status, cue => this.playAudioCue(cue), RETRO_PREVIEW);
    }
    this.arenaTelegraph = new ArenaTelegraphPresentation(this, cue => this.playAudioCue(cue));
    this.audioBridge.observe(this.state);
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotionListener = event => {
      if (event.matches) this.cameras.main.shakeEffect.reset();
    };
    this.reducedMotionQuery.addEventListener('change', this.reducedMotionListener);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearRevealState();
      if (this.revealKeyHandler) document.removeEventListener('keydown', this.revealKeyHandler);
      if (this.revealClickHandler) document.removeEventListener('click', this.revealClickHandler);
      if (this.keyboardKeyDownHandler) window.removeEventListener('keydown', this.keyboardKeyDownHandler, true);
      if (this.keyboardKeyUpHandler) window.removeEventListener('keyup', this.keyboardKeyUpHandler, true);
      if (this.keyboardBlurHandler) window.removeEventListener('blur', this.keyboardBlurHandler);
      this.pressedKeyboardCodes.clear();
      if (this.reducedMotionQuery && this.reducedMotionListener) {
        this.reducedMotionQuery.removeEventListener('change', this.reducedMotionListener);
      }
      this.reducedMotionQuery = undefined;
      this.reducedMotionListener = undefined;
      this.audioBridge?.reset();
      this.audio?.dispose();
      this.itemPresentation?.destroy();
      this.itemPresentation = undefined;
      this.arenaTelegraph?.destroy();
      this.arenaTelegraph = undefined;
      this.stationEvent?.destroy();
      this.stationEvent = undefined;
      this.audioBridge = undefined;
      this.audio = undefined;
    });
    this.keyboardKeyDownHandler = event => {
      this.pressedKeyboardCodes.add(event.code);
      if (!this.keyboardCapture) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        this.keyboardCapture = undefined;
        this.pressedKeyboardCodes.delete(event.code);
        this.keyboardCaptureMessage = 'Capture cancelled.';
        this.renderKeyboardEditor();
        return;
      }
      const { slot, binding } = this.keyboardCapture;
      const result = this.keyboardStore.setBinding(slot, binding, event.code);
      this.pressedKeyboardCodes.delete(event.code);
      if (!result.ok) {
        this.keyboardCaptureMessage = result.conflict;
        this.renderKeyboardEditor();
        return;
      }
      this.keyboardCapture = undefined;
      this.keyboardCaptureMessage = `${slot} ${bindingLabel(binding)} set to ${displayKey(event.code)}.`;
      if (slot === 'P3' || slot === 'P4') this.ensureKeyboardSlotJoined(slot);
      this.renderKeyboardEditor();
      this.updateKeyboardGuide();
      this.drawFighters();
    };
    this.keyboardKeyUpHandler = event => { this.pressedKeyboardCodes.delete(event.code); };
    this.keyboardBlurHandler = () => this.pressedKeyboardCodes.clear();
    window.addEventListener('keydown', this.keyboardKeyDownHandler, true);
    window.addEventListener('keyup', this.keyboardKeyUpHandler, true);
    window.addEventListener('blur', this.keyboardBlurHandler);
    this.revealKeyHandler = event => {
      if (event.code === 'KeyP') {
        if (!event.repeat) {
          if (this.canPauseLocal()) {
            event.preventDefault();
            this.togglePause();
          } else this.finishReveal();
        }
        return;
      }
      if (event.key === 'Escape') {
        // Handle Esc on keydown as well as through Phaser's polled key state.
        // This keeps a quick press from being lost between scene frames.
        if (this.canResetLocal()) {
          event.preventDefault();
          this.resetLocal();
          this.lastResetKey = true;
        }
        return;
      }
      this.finishReveal();
    };
    this.revealClickHandler = () => this.finishReveal();
    document.addEventListener('keydown', this.revealKeyHandler);
    document.addEventListener('click', this.revealClickHandler);
    this.drawFighters();
  }

  update(_time: number, delta: number): void {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null) : [];
    this.connectedGamepadIndices = pads.map(pad => pad.index).sort((a, b) => a - b);
    // Release missing gamepads and their button-edge state. The roster remains
    // stable; an absent controller contributes no input until explicitly rejoined.
    const connected = new Set(pads.map(pad => pad.index));
    for (const [index, id] of this.gamepadSlots) {
      if (!connected.has(index)) {
        if (id !== 'P1') this.reclaimableGamepadSlots.add(id);
        const remembered = this.rememberedGamepadSlots.get(index);
        if (remembered) remembered.slot = id;
        this.gamepadSlots.delete(index);
      }
    }
    // Browsers commonly preserve both Gamepad.index and Gamepad.id on a
    // reconnect. Rebind only when both match, never just because an index was
    // recycled for a different controller.
    for (const pad of pads) {
      const remembered = this.rememberedGamepadSlots.get(pad.index);
      if (!remembered || !pad.id || pad.id !== remembered.id || this.gamepadSlots.has(pad.index)) continue;
      if ([...this.gamepadSlots.values()].includes(remembered.slot)) continue;
      if (!this.state.fighters.some(fighter => fighter.id === remembered.slot)) continue;
      this.gamepadSlots.set(pad.index, remembered.slot);
      this.reclaimableGamepadSlots.delete(remembered.slot);
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
      this.state = this.createLobbyState([...this.state.fighters.map(f => f.id), 'P2']);
    }
    this.lastKeyboardJoin = keyboardJoin;
    // B/V remain keyboard shortcuts for filling/removing bot slots.
    const addBot = this.keys.B.isDown;
    if (addBot && !this.lastBotAdd) this.addBotSlot();
    this.lastBotAdd = addBot;
    const removeBot = this.keys.V.isDown;
    if (removeBot && !this.lastBotRemove) this.removeBotSlot();
    this.lastBotRemove = removeBot;
    const allBots = this.keys.O.isDown;
    if (allBots && !this.lastAllBots) this.startAllBotMatch();
    this.lastAllBots = allBots;
    // Only a deliberate Start press by the host begins the match.
    // Gamepad button 9 is Start; button 8 is the dedicated Join button.
    if (this.state.phase === 'lobby') {
      for (const pad of pads) {
        const join = !!pad.buttons[GAMEPAD_BUTTONS.join]?.pressed;
        if (join && !this.lastJoinButtons.get(pad.index) && !this.gamepadSlots.has(pad.index)) {
          const assigned = new Set(this.gamepadSlots.values());
          const joinableSlots = PLAYER_IDS.slice(1);
          const id = joinableSlots.find(candidate => this.reclaimableGamepadSlots.has(candidate) && this.state.fighters.some(f => f.id === candidate) && !assigned.has(candidate))
            ?? joinableSlots.find(candidate => !this.state.fighters.some(f => f.id === candidate));
          if (!id) continue;
          this.gamepadSlots.set(pad.index, id);
          if (pad.id) this.rememberedGamepadSlots.set(pad.index, { id: pad.id, slot: id });
          this.reclaimableGamepadSlots.delete(id);
          if (!this.state.fighters.some(f => f.id === id)) this.state = this.createLobbyState([...this.state.fighters.map(f => f.id), id]);
        }
      }
    }
    for (const pad of pads) this.lastJoinButtons.set(pad.index, !!pad.buttons[GAMEPAD_BUTTONS.join]?.pressed);
    // P1 is initially keyboard-hosted. An unassigned controller may explicitly
    // claim P1 with Start; controllers assigned to another slot cannot start.
    // Never auto-claim merely because a controller is connected.
    const padHostStart = pads.some(p => {
      const pressed = !!p.buttons[GAMEPAD_BUTTONS.start]?.pressed;
      const fresh = pressed && !this.lastPadStart.get(p.index);
      if (fresh && this.state.fighters.length >= 2 && !this.gamepadSlots.has(p.index) && ![...this.gamepadSlots.values()].includes('P1')) {
        this.gamepadSlots.set(p.index, 'P1');
        if (p.id) this.rememberedGamepadSlots.set(p.index, { id: p.id, slot: 'P1' });
      }
      return fresh && this.gamepadSlots.get(p.index) === 'P1';
    });
    for (const pad of pads) this.lastPadStart.set(pad.index, !!pad.buttons[GAMEPAD_BUTTONS.start]?.pressed);
    const start = this.keys.ENTER.isDown;
    if (((start && !this.lastStart) || padHostStart) && (this.state.phase === 'results' || this.canStartLocalMatch())) this.startLocalMatch();
    this.lastStart = start;
    // A finished match is terminal for the presentation loop. `step` keeps its
    // existing results early-out, which still advances `tick` and clears
    // `events`; calling it here therefore reported ticks beyond the recorded
    // MatchEnded tick (QA finding F2). Countdown and fighting keep the exact
    // fixed-step accumulator below; results does not step at all.
    if (this.state.phase === 'results') {
      if (!this.resultPresentationReady) this.prepareResultsPresentation();
      // Do not bank wall time while the results screen is open: a rematch must
      // start from an empty accumulator rather than a catch-up burst.
      this.elapsedMs = 0;
    } else if (this.paused) {
      // Freeze locally without calling the simulation or accumulating wall time.
      this.elapsedMs = 0;
    } else {
      this.elapsedMs = Math.min(this.elapsedMs + delta, 250);
      const interval = 1000 / TICK_RATE;
      while (this.elapsedMs >= interval) {
        const previousPhase = this.state.phase;
        this.state = step(this.state, this.readInputs(pads));
        this.observeCameraPunch(this.state);
        if (previousPhase === 'fighting' || this.state.phase === 'fighting' || this.state.phase === 'results') {
          this.matchEvents.push(...this.state.events);
        }
        this.observeAudio(this.state);
        this.elapsedMs -= interval;
        // The step that ends the match is the last one: stop before the next
        // tick so `state.tick` equals the MatchEnded event tick.
        if (this.state.phase === 'results') {
          this.prepareResultsPresentation();
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

  private canPauseLocal(): boolean {
    return this.state.phase === 'countdown' || this.state.phase === 'fighting';
  }

  private togglePause(): void {
    if (!this.canPauseLocal()) return; // Results and lobby remain terminal/unambiguous.
    this.paused = !this.paused;
    this.elapsedMs = 0;
    this.drawFighters();
  }

  /**
   * Return to the lobby without reloading the page.
   *
   * - From a normal match, the roster and selected mode are kept. From an
   *   all-bot match, RESET deliberately restores a human P1-only lobby.
   * - In either case the match state is recreated: tick, timer, scores, health,
   *   events and the results summary all start fresh.
   * - In the lobby, bots and joined non-host slots are cleared, leaving a
   *   P1-only lobby; the selected mode stays.
   *
   * Presentation state is reset with the simulation state so a finished match
   * cannot animate, flash or report scores into the new lobby.
   */
  private resetLocal(): void {
    if (!this.canResetLocal()) return;
    const clearingLobby = this.state.phase === 'lobby';
    const clearingAllBotMatch = this.allBotMatch && !clearingLobby;
    const ids = clearingLobby || clearingAllBotMatch ? ['P1'] : this.state.fighters.map(fighter => fighter.id);
    if (clearingLobby || clearingAllBotMatch) {
      this.botSlots.clear();
      this.gamepadSlots.clear();
      this.reclaimableGamepadSlots.clear();
      this.rememberedGamepadSlots.clear();
      this.lastPadStart.clear();
      this.lastJoinButtons.clear();
    }
    this.allBotMatch = false;
    this.paused = false;
    this.state = this.createLobbyState(ids);
    this.lastResult = undefined;
    this.matchEvents = [];
    this.resultRanking = undefined;
    this.resultPresentationReady = false;
    this.victoryCueEndKey = undefined;
    this.clearRevealState();
    this.elapsedMs = 0;
    this.previous.clear();
    this.hitFlash.clear();
    this.lastDrawTick = undefined;
    this.lastHazardFeedbackTick = -1;
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
    this.lastAllBots = down('O');
    this.drawFighters();
  }

  /** Start a normal match or rematch without repeating its presentation reset. */
  private startLocalMatch(): void {
    if (this.state.phase === 'lobby' && !this.canStartLocalMatch()) return;
    const ids = this.state.fighters.map(f => f.id);
    this.state = createState(ids, 'countdown', {
      mode: this.selectedMode,
      ...(this.simulationArenaId() ? { arena: this.simulationArenaId() } : {}),
      ...(this.selectedMode === 'wave' ? { teams: this.waveTeams(ids) } : {}),
    });
    this.paused = false;
    this.elapsedMs = 0;
    this.lastResult = undefined;
    this.matchEvents = [];
    this.resultRanking = undefined;
    this.resultPresentationReady = false;
    this.victoryCueEndKey = undefined;
    this.clearRevealState();
    this.audioBridge?.reset();
    this.previous.clear();
    this.hitFlash.clear();
    this.lastDrawTick = undefined;
    this.lastHazardFeedbackTick = -1;
  }

  /** Fill P1-P8 with bots and immediately begin the countdown. */
  private startAllBotMatch(): void {
    if (this.state.phase !== 'lobby' || this.selectedMode === 'wave') return;
    this.botSlots = new Set(PLAYER_IDS);
    this.gamepadSlots.clear();
    this.reclaimableGamepadSlots.clear();
    this.rememberedGamepadSlots.clear();
    this.lastPadStart.clear();
    this.lastJoinButtons.clear();
    this.allBotMatch = true;
    this.state = this.createLobbyState(PLAYER_IDS);
    this.startLocalMatch();
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
    this.state = this.createLobbyState([...this.state.fighters.map(fighter => fighter.id), id]);
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
    this.state = this.createLobbyState(ids);
    return id;
  }

  /** Rebuild a lobby using its selected local rules; an incomplete wave roster stays a neutral lobby. */
  private createLobbyState(ids: string[]): GameState {
    const arena = this.simulationArenaId();
    const arenaSetup = arena ? { arena } : {};
    if (this.selectedMode !== 'wave') return createState({ ids, phase: 'lobby', mode: this.selectedMode, ...arenaSetup });
    if (!this.waveRosterReady(ids)) return createState({ ids, phase: 'lobby', ...arenaSetup });
    return createState({ ids, phase: 'lobby', mode: 'wave', teams: this.waveTeams(ids), ...arenaSetup });
  }

  /** Presentation arena choice becomes simulation data only when non-station. */
  private simulationArenaId(): ArenaId | undefined {
    const id = this.arenaSelection.manifest.id;
    return id === 'mesku' || id === 'kkauppa' ? id : undefined;
  }

  private waveTeams(ids: string[]): Record<string, Team> {
    return Object.fromEntries(ids.map(id => [id, this.botSlots.has(id) ? 'enemies' : 'players'])) as Record<string, Team>;
  }

  private waveRosterReady(ids = this.state.fighters.map(fighter => fighter.id)): boolean {
    const humans = ids.filter(id => !this.botSlots.has(id)).length;
    const bots = ids.filter(id => this.botSlots.has(id)).length;
    return humans > 0 && bots > 0;
  }

  /** Lobby Start requires two fighters normally, and both control sides in Wave. */
  private canStartLocalMatch(): boolean {
    if (this.state.phase !== 'lobby') return false;
    return this.selectedMode === 'wave'
      ? this.waveRosterReady()
      : this.state.fighters.length >= 2;
  }

  /** Read-only audio diagnostics used by browser QA; no simulation state is exposed. */
  audioDiagnostics(): { state: string; muted: boolean; volume: number; cueCounts: Partial<Record<AudioCue, number>> } {
    const settings = this.audio?.director.settings;
    return {
      state: this.audio?.director.contextState ?? 'not-created',
      muted: settings?.muted ?? false,
      volume: settings?.volume ?? 0.55,
      cueCounts: { ...this.audioCueCounts },
    };
  }

  /** Minimal presentation-only camera diagnostics for browser QA. */
  cameraPunchDiagnostics(): {
    shakeCount: number;
    lastShake: { reason: 'hit' | 'knockout'; duration: number; intensity: number } | null;
    isShaking: boolean;
    reducedMotion: boolean;
  } {
    return {
      shakeCount: this.cameraShakeCount,
      lastShake: this.lastCameraShake ?? null,
      isShaking: this.cameras.main.shakeEffect.isRunning,
      reducedMotion: this.reducedMotionQuery?.matches ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }

  private observeCameraPunch(state: GameState): void {
    if (this.reducedMotionQuery?.matches ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const knockout = state.events.some(event => event.type === 'Knockout');
    if (knockout) {
      this.triggerCameraShake('knockout', 140, 0.007);
    } else if (state.events.some(event => event.type === 'HitLanded')) {
      // A barely perceptible one-pixel nudge; the KO impact takes precedence
      // when HitLanded and Knockout are emitted together.
      this.triggerCameraShake('hit', 32, 0.0015);
    }
  }

  private triggerCameraShake(reason: 'hit' | 'knockout', duration: number, intensity: number): void {
    this.cameraShakeCount++;
    this.lastCameraShake = { reason, duration, intensity };
    this.cameras.main.shake(duration, intensity, true);
  }

  private playAudioCue(cue: AudioCue): void {
    this.audioCueCounts[cue] = (this.audioCueCounts[cue] ?? 0) + 1;
    this.audio?.director.playCue(cue);
  }

  private observeAudio(state: GameState): void {
    this.audioBridge?.observe(state);
    this.audio?.director.setMusicDucked(state.phase === 'results');
  }

  private readInputs(pads: Gamepad[]): PlayerInput[] {
    // Every locally assigned layout is sampled once. The DOM pressed set adds
    // support for arbitrary codes; Phaser is retained as a compatibility
    // fallback for the original/default keys and deterministic scene harnesses.
    const inputs: PlayerInput[] = [];
    for (const id of KEYBOARD_SLOTS) {
      if (this.state.fighters.some(fighter => fighter.id === id)
        && !this.botSlots.has(id)
        && this.keyboardStore.hasKeyboardBindings(id)) {
        inputs.push(keyboardPlayerInput(id, code => this.isKeyboardCodeDown(code), this.keyboardStore.layoutFor(id)));
      }
    }
    for (const [index, id] of this.gamepadSlots) {
      if (this.botSlots.has(id)) continue;
      const pad = pads.find(p => p.index === index);
      if (!pad) continue;
      const input = gamepadPlayerInput(id, pad);
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

  private isKeyboardCodeDown(code: string): boolean {
    if (this.keyboardCapture) return false;
    if (this.pressedKeyboardCodes.has(code)) return true;
    // Phaser remains the compatibility source for the original layouts and
    // deterministic scene harnesses. This is a boolean fallback, not a second
    // PlayerInput: each slot is emitted exactly once by readInputs().
    if (code === 'ArrowLeft') return this.cursors?.left.isDown ?? false;
    if (code === 'ArrowRight') return this.cursors?.right.isDown ?? false;
    if (code === 'ArrowUp') return this.cursors?.up.isDown ?? false;
    if (code === 'ArrowDown') return this.cursors?.down.isDown ?? false;
    const key = code === 'Space' ? 'SPACE' : code.startsWith('Key') ? code.slice(3) : code;
    return this.keys?.[key]?.isDown ?? false;
  }

  private ensureKeyboardSlotJoined(slot: KeyboardSlot): void {
    if (this.state.phase !== 'lobby') return;
    if (this.botSlots.has(slot)) this.removeBotSlot(slot);
    if (!this.state.fighters.some(fighter => fighter.id === slot)) {
      this.state = this.createLobbyState([...this.state.fighters.map(fighter => fighter.id), slot]);
    }
  }

  private drawFighters(): void {
    const arena = this.state.arena;
    this.arenaTelegraph?.update(this.state.tick, this.state.phase === 'fighting', arena);
    this.stationEvent?.update(this.state.tick, this.state.phase === 'fighting');
    drawZoneGraphics(this.zoneGraphics!, zonePresentation(this.state), this.state.tick);
    const liveIds = new Set(this.state.fighters.map(fighter => fighter.id));
    for (const [id, sprite] of this.fighterSprites) {
      if (liveIds.has(id)) continue;
      sprite.destroy();
      this.fighterSprites.delete(id);
      this.shadows.get(id)?.destroy();
      this.shadows.delete(id);
      const marker = this.fighterMarkers.get(id);
      marker?.face.destroy();
      marker?.label.destroy();
      this.fighterMarkers.delete(id);
      this.koMarkers.delete(id);
      this.previous.delete(id);
      this.hitFlash.delete(id);
    }
    for (const f of this.state.fighters) {
      if (!this.fighterSprites.has(f.id)) {
        this.shadows.set(f.id, this.add.ellipse(0, 0, 22, 7, 0x283640, 0.55));
        this.fighterSprites.set(f.id, this.add.image(0, 0, fighterKey(f.id, 'idle', 0)).setOrigin(0.5, 1));
        const marker = createFighterMarker(this, f.id);
        this.fighterMarkers.set(f.id, marker);
        this.koMarkers.set(f.id, marker.label);
      }
      const prev = this.previous.get(f.id);
      if (prev && f.health < prev.health) this.hitFlash.set(f.id, this.state.tick + 12);
      if (prev && this.lastHazardFeedbackTick !== this.state.tick && !hazardDamagePreemptedByKnockout(this.state, f) && observedHazardDamage(
        this.lastDrawTick ?? this.state.tick - 1, this.state.tick, arena, this.state.phase === 'fighting',
        prev.health, f.health, prev.y, f.y,
      )) {
        this.lastHazardFeedbackTick = this.state.tick;
        this.arenaTelegraph?.notifyDamage(this.state.tick);
        if (!(this.reducedMotionQuery?.matches ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
          this.cameras.main.shake(70, 0.002, true);
        }
      }
      const pose = this.pose(f, prev);
      const frame = Math.floor(this.state.tick / (pose === 'idle' ? 15 : 6)) % 4;
      const x = Math.round(f.x), y = Math.round(f.y);
      this.shadows.get(f.id)!.setPosition(x, y).setDepth(y - 0.2).setVisible(f.koTimer === 0);
      const sprite = this.fighterSprites.get(f.id)!;
      sprite.setTexture(fighterKey(f.id, pose, frame)).setPosition(x, y - Math.round(f.z)).setFlipX(f.facing < 0).setDepth(y);
      // Keep one strong retro hit-pop frame in each six-tick cycle, then show the
      // character's pixels on the remaining flash frames so the silhouette persists.
      if (f.eliminated) {
        // Multiply tint darkens a KO without hiding its outline, gear or uniform.
        sprite.setTint(0x8995a0).setAlpha(0.92);
      } else if (RETRO_PREVIEW && (this.hitFlash.get(f.id) ?? 0) > this.state.tick) {
        if (this.state.tick % 6 === 0) sprite.setTintFill(0xffe3a0).setAlpha(1);
        else sprite.setTint(0xffe3a0).setAlpha(1);
      } else {
        sprite.clearTint();
        sprite.setAlpha(1);
      }
      // Keep the slot tag visible in every pose, including KO and respawn.
      // Per-ID offsets fan the tags out when several fighters crowd together.
      const down = f.eliminated || f.koTimer > 0;
      let markerX: number;
      let markerY: number;
      if (down) {
        const playerNumber = Number(f.id.slice(1));
        const koHeadOffset = [15, 15, 15, 15, 21, 22, 18, 19][playerNumber - 1] ?? 19;
        markerX = x + 10 * (f.facing < 0 ? -1 : 1);
        markerY = y - Math.round(f.z) - koHeadOffset - 2;
      } else {
        const markerOffset = fighterMarkerOffset(f.id);
        markerX = Phaser.Math.Clamp(x + markerOffset.x, 14, VIEWPORT.logicalWidth - 14);
        markerY = Phaser.Math.Clamp(y - Math.round(f.z) + markerOffset.y, 12, VIEWPORT.logicalHeight - 12);
      }
      const marker = this.fighterMarkers.get(f.id)!;
      marker.face.setPosition(markerX, markerY);
      marker.label.setPosition(markerX, markerY);
      this.previous.set(f.id, { x: f.x, y: f.y, health: f.health });
    }
    this.lastDrawTick = this.state.tick;
    this.arenaTelegraph?.update(this.state.tick, this.state.phase === 'fighting', arena);
    this.itemPresentation?.draw(this.state);
    this.renderDomHud();
  }

  /** Read-only item draw diagnostics for browser visual QA. */
  debugObjects(): ReturnType<ObjectPresentation['diagnostics']> {
    return this.itemPresentation?.diagnostics(this.state) ?? [];
  }

  /** Read-only player marker diagnostics for semantic visual QA. */
  debugPlayerMarkers(): ReturnType<typeof fighterMarkerDiagnostics> {
    return fighterMarkerDiagnostics(this.fighterMarkers);
  }

  private initDomHud(): void {
    const timer = document.getElementById('match-timer');
    const status = document.getElementById('match-status');
    const modeSelect = document.getElementById('game-mode') as HTMLSelectElement | null;
    const waveStatus = document.getElementById('wave-status');
    const waveNumber = document.getElementById('wave-number');
    const waveEnemies = document.getElementById('wave-enemies');
    const waveCountdown = document.getElementById('wave-countdown');
    const zoneStatus = document.getElementById('zone-status');
    const zoneSummary = document.getElementById('zone-summary');
    const zoneDanger = document.getElementById('zone-danger');
    const resetButton = document.getElementById('reset-match') as HTMLButtonElement | null;
    const pauseButton = document.getElementById('pause-match') as HTMLButtonElement | null;
    const allBotsButton = document.getElementById('all-bots-match') as HTMLButtonElement | null;
    const startButton = document.getElementById('start-match') as HTMLButtonElement | null;
    const allBotsPanel = document.getElementById('lobby-actions');
    const waveHelp = document.getElementById('wave-lobby-help');
    const playerList = document.getElementById('player-hud');
    const keyboardEditor = document.getElementById('keyboard-editor') as HTMLDetailsElement | null;
    const keyboardSlotSelect = document.getElementById('keyboard-slot') as HTMLSelectElement | null;
    const keyboardActions = document.getElementById('keyboard-actions');
    const keyboardMessage = document.getElementById('keyboard-message');
    const resetKeyboardSlot = document.getElementById('keyboard-reset-slot') as HTMLButtonElement | null;
    const resetAllKeyboard = document.getElementById('keyboard-reset-all') as HTMLButtonElement | null;
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
      this.state = this.createLobbyState(this.state.fighters.map(f => f.id));
      this.drawFighters();
    });
    keyboardSlotSelect?.addEventListener('change', () => {
      this.keyboardCapture = undefined;
      this.keyboardCaptureMessage = '';
      this.renderKeyboardEditor();
    });
    keyboardActions?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-key-binding]');
      const binding = button?.dataset.keyBinding as KeyboardBinding | undefined;
      if (!button || !binding || !KEYBOARD_BINDINGS.includes(binding)) return;
      const slot = keyboardSlotSelect?.value as KeyboardSlot | undefined;
      if (!slot || !KEYBOARD_SLOTS.includes(slot)) return;
      this.keyboardCapture = { slot, binding };
      this.keyboardCaptureMessage = `Press a key for ${slot} ${bindingLabel(binding)}. Escape cancels.`;
      this.renderKeyboardEditor();
    });
    resetKeyboardSlot?.addEventListener('click', () => {
      const slot = (keyboardSlotSelect?.value ?? 'P1') as KeyboardSlot;
      this.keyboardStore.resetSlot(slot);
      this.keyboardCapture = undefined;
      this.keyboardCaptureMessage = `${slot} restored to its defaults.`;
      if ((slot === 'P3' || slot === 'P4') && this.gamepadSlotFor(slot) === undefined && !this.botSlots.has(slot)) {
        this.removeKeyboardOnlySlot(slot);
      }
      this.renderKeyboardEditor();
      this.updateKeyboardGuide();
      this.drawFighters();
    });
    resetAllKeyboard?.addEventListener('click', () => {
      this.keyboardStore.resetAll();
      this.keyboardCapture = undefined;
      this.keyboardCaptureMessage = 'All keyboard bindings restored to defaults.';
      for (const slot of ['P4', 'P3'] as const) {
        if (this.gamepadSlotFor(slot) === undefined && !this.botSlots.has(slot)) this.removeKeyboardOnlySlot(slot);
      }
      this.renderKeyboardEditor();
      this.updateKeyboardGuide();
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
    pauseButton?.addEventListener('click', () => {
      this.togglePause();
      pauseButton.blur();
    });
    allBotsButton?.addEventListener('click', () => {
      this.startAllBotMatch();
      allBotsButton.blur();
    });
    startButton?.addEventListener('click', () => {
      this.startLocalMatch();
      startButton.blur();
    });
    this.domHud = {
      timer, status, modeSelect,
      waveStatus: waveStatus ?? undefined, waveNumber: waveNumber ?? undefined,
      waveEnemies: waveEnemies ?? undefined, waveCountdown: waveCountdown ?? undefined,
      startButton: startButton ?? undefined, allBotsButton: allBotsButton ?? undefined,
      waveHelp: waveHelp ?? undefined,
      zoneStatus: zoneStatus ?? undefined, zoneSummary: zoneSummary ?? undefined,
      zoneDanger: zoneDanger ?? undefined, resetButton: resetButton ?? undefined,
      pauseButton: pauseButton ?? undefined,
      allBotsPanel: allBotsPanel ?? undefined, playerList, players,
    };
    if (keyboardEditor) keyboardEditor.hidden = false;
    this.renderKeyboardEditor();
    this.updateKeyboardGuide();
    this.renderDomHud();
  }

  private renderKeyboardEditor(): void {
    const editor = document.getElementById('keyboard-editor');
    const slotSelect = document.getElementById('keyboard-slot') as HTMLSelectElement | null;
    const actions = document.getElementById('keyboard-actions');
    const message = document.getElementById('keyboard-message');
    if (!editor || !slotSelect || !actions || !message || !this.keyboardStore) return;
    const slot = KEYBOARD_SLOTS.includes(slotSelect.value as KeyboardSlot) ? slotSelect.value as KeyboardSlot : 'P1';
    const layout = this.keyboardStore.layoutFor(slot);
    const current = new Map<KeyboardBinding, string>([
      ['moveXNegative', layout.moveX[0]], ['moveXPositive', layout.moveX[1]],
      ['moveYNegative', layout.moveY[0]], ['moveYPositive', layout.moveY[1]],
      ['jump', layout.jump], ['punch', layout.punch], ['kick', layout.kick],
      ['jumpkick', layout.jumpkick], ['grab', layout.grab],
    ]);
    const compactLabel: Record<KeyboardBinding, string> = {
      moveXNegative: 'LEFT', moveXPositive: 'RIGHT', moveYNegative: 'UP', moveYPositive: 'DOWN',
      jump: 'JUMP', punch: 'PUNCH', kick: 'KICK', jumpkick: 'J.KICK', grab: 'GRAB',
    };
    const fragment = document.createDocumentFragment();
    for (const binding of KEYBOARD_BINDINGS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'keyboard-binding';
      button.dataset.keyBinding = binding;
      const isCapturing = this.keyboardCapture?.slot === slot && this.keyboardCapture.binding === binding;
      button.textContent = isCapturing ? 'PRESS KEY · ESC' : `${compactLabel[binding]} ${displayKey(current.get(binding) ?? '') || '—'}`;
      button.setAttribute('aria-label', `${slot} ${bindingLabel(binding)}: ${current.get(binding) ? displayKey(current.get(binding)!) : 'unassigned'}. Press to change.`);
      button.title = `Change ${slot} ${bindingLabel(binding)}`;
      fragment.append(button);
    }
    actions.replaceChildren(fragment);
    message.textContent = this.keyboardCaptureMessage || (slot === 'P3' || slot === 'P4'
      ? 'P3/P4 use keyboard only after keys are assigned; otherwise use a gamepad.'
      : 'Select an action, press a key; Escape cancels.');
    editor.hidden = this.state.phase !== 'lobby';
  }

  private updateKeyboardGuide(): void {
    if (!this.keyboardStore) return;
    const guide = document.querySelector<HTMLDetailsElement>('details.controls');
    const table = guide?.querySelector('table');
    const header = table?.tHead?.rows[0];
    if (guide && table && header && !table.dataset.liveKeyboardColumns) {
      header.cells[3]!.textContent = 'Gamepad';
      for (const slot of ['P3', 'P4'] as const) {
        const cell = document.createElement('th');
        cell.textContent = slot;
        header.insertBefore(cell, header.cells[3] ?? null);
      }
      const rows = Array.from(table.tBodies[0]?.rows ?? []);
      for (const row of rows.slice(0, 6)) {
        row.insertCell(3);
        row.insertCell(4);
      }
      table.dataset.liveKeyboardColumns = 'true';
      const summary = guide.querySelector('summary');
      if (summary) summary.textContent = 'Keyboard P1-P4 · P3/P4 keyboard after assignment · gamepad P1-P8';
      const note = guide.querySelector<HTMLElement>('.controls-note');
      if (note) note.textContent = 'P3/P4 remain gamepad slots until keys are assigned in the lobby KEYS panel; assigning a key joins that keyboard player. This table updates to current persisted bindings. Gamepad buttons apply to all pad-controlled slots. Pause: P or HUD button. Grab: LB (button 4).';
    }
    const rows = Array.from(table?.tBodies[0]?.rows ?? []);
    for (const slot of KEYBOARD_SLOTS) {
      const layout = this.keyboardStore.layoutFor(slot);
      const column = slot === 'P1' ? 1 : slot === 'P2' ? 2 : slot === 'P3' ? 3 : 4;
      const values = [
        [layout.moveY[0], layout.moveX[0], layout.moveY[1], layout.moveX[1]].filter(Boolean).map(displayKey).join(' / ') || '—',
        displayKey(layout.jump) || '—', displayKey(layout.punch) || '—', displayKey(layout.kick) || '—',
        displayKey(layout.jumpkick) || '—', displayKey(layout.grab) || '—',
      ];
      values.forEach((value, index) => {
        const cell = rows[index]?.cells[column];
        if (cell) cell.textContent = value;
      });
    }
  }

  private removeKeyboardOnlySlot(slot: 'P3' | 'P4'): void {
    if (this.state.phase !== 'lobby' || !this.state.fighters.some(fighter => fighter.id === slot)) return;
    this.state = this.createLobbyState(this.state.fighters.map(fighter => fighter.id).filter(id => id !== slot));
  }

  private renderDomHud(): void {
    const hud = this.domHud;
    if (!hud) return;
    const keyboardEditor = document.getElementById('keyboard-editor');
    if (keyboardEditor) keyboardEditor.hidden = this.state.phase !== 'lobby';
    if (this.state.phase !== 'lobby') this.keyboardCapture = undefined;
    if (this.state.phase !== 'results' && !document.getElementById('victory-reveal')?.hidden) this.hideVictoryReveal();
    const seconds = Math.ceil(this.state.remainingTicks / TICK_RATE);
    const timerText = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (hud.timer.textContent !== timerText) hud.timer.textContent = timerText;
    hud.modeSelect.value = this.selectedMode;
    hud.modeSelect.disabled = this.state.phase !== 'lobby';
    const wave = this.state.mode === 'wave' ? this.state.wave : undefined;
    if (hud.waveStatus) hud.waveStatus.hidden = !wave || this.state.phase === 'lobby';
    if (wave && hud.waveNumber && hud.waveEnemies && hud.waveCountdown) {
      const waveCount = this.state.mode === 'wave' ? WAVE_RULES.count : 0;
      const shownWave = Math.max(1, Math.min(waveCount, wave.index + 1));
      hud.waveNumber.textContent = `WAVE ${shownWave}/${waveCount}`;
      hud.waveEnemies.textContent = `ENEMIES ${wave.remaining}`;
      const countdownSeconds = Math.ceil(wave.countdownTicks / TICK_RATE);
      hud.waveCountdown.hidden = countdownSeconds <= 0;
      hud.waveCountdown.textContent = countdownSeconds > 0 ? `NEXT WAVE IN ${countdownSeconds}` : '';
      hud.waveStatus?.setAttribute('aria-label', `Wave ${shownWave} of ${waveCount}, ${wave.remaining} enemies remaining${countdownSeconds > 0 ? `, next wave in ${countdownSeconds} seconds` : ''}`);
    }
    const zone = zonePresentation(this.state);
    if (hud.zoneStatus) {
      hud.zoneStatus.hidden = !zone.active;
      hud.zoneStatus.classList.toggle('is-warning', zone.warning);
      hud.zoneStatus.classList.toggle('is-warning-flash', zone.warningFlash);
    }
    if (hud.zoneSummary) hud.zoneSummary.textContent = zoneSummaryText(zone);
    if (hud.zoneDanger) {
      hud.zoneDanger.hidden = zone.dangerIds.length === 0;
      hud.zoneDanger.textContent = zone.dangerIds.length
        ? `DANGER OUTSIDE SAFE AREA · ${zone.dangerIds.join(' · ')}`
        : '';
    }
    if (hud.resetButton) {
      const resetEnabled = this.canResetLocal();
      if (hud.resetButton.disabled !== !resetEnabled) hud.resetButton.disabled = !resetEnabled;
      const resetLabel = this.allBotMatch ? ALL_BOT_RESET_LABEL : RESET_LABEL;
      if (hud.resetButton.title !== resetLabel) hud.resetButton.title = resetLabel;
      if (hud.resetButton.getAttribute('aria-label') !== resetLabel) hud.resetButton.setAttribute('aria-label', resetLabel);
    }
    if (hud.pauseButton) {
      const enabled = this.canPauseLocal();
      hud.pauseButton.disabled = !enabled;
      hud.pauseButton.textContent = this.paused ? 'RESUME' : 'PAUSE';
      hud.pauseButton.setAttribute('aria-label', this.paused
        ? 'Resume local match (P)'
        : 'Pause local match (P). Disabled during lobby and results.');
      hud.pauseButton.title = this.paused ? 'Resume the local match (P)' : 'Pause the local match (P)';
      hud.pauseButton.setAttribute('aria-pressed', String(this.paused));
    }
    if (hud.allBotsPanel) hud.allBotsPanel.hidden = this.state.phase !== 'lobby';
    if (hud.waveHelp) hud.waveHelp.hidden = this.selectedMode !== 'wave' || this.state.phase !== 'lobby';
    if (hud.startButton) hud.startButton.disabled = !this.canStartLocalMatch();
    if (hud.allBotsButton) {
      hud.allBotsButton.disabled = this.selectedMode === 'wave';
      hud.allBotsButton.title = this.selectedMode === 'wave'
        ? 'Wave requires at least one human player; all-bot matches cannot start.'
        : 'Fill all 8 slots with bots and start. P1 is bot-driven.';
    }
    hud.playerList.classList.toggle('mode-specific', this.state.mode === 'last-man-standing' || this.state.mode === 'deathmatch');
    for (const [id, nodes] of hud.players) {
      const fighter = this.state.fighters.find(f => f.id === id);
      const isBot = this.botSlots.has(id) && !!fighter;
      nodes.root.classList.toggle('is-empty', !fighter);
      nodes.root.classList.toggle('is-eliminated', !!fighter?.eliminated);
      const outsideZone = !!fighter && zone.dangerIds.includes(id);
      nodes.root.classList.toggle('is-zone-danger', outsideZone);
      nodes.root.classList.toggle('is-bot', isBot);
      nodes.root.classList.toggle('is-lobby-slot', this.state.phase === 'lobby');
      const slotNumber = Number(id.slice(1));
      nodes.name.textContent = this.state.phase === 'lobby'
        ? this.selectedMode === 'wave' && fighter ? `${id} ${isBot ? 'ENEMY' : 'PLAYER'}`
          : id === 'P1' ? (this.gamepadSlotFor(id) !== undefined ? `${id} PAD ${this.gamepadSlotFor(id)}` : 'P1 HOST / KEY')
            : isBot ? id
              : fighter && this.gamepadSlotFor(id) !== undefined ? `${id} PAD ${this.gamepadSlotFor(id)}`
                : fighter && id === 'P2' ? `${id} KEYBOARD`
                  : fighter ? `${id} NO PAD` : slotNumber === 2 ? `${id} KEY/PAD` : slotNumber <= 4 ? `${id} PAD` : `${id} PAD/BOT`
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
      const accessibleLabel = outsideZone ? `${label}, outside the safe zone` : label;
      if (nodes.root.getAttribute('aria-label') !== accessibleLabel) nodes.root.setAttribute('aria-label', accessibleLabel);
    }
    let statusText: string;
    let fullStatusText: string;
    if (this.state.phase === 'lobby') {
      const padStatus = this.connectedGamepadIndices.map(index => {
        const slot = this.gamepadSlots.get(index);
        return `PAD ${index} ${slot ? `→ ${slot}` : 'READY · PRESS VIEW'}`;
      }).join(' · ');
      const pairing = padStatus ? ` · ${padStatus}` : '';
      fullStatusText = `LOBBY · P1 HOST · P2 KEYBOARD/GAMEPAD · P3–P4 GAMEPAD · P5–P8 GAMEPAD OR BOT · B/V BOT SHORTCUTS · O: ALL BOTS (P1 BOT-DRIVEN) · ENTER/PAD START${pairing}`;
      if (this.selectedMode === 'wave') {
        const hasBot = this.state.fighters.some(fighter => this.botSlots.has(fighter.id));
        const ready = this.waveRosterReady();
        fullStatusText += ' · WAVE RULE: AT LEAST ONE HUMAN AND ONE BOT; HUMANS ARE PLAYERS, BOTS ARE ENEMIES.';
        statusText = ready
          ? `WAVE READY · HUMANS=PLAYERS · BOTS=ENEMIES · ENTER TO START${pairing}`
          : `WAVE NEEDS HUMAN + BOT${hasBot ? '' : ' · ADD BOT'} · HUMANS=PLAYERS, BOTS=ENEMIES${pairing}`;
      } else {
        statusText = window.innerHeight <= 540 ? `SHIFT/PAD JOIN${pairing} · START` : `SHIFT/PAD JOIN${pairing} · ENTER`;
      }
    }
    else if (this.paused && this.canPauseLocal()) {
      fullStatusText = statusText = 'PAUSED · LOCAL MATCH FROZEN · PRESS P OR RESUME';
    }
    else if (this.state.phase === 'results') {
      const winner = this.lastResult?.mode === (this.state.mode ?? 'score-brawl') ? this.lastResult.winner : resultWinner(this.state);
      const reason = this.lastResult?.mode === (this.state.mode ?? 'score-brawl') ? this.lastResult.reason : resultReason(this.state);
      if (this.state.mode === 'last-man-standing') {
        const roster = this.state.fighters.map(f => `${f.id} ${f.eliminated ? 'OUT' : 'STOCK 1'}`).join(' · ');
        const reasonLabel = RESULT_REASON_LABELS[reason] ?? reason;
        fullStatusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reasonLabel} · ${roster} · ENTER: REMATCH`;
        statusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reasonLabel} · ENTER: REMATCH`;
      } else if (this.state.mode === 'deathmatch') {
        const reasonLabel = RESULT_REASON_LABELS[reason] ?? reason;
        const roster = this.state.fighters.map(f => `${f.id} ${f.frags ?? 0}F/${f.deaths ?? 0}D`).join(' · ');
        fullStatusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reasonLabel} · ${roster} · ENTER: REMATCH`;
        statusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reasonLabel} · ENTER: REMATCH`;
      } else {
        const reasonLabel = RESULT_REASON_LABELS[reason] ?? reason;
        const scoreTable = standings(this.state).map(s => `#${s.rank} ${s.id}: ${s.score}`).join(' · ');
        fullStatusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reasonLabel} · ${scoreTable} · ENTER: REMATCH`;
        statusText = `RESULTS · ${winner ? `WINNER: ${winner}` : 'DRAW'} · REASON: ${reasonLabel} · ENTER: REMATCH`;
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
    hud.status.classList.toggle('is-wave-lobby', this.state.phase === 'lobby' && this.selectedMode === 'wave');
    hud.status.classList.toggle('is-results', this.state.phase === 'results');
    hud.status.classList.toggle('is-paused', this.paused && this.canPauseLocal());
    if (hud.status.getAttribute('aria-label') !== fullStatusText) hud.status.setAttribute('aria-label', fullStatusText);
    if (hud.status.title !== fullStatusText) hud.status.title = fullStatusText;
  }

  private gamepadSlotFor(id: string): number | undefined {
    return [...this.gamepadSlots.entries()].find(([, slot]) => slot === id)?.[0];
  }

  /** Compute the authoritative podium once, when results begin, not while formatting HUD text. */
  private prepareResultsPresentation(): void {
    if (this.resultPresentationReady || this.state.phase !== 'results') return;
    const events = this.matchEvents.length > 0 ? this.matchEvents : this.state.events;
    const end = [...events].reverse().find(event => event.type === 'MatchEnded');
    this.lastResult = {
      mode: this.state.mode ?? 'score-brawl',
      reason: end?.reason ?? resultReason(this.state),
      winner: end?.winner !== undefined ? end.winner ?? null : resultWinner(this.state),
    };
    this.resultRanking = rankMatch(this.state, events);
    this.resultPresentationReady = true;
    this.populateVictoryReveal(this.resultRanking, end);
  }

  private populateVictoryReveal(ranking: MatchRanking, end?: GameEvent): void {
    const panel = document.getElementById('victory-reveal');
    const title = document.getElementById('victory-title');
    const ties = document.getElementById('victory-ties');
    const podium = document.getElementById('victory-podium');
    const rest = document.getElementById('victory-rest');
    if (!(panel && title && ties && podium && rest)) return;
    if (end?.type === 'MatchEnded' && (ranking.draw || ranking.winners.length > 0)) {
      const endKey = `${end.tick}:${end.reason ?? ''}:${end.winner ?? ''}`;
      if (this.victoryCueEndKey !== endKey) {
        this.victoryCueEndKey = endKey;
        this.playAudioCue('victory');
      }
    }
    panel.hidden = false;
    panel.classList.remove('is-revealing');
    panel.classList.add('is-results');
    const entries = ranking.order;
    const winner = ranking.winners[0];
    const color = winner ? this.playerColorCss(winner) : '#fff1b7';
    title.style.setProperty('--player-color', color);
    title.textContent = ranking.draw ? 'DRAW' : winner ?? 'DRAW';
    ties.textContent = '';
    if (ranking.draw) {
      const tied = document.createElement('span');
      tied.className = 'victory-tie-names';
      tied.textContent = `TIED PLAYERS: ${ranking.winners.join(' · ')}`;
      ties.append(tied);
      title.setAttribute('aria-label', `Draw. Tied players: ${ranking.winners.join(', ')}`);
    } else {
      title.setAttribute('aria-label', `Winner: ${winner}`);
    }
    podium.replaceChildren();
    const remainingTop = ranking.draw ? entries.filter(entry => entry.rank > 1 && entry.rank <= 3) : entries.filter(entry => entry.rank === 2 || entry.rank === 3);
    for (const entry of remainingTop) {
      podium.append(this.makePodiumEntry(entry, ranking.mode));
    }
    rest.textContent = '';
    const laterPlaces = entries.slice(3);
    if (this.state.fighters.length > 3 && laterPlaces.length) {
      rest.textContent = `PLACES: ${laterPlaces.map(entry => `${this.ordinal(entry.rank)} ${entry.id}`).join('  ·  ')}`;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      panel.classList.add('is-revealing');
      this.revealTimer?.remove(false);
      this.revealTimer = this.time.delayedCall(1800, () => this.finishReveal());
    } else {
      this.clearRevealTimer();
    }
  }

  private makePodiumEntry(entry: RankedEntry, mode: ModeId): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'victory-place';
    item.style.setProperty('--player-color', this.playerColorCss(entry.id));
    const label = document.createElement('span');
    label.className = 'victory-place-number';
    label.textContent = this.ordinal(entry.rank);
    const name = document.createElement('strong');
    name.className = 'victory-place-name';
    name.textContent = entry.id;
    const metric = document.createElement('span');
    metric.className = 'victory-place-metric';
    metric.textContent = this.metricLabel(entry, mode);
    item.setAttribute('aria-label', `${this.ordinal(entry.rank)} place, ${entry.id}, ${metric.textContent}`);
    item.append(label, name, metric);
    return item;
  }

  private metricLabel(entry: RankedEntry, mode: ModeId): string {
    if (mode === 'last-man-standing') return `SURVIVAL PLACE ${this.ordinal(entry.rank)}`;
    return mode === 'deathmatch' ? `${entry.metric} FRAGS` : `${entry.metric} SCORE`;
  }

  private ordinal(place: number): string {
    const suffix = place % 100 >= 11 && place % 100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' } as Record<number, string>)[place % 10] ?? 'TH';
    return `${place}${suffix}`;
  }

  private playerColorCss(id: string): string {
    return `#${playerColor(id).toString(16).padStart(6, '0')}`;
  }

  private finishReveal(): void {
    const panel = document.getElementById('victory-reveal');
    if (!panel || panel.hidden || !panel.classList.contains('is-revealing')) return;
    panel.classList.remove('is-revealing');
    this.clearRevealTimer();
  }

  private hideVictoryReveal(): void {
    this.clearRevealTimer();
    const panel = document.getElementById('victory-reveal');
    panel?.classList.remove('is-revealing', 'is-results');
    if (panel) panel.hidden = true;
  }

  private clearRevealTimer(): void {
    this.revealTimer?.remove(false);
    this.revealTimer = undefined;
  }

  private clearRevealState(): void {
    this.clearRevealTimer();
    this.hideVictoryReveal();
  }

  private pose(f: Fighter, prev?: { x: number; y: number; health: number }): FighterPose {
    if (f.eliminated) return 'ko';
    if (f.koTimer) return 'ko';
    if (f.protection > 0) return 'respawn';
    if ((this.hitFlash.get(f.id) ?? 0) > this.state.tick) return 'hit';
    if (f.attackMove && f.attackMove !== 'throw') return f.attackMove;
    if (f.z > 0) return 'jump';
    if (prev && Math.abs(prev.x - f.x) > 0.05) return 'walk';
    if (prev && Math.abs(prev.y - f.y) > 0.05) return 'depth';
    return 'idle';
  }
}
