import Phaser from 'phaser';
import { StationScene } from './game/presentation/StationScene';
import './style.css';
import { VIEWPORT } from './game/presentation/viewport';
import { resolveArenaSelection } from './game/presentation/arenaVisuals';
import { audioControlsHost, createAudioPresentation } from './game/presentation/audio/audioControls';

document.body.classList.add('onboarding-active');
const onboarding = document.getElementById('onboarding');
const titleStart = document.getElementById('title-start');
const menu = document.querySelector<HTMLElement>('.onboarding-menu');
let onboardingState: 'title' | 'menu' | 'entered' = 'title';
let audioStarted = false;
let audioPresentation: ReturnType<typeof createAudioPresentation> | undefined;
let game: Phaser.Game | null = null;

function enterMenu(): void {
  if (onboardingState !== 'title') return;
  onboardingState = 'menu';
  if (onboarding) onboarding.dataset.screen = 'menu';
  if (titleStart) titleStart.hidden = true;
  if (menu) menu.hidden = false;
}
function enterRoute(route: string): void {
  if (onboardingState !== 'menu') return;
  if (!audioStarted) {
    audioStarted = true;
    audioPresentation = createAudioPresentation(audioControlsHost());
  }
  onboardingState = 'entered';
  onboarding?.setAttribute('hidden', '');
  document.body.classList.remove('onboarding-active');
  if (route === 'create' || route === 'join') {
    window.location.assign(`online.html?action=${route}`);
    return;
  }
  startLocalGame();
}

function startLocalGame(): void {
  if (game) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: VIEWPORT.renderWidth,
    height: VIEWPORT.renderHeight,
    backgroundColor: '#172536',
    pixelArt: true,
    antialias: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new StationScene(arenaSelection, 'score-brawl', audioPresentation)],
  });
  if (import.meta.env.DEV) (window as typeof window & { __turenkiGame?: Phaser.Game }).__turenkiGame = game;
}

titleStart?.addEventListener('click', enterMenu);
onboarding?.addEventListener('pointerdown', () => enterMenu());
document.addEventListener('keydown', (event) => {
  if (onboardingState !== 'title' || event.repeat || event.key === 'Tab' || event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
  event.preventDefault();
  enterMenu();
}, true);
menu?.querySelectorAll<HTMLButtonElement>('button[data-route]').forEach((button) => {
  button.addEventListener('click', () => enterRoute(button.dataset.route ?? 'local'));
});

// Gamepad APIs do not expose button events on all browsers, so sample briefly
// while the title is active. This only advances presentation state.
let previousPadButtons = new Map<number, boolean>();
let gamepadMenuIndex = 0;
function pollGamepadActivation(): void {
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad => pad !== null);
  const current = new Map<number, boolean>();
  let pressedIndex = -1;
  for (const pad of pads) pad.buttons.forEach((button, index) => {
    const key = pad.index * 32 + index;
    current.set(key, button.pressed);
    if (button.pressed && !previousPadButtons.get(key) && pressedIndex < 0) pressedIndex = index;
  });
  if (onboardingState === 'title' && pressedIndex >= 0) enterMenu();
  else if (onboardingState === 'menu' && pressedIndex >= 0) {
    const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button[data-route]') ?? []);
    if (pressedIndex === 12 || pressedIndex === 14) gamepadMenuIndex = (gamepadMenuIndex + buttons.length - 1) % buttons.length;
    else if (pressedIndex === 13 || pressedIndex === 15) gamepadMenuIndex = (gamepadMenuIndex + 1) % buttons.length;
    else buttons[gamepadMenuIndex]?.click();
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === gamepadMenuIndex)));
  }
  previousPadButtons = current;
  if (onboardingState !== 'entered') requestAnimationFrame(pollGamepadActivation);
}
requestAnimationFrame(pollGamepadActivation);

const arenaSelection = resolveArenaSelection(window.location.search);
document.documentElement.dataset.visualStyle = arenaSelection.style;
const pageDescription = document.querySelector('.page-header p');
if (pageDescription) {
  if (arenaSelection.notice) pageDescription.textContent = arenaSelection.notice;
  else if (arenaSelection.manifest.id === 'kkauppa') pageDescription.textContent = 'K-kauppa · interior 2.5D arena prototype';
  else if (arenaSelection.manifest.id !== 'station') pageDescription.textContent = `${arenaSelection.manifest.displayName} · evening 2.5D arena prototype`;
}

const arenaSelect = document.getElementById('arena-select') as HTMLSelectElement | null;
if (arenaSelect) {
  arenaSelect.value = arenaSelection.manifest.id;
  arenaSelect.addEventListener('change', () => {
    const next = new URL(window.location.href);
    if (arenaSelect.value === 'station') next.searchParams.delete('arena');
    else next.searchParams.set('arena', arenaSelect.value);
    window.location.assign(next);
  });
}

const displayScale = new URLSearchParams(window.location.search).get('scale') === '2' ? '2' : 'fit';
if (displayScale === '2') document.body.classList.add('integer-scale-2');
const scaleSelect = document.getElementById('display-scale') as HTMLSelectElement | null;
if (scaleSelect) {
  scaleSelect.value = displayScale;
  scaleSelect.addEventListener('change', () => {
    const next = new URL(window.location.href);
    if (scaleSelect.value === '2') next.searchParams.set('scale', '2');
    else next.searchParams.delete('scale');
    window.location.assign(next);
  });
}
