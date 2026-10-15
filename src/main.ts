import Phaser from 'phaser';
import './styles.css';
import { WildScene } from './game/WildScene';
import { gameEvents, type HudState } from './game/events';

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
const soundReadout = document.querySelector<HTMLElement>('#sound-readout');
const daylight = document.querySelector<HTMLElement>('#daylight');
const vignette = document.querySelector<HTMLElement>('#vignette');
const packStatus = document.querySelector<HTMLElement>('#pack-status');
const sneakControl = document.querySelector<HTMLElement>('#sneak-control');
const packControls = document.querySelectorAll<HTMLElement>('[data-pack-control]');

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
  setText('#context-action', state.contextAction);
  setText('#event-line', state.eventLine);
  setText('#scent-summary', state.scentSummary);
  setText('#scent-direction-arrow', state.scentDirectionArrow);
  setText('#scent-direction-label', state.scentDirectionLabel);
  setText('#sound-summary', state.soundSummary);
  setText('#niva-status', state.pack.find((wolf) => wolf.name === 'Niva')?.status ?? 'DISTANT');
  setText('#torr-status', state.pack.find((wolf) => wolf.name === 'Torr')?.status ?? 'DISTANT');
  const hasPack = state.pack.length > 0;
  if (packStatus) packStatus.hidden = !hasPack;
  for (const control of packControls) control.hidden = !hasPack;
  setText('#objective-title', hasPack ? 'SURVIVE TOGETHER' : 'SURVIVE THE WILD');
  setText('#save-status', state.saveStatus);
  if (scentReadout) scentReadout.hidden = !state.scentActive;
  if (soundReadout) soundReadout.hidden = !state.soundSummary;
  if (sneakControl) {
    sneakControl.classList.toggle('active', state.sneaking);
    sneakControl.setAttribute('aria-label', state.sneaking ? 'Sneaking enabled' : 'Sneaking disabled');
  }
  setText('#sneak-label', state.sneaking ? 'CROUCHING' : 'SNEAK');
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
document.querySelector('#restart-button')?.addEventListener('click', () => {
  if (deathPanel) deathPanel.hidden = true;
  gameEvents.emit('restart-request');
});

new Phaser.Game({
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
  scene: [WildScene],
});
