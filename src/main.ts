import Phaser from 'phaser';
import './styles.css';
import { WildScene } from './game/WildScene';
import { gameEvents, type HudState, type HuntLogEntry, type SleepTransition } from './game/events';
import { DEFAULT_DIFFICULTY, type DifficultyMode } from './game/systems/BalanceConfig';
import { runFullReset } from './game/systems/FullResetSystem';
import { SaveSystem } from './game/systems/SaveSystem';

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
const scentReadout = document.querySelector<HTMLElement>('#scent-readout');
const scentSummary = document.querySelector<HTMLElement>('#scent-summary');
const soundReadout = document.querySelector<HTMLElement>('#sound-readout');
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

const renderScentClues = (state: HudState) => {
  if (!scentSummary) return;
  scentSummary.replaceChildren();
  const clues = state.scentClues.length > 0
    ? state.scentClues
    : [{ text: state.scentSummary || 'The wind carries no clear trail.', targeted: false }];
  for (const clue of clues) {
    const line = document.createElement('span');
    line.className = `scent-clue${clue.targeted ? ' targeted' : ''}`;
    line.textContent = clue.text;
    scentSummary.append(line);
  }
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
  renderScentClues(state);
  setText('#scent-direction-arrow', state.scentDirectionArrow);
  setText('#scent-direction-label', state.scentDirectionLabel);
  setText('#sound-summary', state.soundSummary);
  setText('#niva-status', state.pack.find((wolf) => wolf.name === 'Niva')?.status ?? 'DISTANT');
  setText('#torr-status', state.pack.find((wolf) => wolf.name === 'Torr')?.status ?? 'DISTANT');
  const hasPack = state.pack.length > 0;
  if (packStatus) packStatus.hidden = !hasPack;
  for (const control of packControls) control.hidden = !hasPack;
  setText('#objective-title', state.difficulty === 'survival'
    ? `${state.leanDay ? 'LEAN DAY' : 'SURVIVAL'} · ${state.protectedCacheCount}/${state.cacheCount} CACHES GUARDED`
    : hasPack ? 'EXPLORE TOGETHER' : 'EXPLORE THE WILD');
  setText('#save-status', state.saveStatus);
  if (scentReadout) {
    scentReadout.hidden = !state.scentActive;
    scentReadout.classList.toggle('tracking-target', state.trackingTarget);
  }
  if (soundReadout) soundReadout.hidden = !state.soundSummary;
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
