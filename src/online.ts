import Phaser from 'phaser';
import './style.css';
import { OnlineMatchController, type OnlineConnectionState } from './game/networking/onlineMatchController';
import { OnlineScene } from './game/presentation/OnlineScene';
import { KEYBOARD_LAYOUTS, keyboardPlayerInput } from './game/input/keyboardMapping';
import { VIEWPORT } from './game/presentation/viewport';
import { resolveArenaSelection } from './game/presentation/arenaVisuals';
import { RETRO_PREVIEW } from './game/presentation/retroPrototype';

/**
 * Online entry page.
 *
 * `?server=ws://HOST:PORT&player=P1` connects immediately. Without both
 * parameters the in-page form is shown instead. The page samples the same
 * keyboard layout as the local game, sends canonical `InputFrame`s through the
 * shared session client and renders interpolated snapshots. It never runs the
 * simulation and never predicts.
 */

const STATE_LABEL: Record<OnlineConnectionState, string> = {
  idle: 'idle',
  connecting: 'connecting',
  joined: 'joined',
  running: 'running',
  ended: 'ended',
  closed: 'closed',
  error: 'error',
};

const params = new URLSearchParams(window.location.search);
const arenaSelection = resolveArenaSelection(window.location.search, RETRO_PREVIEW ? 'retro' : 'classic');
const pageDescription = document.querySelector('.page-header p');
if (pageDescription) {
  if (arenaSelection.notice) pageDescription.textContent = arenaSelection.notice;
  else if (arenaSelection.manifest.id !== 'station') pageDescription.textContent = `Remote authoritative match · arena: ${arenaSelection.manifest.displayName}`;
}
const serverParam = params.get('server')?.trim() ?? '';
const playerParam = (params.get('player')?.trim().toUpperCase() ?? '');
const setup = document.getElementById('online-setup') as HTMLElement;
const form = document.getElementById('online-connect-form') as HTMLFormElement;
const serverInput = document.getElementById('server-url') as HTMLInputElement;
const playerSelect = document.getElementById('player-slot') as HTMLSelectElement;
const errorBox = document.getElementById('online-error') as HTMLElement;
const statusEl = document.getElementById('online-status') as HTMLElement;
const metricsEl = document.getElementById('online-metrics') as HTMLElement;
const keysEl = document.getElementById('online-keys') as HTMLElement;

const trackedCodes = new Set<string>();
for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
  for (const code of [...layout.moveX, ...layout.moveY, layout.jump, layout.punch, layout.kick, layout.jumpkick]) {
    trackedCodes.add(code);
  }
}
const pressed = new Set<string>();

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.isContentEditable;
}

window.addEventListener('keydown', event => {
  if (!trackedCodes.has(event.code) || typingTarget(event.target)) return;
  // Arrows and Space would otherwise scroll the page while playing.
  event.preventDefault();
  pressed.add(event.code);
});
window.addEventListener('keyup', event => {
  if (!trackedCodes.has(event.code)) return;
  pressed.delete(event.code);
});
window.addEventListener('blur', () => pressed.clear());

const controller = new OnlineMatchController({
  onStatus: () => updatePanel(),
});
controller.setInputReader(() =>
  keyboardPlayerInput(controller.playerId || 'P1', code => pressed.has(code)));

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setDataState(element: HTMLElement, state: string): void {
  if (element.dataset.state !== state) element.dataset.state = state;
}

function layoutText(playerId: string): string {
  if (playerId === 'P2') {
    return 'P2 layout: arrow keys move · K jump · L punch · J kick · U jump kick';
  }
  if (playerId === 'P3' || playerId === 'P4') {
    return `${playerId} uses the P1 layout: WASD move · Space jump · F punch · G kick · H jump kick`;
  }
  return 'P1 layout: WASD move · Space jump · F punch · G kick · H jump kick';
}

function showError(message: string | null): void {
  errorBox.hidden = message === null;
  setText(errorBox, message ?? '');
}

function updateKeyHint(playerId: string): void {
  setText(keysEl, layoutText(playerId));
}

function updatePanel(): void {
  const info = controller.linkInfo();
  const label = STATE_LABEL[info.state];
  setDataState(statusEl, info.state);
  const stale = info.stale && info.lastSnapshotAgeMs !== null
    ? ` · NO SNAPSHOTS FOR ${Math.round(info.lastSnapshotAgeMs)} ms`
    : '';
  const detail = info.state === 'error' && info.detail ? ` (${info.detail})` : '';
  setText(statusEl, `${info.message}${detail}${stale}`);
  statusEl.title = info.detail ?? info.message;
  const rtt = info.rttMs === null ? '—' : `${Math.round(info.rttMs)} ms`;
  const age = info.lastSnapshotAgeMs === null ? '—' : `${Math.round(info.lastSnapshotAgeMs)} ms`;
  setText(metricsEl,
    `LINK ${label} · RTT ${rtt} · SNAP ${info.snapshotCount} · TICK ${info.tick} · AGE ${age}`);
  // A connection failure reopens the form so the URL can be corrected. A
  // running or ended match keeps it hidden to leave the arena unobstructed.
  if (info.state === 'error' && setup.hidden) setup.hidden = false;
}

function start(url: string, requestedPlayer: string): void {
  showError(null);
  const playerId = requestedPlayer.trim().toUpperCase();
  if (!/^P[1-4]$/.test(playerId)) {
    showError('Choose a slot between P1 and P4.');
    return;
  }
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    showError('Enter the match server URL, for example ws://127.0.0.1:8787.');
    return;
  }
  serverInput.value = trimmedUrl;
  playerSelect.value = playerId;
  updateKeyHint(playerId);
  try {
    controller.connect({ url: trimmedUrl, playerId });
    setup.hidden = true;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  start(serverInput.value, playerSelect.value);
});
playerSelect.addEventListener('change', () => updateKeyHint(playerSelect.value));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEWPORT.renderWidth,
  height: VIEWPORT.renderHeight,
  backgroundColor: '#172536',
  pixelArt: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [new OnlineScene(controller, updatePanel, arenaSelection)],
});

let left = false;
const leave = (): void => {
  if (left) return;
  left = true;
  controller.disconnect();
};
window.addEventListener('pagehide', leave);
window.addEventListener('beforeunload', leave);

updateKeyHint(playerSelect.value);
updatePanel();

if (serverParam && playerParam) {
  serverInput.value = serverParam;
  if (/^P[1-4]$/.test(playerParam)) playerSelect.value = playerParam;
  start(serverParam, playerParam);
} else {
  if (serverParam) serverInput.value = serverParam;
  if (/^P[1-4]$/.test(playerParam)) {
    playerSelect.value = playerParam;
    updateKeyHint(playerParam);
  }
  setup.hidden = false;
}

// Development-only browser test hook; omitted from production bundles.
if (import.meta.env.DEV) {
  (window as typeof window & { __turenkiOnline?: unknown }).__turenkiOnline = {
    controller,
    get state(): OnlineConnectionState { return controller.connectionState; },
    get snapshotCount(): number { return controller.snapshotCount; },
    get rttMs(): number | null { return controller.rttMs; },
    get tick(): number { return controller.latestTick; },
    renderedFighters(): Array<{ id: string; x: number; y: number }> {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      return (scene?.debugFighters() ?? []).map(fighter => ({
        id: fighter.id,
        x: fighter.x,
        y: fighter.y,
      }));
    },
    statusText(): string { return statusEl.textContent ?? ''; },
    metricsText(): string { return metricsEl.textContent ?? ''; },
    hudFontSize(): string {
      const card = document.querySelector<HTMLElement>('.hud-player');
      return card ? window.getComputedStyle(card).fontSize : '';
    },
    audioDiagnostics(): { state: string; muted: boolean; volume: number } {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      return scene?.audioDiagnostics() ?? { state: 'not-ready', muted: false, volume: 0.55 };
    },
    arenaTextureExists(): boolean {
      const scene = game.scene.getScene('OnlineScene');
      return !!scene?.textures.exists('arena-mesku-backdrop');
    },
  };
}
