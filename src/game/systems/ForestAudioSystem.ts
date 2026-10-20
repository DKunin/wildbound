import type Phaser from 'phaser';
import type { SoundSource } from './SoundModel';
import { windResponse } from './WindResponse';
import { AnimalAudioSystem, type AnimalAudioSource } from './AnimalAudioSystem';

export const FOREST_AUDIO_ASSETS = ['forest', 'water', 'foliage', 'gust', 'bird-1', 'bird-2', 'bird-3'] as const;
type AudioKey = typeof FOREST_AUDIO_ASSETS[number];
export const forestAudioUrl = (key: AudioKey): string =>
  `assets/audio/${key}.wav${key === 'foliage' ? '?v=canopy-1' : ''}`;
export type AudioLayer = 'wind' | 'foliage' | 'birds' | 'water';
type Voice = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
type WaterArea = SoundSource & { width: number; height: number };
export const TREE_AUDIO_REACH = 400;

export function treeAudioMix(listener: SoundSource, trees: readonly SoundSource[]): { proximity: number; pan: number } {
  let nearest = TREE_AUDIO_REACH;
  let offset = 0;
  for (const tree of trees) {
    const distance = Math.hypot(tree.x - listener.x, tree.y - listener.y);
    if (distance < nearest) { nearest = distance; offset = tree.x - listener.x; }
  }
  return { proximity: (1 - nearest / TREE_AUDIO_REACH) ** 2, pan: Math.max(-0.8, Math.min(0.8, offset / TREE_AUDIO_REACH)) };
}

interface ForestAudioOptions {
  trees?: (listener: SoundSource) => readonly SoundSource[];
  animals?: () => readonly AnimalAudioSource[];
  /** The testground owns its controls and must never change gameplay preferences. */
  controls?: boolean;
}

/** Use only flowing-water areas, never pools. Overlapping river tiles must not stack volume. */
export function waterAudioMix(listener: SoundSource, areas: readonly WaterArea[]): { volume: number; pan: number } {
  let distance = 720;
  let offset = 0;
  for (const area of areas) {
    const x = Math.max(area.x, Math.min(area.x + area.width, listener.x));
    const y = Math.max(area.y, Math.min(area.y + area.height, listener.y));
    const next = Math.hypot(x - listener.x, y - listener.y);
    if (next < distance) {
      distance = next;
      offset = x - listener.x;
    }
  }
  return { volume: 0.46 * (1 - distance / 720) ** 2, pan: Math.max(-0.8, Math.min(0.8, offset / 720)) };
}

/**
 * Real-time audio is independent of the accelerated simulation clock and hearing HUD.
 * Phaser owns decoding, browser gesture unlock, and the shared audio context.
 */
export class ForestAudioSystem {
  readonly animals: AnimalAudioSystem;
  private readonly voices = new Map<AudioKey, Voice>();
  private muted = false;
  private birdWait = 4;
  private gustWait = 9;
  private lastBird = -1;
  private readonly layers = { wind: true, foliage: true, birds: true, water: true };
  private readonly button: HTMLButtonElement | null;

  constructor(
    scene: Phaser.Scene,
    private readonly areas: readonly WaterArea[],
    private readonly random = Math.random,
    private readonly options: ForestAudioOptions = {},
  ) {
    this.animals = new AnimalAudioSystem(scene, random);
    this.button = options.controls === false ? null : document.querySelector<HTMLButtonElement>('#forest-audio-toggle');
    if (options.controls !== false) {
      try { this.muted = localStorage.getItem('wildbound:audio-muted') === 'true'; } catch { /* Optional preference storage. */ }
    }
    for (const key of FOREST_AUDIO_ASSETS) {
      const cacheKey = `nature-${key}`;
      // Missing audio must not prevent playing the game.
      if (!scene.cache.audio.exists(cacheKey)) continue;
      const voice = scene.sound.add(cacheKey, { loop: key === 'forest' || key === 'water' || key === 'foliage', volume: 0 });
      this.voices.set(key, voice as Voice);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    if (options.controls !== false) window.addEventListener('keydown', this.onKey);
    this.button?.addEventListener('click', this.toggleMute);
    this.renderButton();
  }

  setLayerEnabled(layer: AudioLayer, enabled: boolean): void { this.layers[layer] = enabled; }

  snapshot() {
    return [...this.voices].map(([key, voice]) => ({
      key, volume: voice.volume, rate: voice.rate, pan: voice.pan, playing: voice.isPlaying,
    }));
  }

  private readonly onVisibility = (): void => { if (document.hidden) this.silence(); };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyN' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName))) return;
    this.toggleMute();
  };
  private readonly toggleMute = (): void => {
    this.muted = !this.muted;
    try { localStorage.setItem('wildbound:audio-muted', String(this.muted)); } catch { /* Audio still works without persistence. */ }
    if (this.muted) this.silence();
    this.renderButton();
  };

  private renderButton(): void {
    if (!this.button) return;
    this.button.setAttribute('aria-pressed', String(!this.muted));
    this.button.textContent = `FOREST AUDIO: ${this.muted ? 'OFF' : 'ON'} (N)`;
  }

  update(delta: number, listener: SoundSource, wind: number, night: boolean, active: boolean): void {
    if (!active || this.muted || document.hidden) {
      this.silence();
      return;
    }
    const seconds = Math.min(Math.max(delta / 1000, 0), 0.1);
    this.animals.update(delta, listener, this.options.animals?.() ?? [], true);
    const response = windResponse(wind);
    const water = waterAudioMix(listener, this.areas);
    const trees = treeAudioMix(listener, this.options.trees?.(listener) ?? []);
    this.loop('forest', this.layers.wind ? response.volume : 0, 0, seconds, response.rate);
    this.loop('water', this.layers.water ? water.volume : 0, water.pan, seconds);
    this.loop('foliage', this.layers.foliage ? trees.proximity * response.foliageVolume : 0, trees.pan, seconds, response.foliageRate);
    this.birdWait -= seconds;
    // Countdown in normalized gust cycles so a changing wind changes the next arrival too.
    this.gustWait -= seconds * 24 / response.gustInterval;
    const gust = this.voices.get('gust');
    if (gust?.isPlaying) {
      const blend = 1 - Math.exp(-seconds / 1.5);
      gust.setVolume(gust.volume + ((this.layers.wind ? response.gustVolume : 0) - gust.volume) * blend);
      gust.setRate(gust.rate + (response.rate - gust.rate) * blend);
    }
    if (night || !this.layers.birds) {
      for (const key of ['bird-1', 'bird-2', 'bird-3'] as const) this.voices.get(key)?.stop();
      this.birdWait = Math.max(3, this.birdWait);
    } else if (this.birdWait <= 0) {
      // Exclude the last phrase so consecutive calls always vary.
      const index = (this.lastBird + 1 + Math.floor(this.random() * 2)) % 3;
      this.lastBird = index;
      this.voices.get(`bird-${index + 1}` as AudioKey)?.play({ volume: 0.17 + this.random() * 0.13, pan: this.random() * 1.5 - 0.75 });
      this.birdWait = 10 + this.random() * 18;
    }
    if (this.gustWait <= 0 && response.power > 0 && this.layers.wind) {
      gust?.play({ volume: response.gustVolume, rate: response.rate, pan: this.random() * 1.2 - 0.6 });
      this.gustWait = 24 * (0.85 + this.random() * 0.3);
    }
  }

  private loop(key: 'forest' | 'water' | 'foliage', target: number, pan: number, seconds: number, rate = 1): void {
    const voice = this.voices.get(key);
    if (!voice) return;
    if (voice.isPaused) voice.resume();
    else if (!voice.isPlaying) voice.play({ volume: 0 });
    const blend = 1 - Math.exp(-seconds / 1.5);
    voice.setVolume(voice.volume + (target - voice.volume) * blend);
    voice.setPan(voice.pan + (pan - voice.pan) * blend);
    voice.setRate(voice.rate + (rate - voice.rate) * blend);
  }

  private silence(): void {
    this.animals.silence();
    for (const [key, voice] of this.voices) {
      if (key === 'forest' || key === 'water' || key === 'foliage') {
        voice.setVolume(0);
        if (voice.isPlaying) voice.pause();
      } else voice.stop();
    }
  }

  destroy(): void {
    this.animals.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKey);
    this.button?.removeEventListener('click', this.toggleMute);
    for (const voice of this.voices.values()) voice.destroy();
    this.voices.clear();
  }
}
