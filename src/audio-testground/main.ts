import Phaser from 'phaser';
import './style.css';
import { FOREST_AUDIO_ASSETS, ForestAudioSystem, forestAudioUrl, type AudioLayer } from '../game/systems/ForestAudioSystem';
import { getEnvironmentMotionSample } from '../game/systems/EnvironmentMotion';
import { WindMotionClock } from '../game/systems/WindResponse';
import { WindSystem } from '../game/systems/WindSystem';
import { advanceSimulationTime } from '../game/systems/WorldTimeSystem';
import { ANIMAL_AUDIO_ASSETS, ANIMAL_AUDIO_PROFILES, animalAudioUrl, type AnimalAudioSource, type AudioSpecies } from '../game/systems/AnimalAudioSystem';

const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const play = document.querySelector<HTMLButtonElement>('#audio-play')!;
const status = document.querySelector<HTMLElement>('#audio-status')!;
const power = input('wind-power');
const distance = input('tree-distance');
const follow = input('follow-wind');
const night = input('night');
const side = input('tree-side');
let playing = false;
let scene: AudioTestground;
const animalIds = Array.from({ length: 8 }, () => ({}));
let audition: 'step' | 'call' | undefined;
const selection = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const trees = [{ x: 1000, y: 300 }, { x: 1000, y: 120 }, { x: 1000, y: 480 }];
const river = [{ x: 140, y: 0, width: 80, height: 600 }];
const meterRows = new Map<string, { meter: HTMLMeterElement; output: HTMLOutputElement }>();
for (const [key, label] of [['forest', 'Wind'], ['gust', 'Gusts'], ['foliage', 'Leaves'], ['water', 'Stream']]) {
  const row = document.createElement('div');
  row.className = 'meter-row';
  const name = document.createElement('span');
  name.textContent = label;
  const meter = document.createElement('meter');
  meter.min = 0; meter.max = 1; meter.value = 0;
  meter.setAttribute('aria-label', `${label} gain`);
  const output = document.createElement('output');
  output.dataset.channel = key;
  row.append(name, meter, output);
  document.querySelector('#audio-meters')!.append(row);
  meterRows.set(key, { meter, output });
}

class AudioTestground extends Phaser.Scene {
  audio!: ForestAudioSystem;
  private readonly wind = new WindSystem();
  private readonly motion = new WindMotionClock();
  private simulationTime = 18 * 60 + 42;
  private marker!: Phaser.GameObjects.Arc;
  private grove: Phaser.GameObjects.Image[] = [];
  private windLines!: Phaser.GameObjects.Graphics;
  private lastReadout = 0;
  private failed = false;
  private animals: AnimalAudioSource[] = [];
  private animalMarkers: Phaser.GameObjects.Arc[] = [];
  private passTime = 0;

  constructor() { super('audio-testground'); }
  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.failed = true;
      status.textContent = `Could not load ${file.key}. Reload to retry.`;
    });
    for (const key of FOREST_AUDIO_ASSETS) this.load.audio(`nature-${key}`, forestAudioUrl(key));
    for (const key of ANIMAL_AUDIO_ASSETS) this.load.audio(`animal-${key}`, animalAudioUrl(key));
    this.load.image('ground', 'assets/ground-base-v3.png');
    this.load.spritesheet('trees', 'assets/obstacle-atlas-v3.png', { frameWidth: 313, frameHeight: 313 });
  }
  create(): void {
    scene = this;
    this.add.tileSprite(1000, 300, 2000, 600, 'ground').setAlpha(0.45);
    this.add.rectangle(180, 300, 80, 600, 0x406e75, 0.85);
    const rings = this.add.graphics().lineStyle(2, 0xc5d3a0, 0.28);
    rings.strokeCircle(1000, 300, 400);
    this.add.text(150, 520, 'STREAM', { fontSize: '20px', color: '#e2eee4' });
    this.grove = trees.map((tree, index) => this.add.image(tree.x, tree.y, 'trees', index === 1 ? 5 : index).setScale(0.7));
    this.marker = this.add.circle(840, 300, 14, 0xf2d995).setStrokeStyle(4, 0x13241a).setDepth(10);
    this.windLines = this.add.graphics().setDepth(20);
    this.animalMarkers = animalIds.map(() => this.add.circle(0, 0, 10, 0xd49c77).setDepth(11));
    this.audio = new ForestAudioSystem(this, river, Math.random, { trees: () => trees, animals: () => this.animals, controls: false });
    for (const toggle of document.querySelectorAll<HTMLInputElement>('[data-layer]')) {
      this.audio.setLayerEnabled(toggle.dataset.layer as AudioLayer, toggle.checked);
    }
    if (!this.failed) {
      status.textContent = 'Ready. Press Play sound to begin.';
      play.disabled = false;
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.destroy());
  }
  update(time: number, delta: number): void {
    const active = playing && !document.hidden;
    if (follow.checked) {
      if (active) this.simulationTime = advanceSimulationTime(this.simulationTime, Math.min(delta / 1000, 0.1));
      power.value = String(Math.round(this.wind.getState(this.simulationTime).strength * 100));
    }
    power.disabled = follow.checked;
    const strength = follow.checked ? this.wind.getState(this.simulationTime).strength : Number(power.value) / 100;
    const separation = Number(distance.value);
    this.marker.x = 1000 + (side.checked ? separation : -separation);
    const species = selection('animal-species').value as AudioSpecies;
    const state = selection('animal-state').value;
    const animalDistance = Number(input('animal-distance').value);
    const angle = Number(input('animal-angle').value) * Math.PI / 180;
    if (active) this.passTime += Math.min(delta / 1000, .1);
    const passby = input('animal-passby').checked;
    const speed = state === 'idle' || state === 'dead' ? 0 : Number(input('animal-speed').value);
    this.animals = animalIds.slice(0, Number(selection('animal-count').value)).map((id, index) => ({
      id, species, state, speed, vocal: input('animal-auto-calls').checked,
      x: this.marker.x + (passby ? Math.sin(this.passTime * .35) * animalDistance : Math.cos(angle) * animalDistance) + index * 18,
      y: this.marker.y + (passby ? 30 : Math.sin(angle) * animalDistance) + index * 10,
    }));
    this.animalMarkers.forEach((marker, index) => {
      const animal = this.animals[index];
      marker.setVisible(Boolean(animal));
      if (animal) marker.setPosition(animal.x, animal.y).setFillStyle(state === 'dead' ? 0x687264 : 0xd49c77);
    });
    this.audio.animals.setLayerEnabled('calls', input('animal-calls').checked);
    this.audio.animals.setLayerEnabled('steps', input('animal-steps').checked);
    this.audio.update(delta, this.marker, strength, night.checked, active);
    if (audition) {
      const played = this.audio.animals.audition(this.animals[0], audition);
      status.textContent = played ? `Playing ${species} ${audition}.` : 'Not played: paused, dead, out of range, disabled layer, or voice limit.';
      audition = undefined;
    }
    for (const id of ['animal-call', 'animal-step']) document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = !active;
    if (active) this.motion.advance(delta, strength);
    this.grove.forEach((tree, index) => {
      const sample = getEnvironmentMotionSample('tree', this.motion.time, index * 1.7, undefined, strength);
      tree.setAngle(sample.angle).setScale(0.7 * sample.scaleX, 0.7 * sample.scaleY);
    });
    // Moving air trails make changes in speed legible at the testground's overview scale.
    this.windLines.clear().lineStyle(2, 0xe3edce, strength * 0.35);
    for (let index = 0; index < 14; index++) {
      const x = (this.motion.time / 12 + index * 157) % 2000;
      const y = 70 + (index * 79) % 470;
      this.windLines.lineBetween(x, y, x + 20 + strength * 60, y);
    }
    if (time - this.lastReadout < 100) return;
    this.lastReadout = time;
    document.querySelector<HTMLOutputElement>('#wind-value')!.value = `${power.value}%`;
    document.querySelector<HTMLOutputElement>('#distance-value')!.value = `${separation / 10} m`;
    document.querySelector<HTMLOutputElement>('#animal-distance-value')!.value = `${animalDistance / 10} m`;
    document.querySelector<HTMLOutputElement>('#animal-angle-value')!.value = `${input('animal-angle').value}°`;
    document.querySelector<HTMLOutputElement>('#animal-speed-value')!.value = `${speed / 10} m/s`;
    const profile = ANIMAL_AUDIO_PROFILES[species];
    document.querySelector('#animal-profile')!.textContent = `${profile.label} · Steps: ${profile.reach / 10} m · Calls/signals: ${profile.callReach / 10} m · Three step variations.`;
    const animalMix = this.audio.animals.snapshot();
    document.querySelector<HTMLOutputElement>('#animal-readout')!.value = `${animalMix.active}/16 voices · ${animalMix.played} events · Last: ${animalMix.last}\n${animalMix.voices.map(voice => `${voice.key}: ${Math.round(voice.volume * 100)}% / pan ${voice.pan.toFixed(2)}`).join(' · ')}`;
    for (const channel of this.audio.snapshot()) {
      const row = meterRows.get(channel.key);
      if (!row) continue;
      row.meter.value = channel.playing ? channel.volume : 0;
      row.output.value = `${Math.round(row.meter.value * 100)}% · ${channel.rate.toFixed(2)}×`;
    }
  }
}

play.addEventListener('click', () => {
  playing = !playing;
  play.textContent = playing ? 'PAUSE SOUND' : 'PLAY SOUND';
  play.setAttribute('aria-pressed', String(playing));
  status.textContent = playing ? 'Listening. Adjust the wind or move toward the trees.' : 'Paused. Sound and movement are stopped.';
});
for (const kind of ['call', 'step'] as const) {
  document.querySelector(`#animal-${kind}`)!.addEventListener('click', () => { audition = kind; });
}
selection('animal-state').addEventListener('change', () => {
  input('animal-speed').value = ['run', 'flee'].includes(selection('animal-state').value) ? '240' : '80';
});
selection('animal-species').addEventListener('change', () => scene?.audio.animals.silence());
document.querySelector('#animal-solo')!.addEventListener('click', () => {
  for (const toggle of document.querySelectorAll<HTMLInputElement>('[data-layer]')) {
    toggle.checked = false; scene?.audio.setLayerEnabled(toggle.dataset.layer as AudioLayer, false);
  }
});
for (const preset of document.querySelectorAll<HTMLButtonElement>('[data-wind]')) {
  preset.addEventListener('click', () => { follow.checked = false; power.value = preset.dataset.wind!; });
}
for (const toggle of document.querySelectorAll<HTMLInputElement>('[data-layer]')) {
  toggle.addEventListener('change', () => scene?.audio.setLayerEnabled(toggle.dataset.layer as AudioLayer, toggle.checked));
}
new Phaser.Game({
  type: Phaser.AUTO, parent: 'audio-stage', backgroundColor: '#22392a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY, width: 2000, height: 600 },
  scene: AudioTestground,
});
