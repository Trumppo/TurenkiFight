import Phaser from 'phaser';
import type { GameState, Fighter, ModeId } from '../simulation/types';
import type { OnlineMatchController } from '../networking/onlineMatchController';
import { VISUAL_ASSETS, publicAssetUrl } from './visualAssets';
import { VIEWPORT, cameraScale } from './viewport';
import { createFighterTextures, fighterKey, type FighterPose } from './fighterSprites';
import { createRetroP1Textures, RETRO_PREVIEW } from './retroPrototype';
import { createRetroP2Textures } from './retroP2';
import { createRetroExtraTextures } from './retroExtras';
import { audioControlsHost, createAudioPresentation, type AudioPresentation } from './audio/audioControls';
import { CueBridge } from './audio/cueBridge';
import { arenaBackdropTextureKey, resolveArenaSelection, type ArenaSelection } from './arenaVisuals';
import { drawZoneGraphics, zonePresentation, zoneSummaryText } from './zonePresentation';

const MODE_NAMES: Record<ModeId, string> = {
  'score-brawl': 'Score Brawl',
  'last-man-standing': 'Last Man Standing',
  deathmatch: 'Deathmatch',
};

/**
 * Presentation-only scene for a remote authoritative match.
 *
 * It never calls `step()` and never mutates simulation state. Positions come
 * from `OnlineMatchController.renderState()`, which interpolates the last two
 * authoritative snapshots. The DOM HUD shows the latest authoritative scores,
 * timer and health; connection state, RTT and the snapshot counter live in the
 * online status panel rendered by `src/online.ts`.
 */
export class OnlineScene extends Phaser.Scene {
  private readonly controller: OnlineMatchController;
  private readonly onFrame?: (now: number) => void;
  private fighterSprites = new Map<string, Phaser.GameObjects.Image>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private zoneGraphics?: Phaser.GameObjects.Graphics;
  private poses = new Map<string, FighterPose>();
  private previous = new Map<string, { x: number; y: number; z: number }>();
  private lastHealth = new Map<string, number>();
  private hitUntil = new Map<string, number>();
  private domHud?: {
    timer: HTMLElement;
    status: HTMLElement;
    mode: HTMLElement;
    zoneStatus?: HTMLElement;
    zoneSummary?: HTMLElement;
    zoneDanger?: HTMLElement;
    playerList: HTMLElement;
    players: Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement }>;
  };
  private audio?: AudioPresentation;
  private audioBridge?: CueBridge;
  private readonly arenaSelection: ArenaSelection;

  constructor(controller: OnlineMatchController, onFrame?: (now: number) => void,
    arenaSelection = resolveArenaSelection(window.location.search, RETRO_PREVIEW ? 'retro' : 'classic')) {
    super('OnlineScene');
    this.controller = controller;
    this.onFrame = onFrame;
    this.arenaSelection = arenaSelection;
  }

  preload(): void {
    const backdrop = VISUAL_ASSETS.station.backdrop;
    const key = arenaBackdropTextureKey(this.arenaSelection.manifest.id);
    const path = this.arenaSelection.backdropPath;
    const retro = this.arenaSelection.style === 'retro';
    this.load.svg(key, publicAssetUrl(import.meta.env.BASE_URL, path), {
      width: retro ? 640 : backdrop.width,
      height: retro ? 360 : backdrop.height,
    });
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
    this.zoneGraphics = this.add.graphics().setDepth(122).setVisible(false);
    this.initDomHud();
    this.audio = createAudioPresentation(audioControlsHost());
    this.audioBridge = new CueBridge(cue => this.audio?.director.playCue(cue), true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audioBridge?.reset();
      this.audio?.dispose();
      this.audioBridge = undefined;
      this.audio = undefined;
    });
    this.renderHud(null);
  }

  update(_time: number, _delta: number): void {
    const now = this.controller.now();
    const state = this.controller.renderState(now);
    if (state) {
      this.audioBridge?.observe(state);
      this.audio?.director.setMusicDucked(state.phase === 'results');
    }
    this.drawFighters(state, now);
    const connectionState = this.controller.connectionState;
    const modeState = connectionState === 'closed' || connectionState === 'error' ? null : state;
    this.drawZone(modeState);
    this.renderHud(state, modeState);
    this.onFrame?.(now);
  }

  /** Read-only audio diagnostics used by browser QA; no simulation state is exposed. */
  audioDiagnostics(): { state: string; muted: boolean; volume: number } {
    const settings = this.audio?.director.settings;
    return { state: this.audio?.director.contextState ?? 'not-created', muted: settings?.muted ?? false, volume: settings?.volume ?? 0.55 };
  }

  /** Development harness hook for rendering a supplied authoritative snapshot without stepping it. */
  debugRenderSnapshot(state: GameState | null): void {
    this.drawZone(state);
    this.renderHud(state);
  }

  /** Read-only dev diagnostic used by the browser zone parity test. */
  debugZoneVisible(): boolean {
    return this.zoneGraphics?.visible ?? false;
  }

  /** Test/debug hook; returns the interpolated positions and pose actually drawn. */
  debugFighters(): Array<{ id: string; x: number; y: number; z: number; facing: number; pose: string; alpha: number }> {
    return Array.from(this.poses.entries()).map(([id, pose]) => {
      const sprite = this.fighterSprites.get(id);
      return {
        id,
        x: sprite?.x ?? 0,
        y: sprite?.y ?? 0,
        z: 0,
        facing: sprite?.flipX ? -1 : 1,
        pose,
        alpha: sprite?.alpha ?? 1,
      };
    });
  }

  private drawFighters(state: GameState | null, _now: number): void {
    const ids = new Set<string>();
    if (state) {
      for (const fighter of state.fighters) {
        ids.add(fighter.id);
        if (!this.fighterSprites.has(fighter.id)) {
          this.shadows.set(fighter.id, this.add.ellipse(0, 0, 22, 7, 0x283640, 0.55));
          this.fighterSprites.set(fighter.id, this.add.image(0, 0, fighterKey(fighter.id, 'idle', 0))
            .setOrigin(0.5, 1));
        }
        const previous = this.previous.get(fighter.id);
        const lastHealth = this.lastHealth.get(fighter.id);
        // A health drop is a presentation cue only; the authoritative value
        // itself is always the snapshot's value.
        if (lastHealth !== undefined && fighter.health < lastHealth) {
          this.hitUntil.set(fighter.id, state.tick + 12);
        }
        if (lastHealth !== undefined && fighter.health > lastHealth) {
          this.hitUntil.delete(fighter.id);
        }
        this.lastHealth.set(fighter.id, fighter.health);
        const pose = this.pose(fighter, previous, state.tick);
        this.poses.set(fighter.id, pose);
        const frame = Math.floor(state.tick / (pose === 'idle' ? 15 : 6)) % 4;
        const x = Math.round(fighter.x);
        const y = Math.round(fighter.y);
        const shadow = this.shadows.get(fighter.id)!;
        shadow.setPosition(x, y).setDepth(y - 0.2).setVisible(fighter.koTimer === 0);
        const sprite = this.fighterSprites.get(fighter.id)!;
        sprite.setTexture(fighterKey(fighter.id, pose, frame))
          .setPosition(x, y - Math.round(fighter.z))
          .setFlipX(fighter.facing < 0)
          .setDepth(y);
        if (fighter.eliminated) {
          sprite.setTintFill(0x4a5561).setAlpha(0.72);
        } else if (RETRO_PREVIEW && (this.hitUntil.get(fighter.id) ?? 0) > state.tick && state.tick % 6 < 3) {
          sprite.setTintFill(0xffe3a0);
          sprite.setAlpha(1);
        } else {
          sprite.clearTint();
          sprite.setAlpha(1);
        }
        this.previous.set(fighter.id, { x: fighter.x, y: fighter.y, z: fighter.z });
      }
    }
    // The server roster is fixed for a match; this only removes stale sprites if
    // a new match with a smaller roster ever reuses the scene.
    for (const [id, sprite] of this.fighterSprites) {
      if (ids.has(id)) continue;
      sprite.destroy();
      this.shadows.get(id)?.destroy();
      this.fighterSprites.delete(id);
      this.shadows.delete(id);
      this.poses.delete(id);
      this.previous.delete(id);
      this.lastHealth.delete(id);
      this.hitUntil.delete(id);
    }
  }

  private drawZone(state: GameState | null): void {
    if (!this.zoneGraphics) return;
    drawZoneGraphics(this.zoneGraphics, zonePresentation(state), state?.tick ?? 0);
  }

  private pose(fighter: Fighter, previous?: { x: number; y: number; z: number }, tick = 0): FighterPose {
    if (fighter.eliminated) return 'ko';
    if (fighter.koTimer) return 'ko';
    if (fighter.protection > 0) return 'respawn';
    if ((this.hitUntil.get(fighter.id) ?? 0) > tick) return 'hit';
    if (fighter.attackMove && fighter.attackMove !== 'throw') return fighter.attackMove;
    if (fighter.z > 0.01) return 'jump';
    if (previous && Math.abs(previous.x - fighter.x) > 0.05) return 'walk';
    if (previous && Math.abs(previous.y - fighter.y) > 0.05) return 'depth';
    return 'idle';
  }

  private initDomHud(): void {
    const timer = document.getElementById('match-timer');
    const status = document.getElementById('match-status');
    const mode = document.getElementById('match-mode');
    const zoneStatus = document.getElementById('zone-status');
    const zoneSummary = document.getElementById('zone-summary');
    const zoneDanger = document.getElementById('zone-danger');
    const playerList = document.getElementById('player-hud');
    if (!timer || !status || !mode || !playerList) return;
    const players = new Map<string, { root: HTMLElement; score: HTMLElement; health: HTMLElement }>();
    for (const node of Array.from(document.querySelectorAll('.hud-player[data-player]'))) {
      const root = node as HTMLElement;
      const id = root.dataset.player;
      const score = root.querySelector('.hud-score') as HTMLElement | null;
      const health = root.querySelector('.hud-health') as HTMLElement | null;
      if (id && score && health) players.set(id, { root, score, health });
    }
    this.domHud = {
      timer, status, mode, zoneStatus: zoneStatus ?? undefined, zoneSummary: zoneSummary ?? undefined,
      zoneDanger: zoneDanger ?? undefined, playerList, players,
    };
  }

  private renderHud(state: GameState | null, modeState: GameState | null = state): void {
    const hud = this.domHud;
    if (!hud) return;
    const modeId = modeState?.mode;
    const modeText = modeId
      ? `ONLINE MODE · ${MODE_NAMES[modeId].toUpperCase()}`
      : 'ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)';
    if (hud.mode.textContent !== modeText) hud.mode.textContent = modeText;
    hud.playerList.classList.toggle('mode-specific', modeId === 'last-man-standing' || modeId === 'deathmatch');
    const zone = zonePresentation(modeState);
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
    if (state) {
      const seconds = Math.ceil(state.remainingTicks / 60);
      const timerText = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:` +
        `${String(seconds % 60).padStart(2, '0')}`;
      if (hud.timer.textContent !== timerText) hud.timer.textContent = timerText;
    } else if (hud.timer.textContent !== '--:--') {
      hud.timer.textContent = '--:--';
    }
    for (const [id, nodes] of hud.players) {
      const fighter = state?.fighters.find(f => f.id === id);
      nodes.root.classList.toggle('is-empty', !fighter);
      nodes.root.classList.toggle('is-eliminated', !!fighter?.eliminated);
      const outsideZone = !!fighter && zone.dangerIds.includes(id);
      nodes.root.classList.toggle('is-zone-danger', outsideZone);
      let scoreText: string;
      let healthText: string;
      let label: string;
      if (!fighter) {
        scoreText = '—';
        healthText = 'HP —';
        label = `${id}, not joined`;
      } else if (state?.mode === 'last-man-standing') {
        const stocks = fighter.eliminated ? 0 : 1;
        const status = fighter.eliminated ? 'ELIMINATED' : 'ALIVE';
        scoreText = `STOCK ${stocks}`;
        healthText = status;
        label = `${id}, stock ${stocks}, ${status.toLowerCase()}`;
      } else if (state?.mode === 'deathmatch') {
        // Deathmatch always carries frags/deaths on the wire. If a snapshot is
        // missing one (a non-conforming producer), say so instead of inventing
        // a zero the server never measured.
        const frags = fighter.frags;
        const deaths = fighter.deaths;
        scoreText = frags === undefined ? 'FRAGS —' : `FRAGS ${frags}`;
        healthText = deaths === undefined ? 'DEATHS —' : `DEATHS ${deaths}`;
        const fragsLabel = frags === undefined ? 'frags not measured' : `${frags} frags`;
        const deathsLabel = deaths === undefined ? 'deaths not measured' : `${deaths} deaths`;
        label = `${id}, ${fragsLabel}, ${deathsLabel}, health ${Math.max(0, Math.min(100, fighter.health))}`;
      } else {
        scoreText = String(fighter.score);
        healthText = `HP ${Math.max(0, Math.min(100, fighter.health))}`;
        label = `${id}, score ${fighter.score}, health ${Math.max(0, Math.min(100, fighter.health))}`;
      }
      if (nodes.score.textContent !== scoreText) nodes.score.textContent = scoreText;
      if (nodes.health.textContent !== healthText) nodes.health.textContent = healthText;
      const accessibleLabel = outsideZone ? `${label}, outside the safe zone` : label;
      if (nodes.root.getAttribute('aria-label') !== accessibleLabel) nodes.root.setAttribute('aria-label', accessibleLabel);
    }
    const status = this.controller.status;
    const text = status.detail ? `${status.message} · ${status.detail}` : status.message;
    if (hud.status.textContent !== text) hud.status.textContent = text;
    if (hud.status.getAttribute('aria-label') !== text) hud.status.setAttribute('aria-label', text);
    if (hud.status.title !== text) hud.status.title = text;
  }
}
