import Phaser from 'phaser';
import './style.css';
import { OnlineMatchController, type OnlineConnectionState } from './game/networking/onlineMatchController';
import { defaultServerUrl, resolveServerUrl } from './game/networking/wsEndpoint';
import { OnlineScene } from './game/presentation/OnlineScene';
import type { GameState } from './game/simulation/types';
import { KEYBOARD_LAYOUTS, keyboardPlayerInput } from './game/input/keyboardMapping';
import { VIEWPORT } from './game/presentation/viewport';
import { arenaBackdropTextureKey, resolveArenaSelection } from './game/presentation/arenaVisuals';

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
const arenaSelection = resolveArenaSelection(window.location.search);
const pageDescription = document.querySelector('.page-header p');
if (pageDescription) {
  if (arenaSelection.notice) pageDescription.textContent = arenaSelection.notice;
  else if (arenaSelection.manifest.id !== 'station') pageDescription.textContent = `Remote authoritative match · arena: ${arenaSelection.manifest.displayName}`;
}
const serverParam = params.get('server')?.trim() ?? '';
const playerParam = (params.get('player')?.trim().toUpperCase() ?? '');
const roomParam = (params.get('room')?.trim().toUpperCase() ?? '');
const setup = document.getElementById('online-setup') as HTMLElement;
const form = document.getElementById('online-connect-form') as HTMLFormElement;
const serverInput = document.getElementById('server-url') as HTMLInputElement;
const roomInput = document.getElementById('room-code') as HTMLInputElement;
const playerSelect = document.getElementById('player-slot') as HTMLSelectElement;
const errorBox = document.getElementById('online-error') as HTMLElement;
const statusEl = document.getElementById('online-status') as HTMLElement;
const metricsEl = document.getElementById('online-metrics') as HTMLElement;
const keysEl = document.getElementById('online-keys') as HTMLElement;
const leaveButton = document.getElementById('online-leave') as HTMLButtonElement | null;
const fightHud = document.getElementById('fight-hud') as HTMLElement;
const resultCard = document.getElementById('online-result') as HTMLElement;
const resultWinner = document.getElementById('online-result-winner') as HTMLElement;
const resultReason = document.getElementById('online-result-reason') as HTMLElement;
const resultTies = document.getElementById('online-result-ties') as HTMLElement;
const resultPodium = document.getElementById('online-result-podium') as HTMLOListElement;
const resultRest = document.getElementById('online-result-rest') as HTMLElement;
const rematchStatus = document.getElementById('online-rematch-status') as HTMLElement;
const rematchButton = document.getElementById('online-rematch') as HTMLButtonElement;
let rematchWaiting = false;
let rematchMatchId: number | null = null;
let rematchRefusal = '';
let renderedResultKey = '';

const trackedCodes = new Set<string>();
for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
  for (const code of [...layout.moveX, ...layout.moveY, layout.jump, layout.punch, layout.kick, layout.jumpkick, layout.grab]) {
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
    return 'P2 layout: arrow keys move · K jump · L punch · J kick · U jump kick · I pick up/throw';
  }
  if (playerId === 'P3' || playerId === 'P4') {
    return `${playerId} uses the P1 layout: WASD move · Space jump · F punch · G kick · H jump kick · T pick up/throw`;
  }
  return 'P1 layout: WASD move · Space jump · F punch · G kick · H jump kick · T pick up/throw';
}

function showError(message: string | null): void {
  errorBox.hidden = message === null;
  setText(errorBox, message ?? '');
}

function updateKeyHint(playerId: string): void {
  setText(keysEl, layoutText(playerId));
}

function ordinal(place: number): string {
  const suffix = place % 100 >= 11 && place % 100 <= 13
    ? 'TH'
    : ({ 1: 'ST', 2: 'ND', 3: 'RD' } as Record<number, string>)[place % 10] ?? 'TH';
  return `${place}${suffix}`;
}

function resultReasonLabel(reason: string): string {
  switch (reason) {
    case 'elimination': return 'ELIMINATION';
    case 'frag-limit': return 'FRAG LIMIT';
    case 'time': return 'TIME';
    case 'waves-cleared': return 'WAVES CLEARED';
    default: return reason;
  }
}

function rematchRefusalText(code: string): string {
  switch (code) {
    case 'rematch-disabled': return 'Rematch is disabled on this server.';
    case 'roster-incomplete': return 'Rematch refused: everyone must still be connected.';
    case 'not-in-results': return 'Rematch is only available after a finished match.';
    default: return `Rematch refused (${code}).`;
  }
}

function clearResultRows(): void {
  resultPodium.replaceChildren();
  resultTies.hidden = true;
  setText(resultTies, '');
  setText(resultRest, '');
}

function hideResultCard(): void {
  if (!resultCard.hidden) {
    resultCard.hidden = true;
    clearResultRows();
    setText(resultWinner, '');
    setText(resultReason, '');
    resultWinner.removeAttribute('aria-label');
  }
  if (fightHud.hidden) fightHud.hidden = false;
  renderedResultKey = '';
}

/** Displays only server-authored match-end fields. No ranking is reconstructed here. */
function updateResultCard(): void {
  const status = controller.status;
  const result = controller.matchResult;
  const hasResultScreen = status.state === 'ended' && result !== null;

  if (rematchWaiting && controller.rematchRefusedCode !== null) {
    rematchWaiting = false;
    rematchRefusal = rematchRefusalText(controller.rematchRefusedCode);
  }
  const matchId = controller.matchStart?.matchId ?? null;
  if (rematchWaiting && matchId !== null && rematchMatchId !== null && matchId !== rematchMatchId &&
      status.state === 'running') {
    rematchWaiting = false;
    rematchRefusal = '';
    hideResultCard();
    rematchButton.disabled = false;
    return;
  }
  if (!hasResultScreen) {
    if (!rematchWaiting) {
      hideResultCard();
    }
    return;
  }

  resultCard.hidden = false;
  fightHud.hidden = true;
  resultCard.classList.toggle('is-waiting', rematchWaiting);
  if (rematchButton.disabled !== rematchWaiting) rematchButton.disabled = rematchWaiting;
  setText(rematchButton, rematchWaiting ? 'WAITING' : 'REMATCH');
  const hideRematchStatus = !rematchWaiting && !rematchRefusal;
  if (rematchStatus.hidden !== hideRematchStatus) rematchStatus.hidden = hideRematchStatus;
  setText(rematchStatus, rematchWaiting ? 'Waiting for the others to start the rematch.' : rematchRefusal);

  const mode = controller.latestState()?.mode ?? 'score-brawl';
  const cardKey = JSON.stringify({ result, mode, rematchWaiting, rematchRefusal });
  if (renderedResultKey === cardKey) return;
  renderedResultKey = cardKey;
  clearResultRows();
  if (!result) {
    setText(resultWinner, 'RESULT UNAVAILABLE');
    setText(resultReason, 'The server did not send an authoritative result payload.');
    return;
  }
  setText(resultWinner, result.winner === null ? 'DRAW' : result.winner);
  resultWinner.setAttribute('aria-label', result.winner === null ? 'Draw' : `Winner: ${result.winner}`);
  setText(resultReason, `END REASON · ${resultReasonLabel(result.reason)}`);

  if (result.winner === null) {
    const tiedEntries = result.ranking.filter(entry => entry.rank === 1);
    const tiedNames = tiedEntries.map(entry => entry.id).join(' · ');
    if (tiedEntries.length > 1) {
      setText(resultTies, `TIED PLAYERS · ${tiedNames}`);
      resultTies.hidden = false;
    }
  }

  for (const entry of result.ranking) {
    if (entry.rank !== 2 && entry.rank !== 3) continue;
    const item = document.createElement('li');
    item.className = 'online-result-place';
    const place = document.createElement('span');
    place.className = 'online-result-place-number';
    place.textContent = ordinal(entry.rank);
    const name = document.createElement('strong');
    name.className = 'online-result-place-name';
    name.textContent = entry.id;
    const metric = document.createElement('span');
    metric.className = 'online-result-place-metric';
    const metricName = mode === 'deathmatch' ? 'FRAGS' : mode === 'last-man-standing' ? 'SURVIVAL' : 'SCORE';
    metric.textContent = `${metricName} ${entry.metric}`;
    item.setAttribute('aria-label', `${ordinal(entry.rank)} place, ${entry.id}, ${metric.textContent}`);
    item.append(place, name, metric);
    resultPodium.append(item);
  }

  if (result.ranking.length > 3) {
    const laterPlaces = result.ranking.filter(entry => entry.rank >= 4 && entry.rank <= 8);
    if (laterPlaces.length) {
      setText(resultRest, `PLACES · ${laterPlaces.map(entry => `${ordinal(entry.rank)} ${entry.id}`).join(' · ')}`);
    }
  }
}

rematchButton.addEventListener('click', () => {
  if (rematchWaiting) return;
  rematchRefusal = '';
  rematchWaiting = true;
  rematchMatchId = controller.matchStart?.matchId ?? null;
  updateResultCard();
  try {
    controller.requestRematch();
  } catch (error) {
    rematchWaiting = false;
    rematchRefusal = `Could not request rematch: ${error instanceof Error ? error.message : String(error)}`;
    updateResultCard();
  }
});

function updatePanel(): void {
  updateResultCard();
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
  // LEAVE only means something while a session exists or its match is final.
  if (leaveButton) {
    const leaveDisabled = !(info.state === 'connecting' || info.state === 'joined' ||
      info.state === 'running' || info.state === 'ended');
    if (leaveButton.disabled !== leaveDisabled) leaveButton.disabled = leaveDisabled;
  }
}

function start(url: string, requestedPlayer: string, requestedRoom: string): void {
  showError(null);
  const playerId = requestedPlayer.trim().toUpperCase();
  if (!/^P[1-4]$/.test(playerId)) {
    showError('Choose a slot between P1 and P4.');
    return;
  }
  const resolvedUrl = resolveServerUrl(url, window.location.protocol);
  if (resolvedUrl.length === 0) {
    showError('Enter the match server URL, for example ws://127.0.0.1:8787.');
    return;
  }
  const roomCode = requestedRoom.trim().toUpperCase();
  serverInput.value = resolvedUrl;
  roomInput.value = roomCode;
  playerSelect.value = playerId;
  updateKeyHint(playerId);
  try {
    controller.connect({
      url: resolvedUrl,
      playerId,
      ...(roomCode.length === 0 ? {} : { roomCode }),
    });
    setup.hidden = true;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  start(serverInput.value, playerSelect.value, roomInput.value);
});
playerSelect.addEventListener('change', () => updateKeyHint(playerSelect.value));

/**
 * Close the session and return to the join form without reloading the page.
 * The controller both closes the socket and drops the received snapshots, so
 * the online HUD falls back to its honest defaults instead of keeping the
 * departed match's mode, timer or scores. This does not set the `left` unload
 * guard: a session started again from the form must still close on pagehide.
 */
function leaveMatch(): void {
  rematchWaiting = false;
  rematchMatchId = null;
  rematchRefusal = '';
  controller.disconnect();
  showError(null);
  setup.hidden = false;
  pressed.clear();
  updatePanel();
  leaveButton?.blur();
}
leaveButton?.addEventListener('click', leaveMatch);

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
  roomInput.value = roomParam;
  if (/^P[1-4]$/.test(playerParam)) playerSelect.value = playerParam;
  start(serverParam, playerParam, roomParam);
} else {
  serverInput.value = serverParam || defaultServerUrl(window.location.protocol);
  roomInput.value = roomParam;
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
    latestSnapshot(): {
      mode?: GameState['mode'];
      tick: number;
      phase: GameState['phase'];
      remainingTicks: number;
      fighters: Array<{
        id: string; x: number; y: number; facing: number; health: number; score: number;
        frags?: number; deaths?: number; eliminated?: boolean;
      }>;
    } | null {
      const state = controller.latestState();
      if (!state) return null;
      return {
        ...(state.mode === undefined ? {} : { mode: state.mode }),
        tick: state.tick,
        phase: state.phase,
        remainingTicks: state.remainingTicks,
        fighters: state.fighters.map(fighter => ({
          id: fighter.id,
          x: fighter.x,
          y: fighter.y,
          facing: fighter.facing,
          health: fighter.health,
          score: fighter.score,
          ...(fighter.frags === undefined ? {} : { frags: fighter.frags }),
          ...(fighter.deaths === undefined ? {} : { deaths: fighter.deaths }),
          ...(fighter.eliminated === true ? { eliminated: true } : {}),
        })),
      };
    },
    resultPayload() { return controller.matchResult; },
    renderedFighters(): Array<{ id: string; x: number; y: number; pose: string; alpha: number }> {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      return (scene?.debugFighters() ?? []).map(fighter => ({
        id: fighter.id,
        x: fighter.x,
        y: fighter.y,
        pose: fighter.pose,
        alpha: fighter.alpha,
      }));
    },
    statusText(): string { return statusEl.textContent ?? ''; },
    metricsText(): string { return metricsEl.textContent ?? ''; },
    renderHudSnapshotForTest(state: GameState | null): void {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      scene?.debugRenderSnapshot(state);
    },
    zoneGraphicsVisible(): boolean {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      return scene?.debugZoneVisible() ?? false;
    },
    stationEventDiagnostics() {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      return scene?.debugStationEvent() ?? { active: false, phase: null, cycle: null, cueCount: 0 };
    },
    arenaHazardDiagnostics() {
      const scene = game.scene.getScene('OnlineScene') as OnlineScene | null;
      return scene?.debugArenaHazard() ?? {
        active: false, phase: 'idle', bandVisible: false, warningStart: 0, cueCount: 0, damageFeedback: false,
      };
    },
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
      return !!scene?.textures.exists(arenaBackdropTextureKey(arenaSelection.manifest.id));
    },
  };
}
