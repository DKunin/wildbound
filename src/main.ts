import Phaser from 'phaser';
import './styles.css';
import { WildScene } from './game/WildScene';
import { gameEvents, type HudState, type HuntLogEntry, type SleepTransition } from './game/events';
import { DEFAULT_DIFFICULTY, type DifficultyMode } from './game/systems/BalanceConfig';
import { runFullReset } from './game/systems/FullResetSystem';
import { SaveSystem } from './game/systems/SaveSystem';
import { SENSE_DIRECTIONS, type SenseHudCue, type SenseKind } from './game/systems/SenseHudSystem';

const clampPercent = (value: number) => `${Math.max(0, Math.min(100, value))}%`;

const setMeter = (name: 'health' | 'hunger' | 'thirst' | 'stamina', value: number) => {
  const bar = document.querySelector<HTMLElement>(`#${name}-bar`);
  const output = document.querySelector<HTMLElement>(`#${name}-value`);
  if (bar) bar.style.width = clampPercent(value);
  if (output) output.textContent = `${Math.round(value)} percent`;
};

const setText = (selector: string, value: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (node) node.textContent = value;
};

const pausePanel = document.querySelector<HTMLElement>('#pause-panel');
const deathPanel = document.querySelector<HTMLElement>('#death-panel');
const senseHud = document.querySelector<HTMLElement>('#sense-hud');
const daylight = document.querySelector<HTMLElement>('#daylight');
const sleepCurtain = document.querySelector<HTMLElement>('#sleep-curtain');
const vignette = document.querySelector<HTMLElement>('#vignette');
const packStatus = document.querySelector<HTMLElement>('#pack-status');
const sneakControl = document.querySelector<HTMLElement>('#sneak-control');
const hungerMode = document.querySelector<HTMLElement>('#hunger-mode');
const restSkipControl = document.querySelector<HTMLButtonElement>('#rest-skip-control');
const territoryMarkControl = document.querySelector<HTMLButtonElement>('#territory-mark-control');
const packControls = document.querySelectorAll<HTMLElement>('[data-pack-control]');
const mainMenu = document.querySelector<HTMLElement>('#main-menu');
const logModeToggles = document.querySelectorAll<HTMLButtonElement>('[data-log-mode-toggle]');
const logModeStates = document.querySelectorAll<HTMLElement>('[data-log-mode-state]');
const huntLog = document.querySelector<HTMLElement>('#hunt-log');
const huntLogList = document.querySelector<HTMLOListElement>('#hunt-log-list');
const difficultyButtons = document.querySelectorAll<HTMLButtonElement>('[data-difficulty]');
const startButton = document.querySelector<HTMLButtonElement>('#start-button');
const fullResetButton = document.querySelector<HTMLButtonElement>('#full-reset-button');
const mainMenuStatus = document.querySelector<HTMLElement>('#main-menu-status');
const menuSaves = new SaveSystem();
let logModeEnabled = false;
let selectedDifficulty: DifficultyMode = DEFAULT_DIFFICULTY;
let game: Phaser.Game | undefined;
let menuBusy = false;

const setDifficulty = (difficulty: DifficultyMode) => {
  if (game) return;
  selectedDifficulty = difficulty;
  for (const button of difficultyButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.difficulty === selectedDifficulty));
  }
};

const renderLogMode = () => {
  for (const toggle of logModeToggles) toggle.setAttribute('aria-checked', String(logModeEnabled));
  for (const state of logModeStates) state.textContent = logModeEnabled ? 'ON' : 'OFF';
};

const setLogMode = (enabled: boolean) => {
  logModeEnabled = enabled;
  renderLogMode();
  if (huntLog) huntLog.hidden = !enabled;
  if (game) {
    game.registry.set('logMode', enabled);
    gameEvents.emit('log-mode-request', enabled);
  }
};

const clearHuntLog = () => {
  if (!huntLogList) return;
  huntLogList.replaceChildren();
  const placeholder = document.createElement('li');
  placeholder.className = 'hunt-log-empty';
  placeholder.dataset.logPlaceholder = '';
  placeholder.textContent = 'Waiting for an animal to notice you.';
  huntLogList.append(placeholder);
};

const appendHuntLog = ({ time, message }: HuntLogEntry) => {
  if (!logModeEnabled || !huntLogList) return;
  huntLogList.querySelector('[data-log-placeholder]')?.remove();
  const item = document.createElement('li');
  const timestamp = document.createElement('time');
  const copy = document.createElement('span');
  timestamp.textContent = time;
  copy.textContent = message;
  item.append(timestamp, copy);
  huntLogList.prepend(item);
  while (huntLogList.children.length > 8) huntLogList.lastElementChild?.remove();
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SENSE_KIND_LABEL: Record<SenseKind, string> = {
  rabbit: 'rabbit',
  deer: 'deer',
  elk: 'elk',
  boar: 'boar',
  pack: 'pack wolf',
  carcass: 'carrion',
  cache: 'buried meat cache',
  territory: 'your territory mark',
  water: 'water',
};

const signalLevel = (strength: number): string => (
  strength >= 0.7 ? 'strong' : strength >= 0.38 ? 'clear' : 'faint'
);

const createSenseIcon = (kind: SenseKind): SVGSVGElement => {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  const use = document.createElementNS(SVG_NAMESPACE, 'use');
  icon.classList.add('sense-icon');
  icon.setAttribute('viewBox', '0 0 36 36');
  icon.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `#sense-icon-${kind}`);
  icon.append(use);
  return icon;
};

const createSenseModality = (kind: 'scent' | 'hearing'): HTMLSpanElement => {
  const wrapper = document.createElement('span');
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  wrapper.className = `sense-modality sense-${kind}`;
  wrapper.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 18 24');
  const paths = kind === 'scent'
    ? ['M16 3C5 5 14 9 3 11', 'M15 12C5 14 12 18 2 21']
    : ['M3 8c4 2 4 6 0 8', 'M7 4c8 4 8 12 0 16'];
  for (const data of paths) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', data);
    icon.append(path);
  }
  wrapper.append(icon);
  return wrapper;
};

const describeCue = (cue: SenseHudCue): string => {
  const senses = [
    cue.scentStrength > 0 ? `${signalLevel(cue.scentStrength)} scent` : '',
    cue.hearingStrength > 0 ? `${signalLevel(cue.hearingStrength)} sound` : '',
  ].filter(Boolean).join(' and ');
  const count = cue.count > 1 ? `${cue.count} ` : '';
  return `${cue.targeted ? 'Marked ' : ''}${count}${SENSE_KIND_LABEL[cue.kind]}, ${cue.direction}, ${senses}`;
};

const renderSenseHud = (state: HudState): void => {
  if (!senseHud) return;
  const fragment = document.createDocumentFragment();
  for (const direction of SENSE_DIRECTIONS) {
    const cues = state.senseCues.filter((cue) => cue.direction === direction);
    if (cues.length === 0) continue;
    const slot = document.createElement('div');
    slot.className = 'sense-slot';
    slot.dataset.direction = direction;
    for (const cue of cues) {
      const element = document.createElement('span');
      element.className = `sense-cue${cue.targeted ? ' targeted' : ''}`;
      element.dataset.kind = cue.kind;
      element.style.setProperty('--sense-strength', String(cue.strength));
      element.style.setProperty('--scent-strength', String(cue.scentStrength));
      element.style.setProperty('--hearing-strength', String(cue.hearingStrength));
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', describeCue(cue));
      element.append(createSenseIcon(cue.kind));
      if (cue.scentStrength > 0) element.append(createSenseModality('scent'));
      if (cue.hearingStrength > 0) element.append(createSenseModality('hearing'));
      if (cue.count > 1) {
        const dots = document.createElement('span');
        dots.className = 'sense-count-dots';
        dots.setAttribute('aria-hidden', 'true');
        for (let index = 0; index < Math.min(3, cue.count); index += 1) dots.append(document.createElement('i'));
        element.append(dots);
      }
      slot.append(element);
    }
    fragment.append(slot);
  }
  senseHud.replaceChildren(fragment);
  senseHud.setAttribute('aria-label', state.scentActive
    ? 'Off-screen sounds and scents. Scent focus is active.'
    : 'Off-screen sounds. Press Q to focus on scents.');
};

const startGame = () => {
  if (game) return;
  if (mainMenu) mainMenu.hidden = true;
  if (huntLog) huntLog.hidden = !logModeEnabled;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#101813',
    pixelArt: false,
    render: {
      antialias: true,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    callbacks: {
      preBoot: (createdGame) => {
        createdGame.registry.set('logMode', logModeEnabled);
        createdGame.registry.set('difficulty', selectedDifficulty);
      },
    },
    scene: [WildScene],
  });
};

const setMenuBusy = (busy: boolean) => {
  menuBusy = busy;
  for (const button of mainMenu?.querySelectorAll<HTMLButtonElement>('button') ?? []) button.disabled = busy;
};

const fullResetAndStart = async () => {
  if (game || menuBusy) return;
  setMenuBusy(true);
  if (mainMenuStatus) mainMenuStatus.textContent = 'CLEARING THE REMEMBERED LIFE…';
  const started = await runFullReset({
    clearSave: () => menuSaves.clear(),
    startFresh: () => {
      clearHuntLog();
      if (mainMenuStatus) mainMenuStatus.textContent = '';
      startGame();
    },
    reportFailure: () => {
      if (mainMenuStatus) mainMenuStatus.textContent = 'FULL RESET FAILED. THE SAVED LIFE WAS NOT CLEARED.';
    },
  });
  if (!started) setMenuBusy(false);
};

for (const toggle of logModeToggles) toggle.addEventListener('click', () => setLogMode(!logModeEnabled));
for (const button of difficultyButtons) button.addEventListener('click', () => {
  const difficulty = button.dataset.difficulty;
  if (difficulty === 'survival' || difficulty === 'explorer') setDifficulty(difficulty);
});
startButton?.addEventListener('click', startGame);
fullResetButton?.addEventListener('click', () => { void fullResetAndStart(); });
gameEvents.on('hunt-log', appendHuntLog);
gameEvents.on('sleep-transition', ({ sleeping, durationMs }: SleepTransition) => {
  if (!sleepCurtain) return;
  sleepCurtain.style.setProperty('--sleep-fade-duration', `${durationMs}ms`);
  sleepCurtain.classList.toggle('sleeping', sleeping);
});
renderLogMode();

gameEvents.on('hud', (state: HudState) => {
  setMeter('health', state.health);
  setMeter('hunger', state.hunger);
  setMeter('thirst', state.thirst);
  setMeter('stamina', state.stamina);
  setText('#time', `DAY ${state.day}  ${state.time}`);
  setText('#time-icon', state.timeIcon);
  setText('#weather', state.phaseLabel);
  setText('#wind-arrow', state.windArrow);
  setText('#wind-label', state.windLabel);
  setText('#territory', state.territoryLabel);
  setText('#difficulty-status', `${state.difficulty.toUpperCase()}${state.leanDay ? ' · LEAN DAY' : ''}`);
  setText('#context-action', state.contextAction);
  setText('#hunger-mode', state.willEatMeat ? 'HUNGRY · WILL EAT' : 'SATIATED · WILL CACHE');
  hungerMode?.classList.toggle('hungry', state.willEatMeat);
  setText('#event-line', state.eventLine);
  renderSenseHud(state);
  setText('#niva-status', state.pack.find((wolf) => wolf.name === 'Niva')?.status ?? 'DISTANT');
  setText('#torr-status', state.pack.find((wolf) => wolf.name === 'Torr')?.status ?? 'DISTANT');
  const hasPack = state.pack.length > 0;
  if (packStatus) packStatus.hidden = !hasPack;
  for (const control of packControls) control.hidden = !hasPack;
  setText('#objective-title', state.difficulty === 'survival'
    ? `${state.leanDay ? 'LEAN DAY' : 'SURVIVAL'} · ${state.protectedCacheCount}/${state.cacheCount} CACHES GUARDED`
    : hasPack ? 'EXPLORE TOGETHER' : 'EXPLORE THE WILD');
  setText('#save-status', state.saveStatus);
  if (sneakControl) {
    sneakControl.classList.toggle('active', state.sneaking);
    sneakControl.setAttribute('aria-label', state.sneaking ? 'Sneaking enabled' : 'Sneaking disabled');
  }
  setText('#sneak-label', state.sneaking ? 'CROUCHING' : 'SNEAK');
  if (restSkipControl) restSkipControl.hidden = !state.canSkipRest;
  if (territoryMarkControl) {
    territoryMarkControl.disabled = !state.canMarkTerritory;
    territoryMarkControl.title = state.canMarkTerritory
      ? 'Leave a scent mark at your current position'
      : 'This scent mark is still too fresh';
  }
  if (daylight) {
    daylight.style.backgroundColor = state.ambientColor;
    daylight.style.opacity = String(state.ambientOpacity);
  }
  if (vignette) {
    const danger = Math.max(state.hunger, state.thirst, 100 - state.health);
    vignette.style.opacity = String(Math.max(0, (danger - 65) / 60));
  }
});

gameEvents.on('pause', (paused: boolean) => {
  if (pausePanel) pausePanel.hidden = !paused;
});

gameEvents.on('death', (cause: string) => {
  if (deathPanel) deathPanel.hidden = false;
  setText('#death-copy', `${cause} The forest carries on without you.`);
});

document.querySelector('#resume-button')?.addEventListener('click', () => gameEvents.emit('resume-request'));
document.querySelector('#load-button')?.addEventListener('click', () => gameEvents.emit('load-request'));
restSkipControl?.addEventListener('click', () => gameEvents.emit('skip-rest-request'));
territoryMarkControl?.addEventListener('click', () => gameEvents.emit('mark-territory-request'));
document.querySelector('#restart-button')?.addEventListener('click', () => {
  if (deathPanel) deathPanel.hidden = true;
  clearHuntLog();
  gameEvents.emit('restart-request');
});
