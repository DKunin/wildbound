import type Phaser from 'phaser';
import type { SoundSource } from './SoundModel';

export const ANIMAL_SPECIES = ['wolf', 'rabbit', 'deer', 'elk', 'boar'] as const;
export type AudioSpecies = typeof ANIMAL_SPECIES[number];
export const ANIMAL_AUDIO_ASSETS = ANIMAL_SPECIES.flatMap(species =>
  [`${species}-call`, ...[1, 2, 3].map(index => `${species}-step-${index}`)]);
export const animalAudioUrl = (key: string): string =>
  `assets/audio/animals/${key}.wav${key.includes('-step-') ? '?v=recorded-1' : ''}`;
export interface AnimalAudioSource extends SoundSource {
  id: object;
  species: AudioSpecies;
  speed: number;
  state: string;
  /** Player wolves vocalize only on an explicit howl action. */
  vocal?: boolean;
}
export const ANIMAL_AUDIO_PROFILES = {
  wolf: { stride: 38, reach: 260, gain: .25, callReach: 1400, label: 'Soft paws / howl' },
  rabbit: { stride: 48, reach: 160, gain: .16, callReach: 260, label: 'Paired hops / alarm thump' },
  deer: { stride: 55, reach: 370, gain: .33, callReach: 1000, label: 'Light cloven hooves / bellow' },
  elk: { stride: 68, reach: 480, gain: .42, callReach: 1400, label: 'Heavy hooves / bugle' },
  boar: { stride: 40, reach: 320, gain: .32, callReach: 650, label: 'Heavy short steps / grunt' },
} as const;
export function animalAudioMix(listener: SoundSource, source: SoundSource, reach: number) {
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  return { gain: Math.max(0, 1 - distance / reach) ** 2, pan: Math.max(-.9, Math.min(.9, (source.x - listener.x) / (reach * .6))) };
}
type Voice = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
type Shot = { voice: Voice; source: AnimalAudioSource; kind: 'call' | 'step'; gain: number; reach: number; key: string };
type Track = { distance: number; wait: number; state: string; variant: number };

/** Bounded positional one-shots; never loops footsteps or schedules audio while suspended. */
export class AnimalAudioSystem {
  private readonly tracks = new Map<object, Track>();
  private shots: Shot[] = [];
  private enabled = false;
  private listener: SoundSource = { x: 0, y: 0 };
  private sources = new Map<object, AnimalAudioSource>();
  private readonly layers = { calls: true, steps: true };
  private played = 0;
  private last = '—';
  private auditionVariant = 0;
  constructor(private readonly scene: Phaser.Scene, private readonly random = Math.random) {}

  setLayerEnabled(layer: 'calls' | 'steps', enabled: boolean): void {
    this.layers[layer] = enabled;
    this.shots = this.shots.filter(shot => {
      if ((layer === 'calls' ? 'call' : 'step') !== shot.kind || enabled) return true;
      shot.voice.destroy(); return false;
    });
  }
  snapshot() {
    return { active: this.shots.length, played: this.played, last: this.last,
      voices: this.shots.map(shot => ({ key: shot.key, volume: shot.voice.volume, pan: shot.voice.pan, rate: shot.voice.rate })) };
  }
  audition(source: AnimalAudioSource, kind: 'call' | 'step'): boolean {
    if (kind === 'step') this.auditionVariant = this.auditionVariant % 3 + 1;
    return this.emit(source, kind, kind === 'step' ? this.auditionVariant : 1);
  }
  update(delta: number, listener: SoundSource, sources: readonly AnimalAudioSource[], active: boolean): void {
    this.enabled = active && !document.hidden;
    this.listener = listener;
    if (!this.enabled) { this.silence(); return; }
    const seconds = Math.min(.1, Math.max(0, delta / 1000));
    this.sources = new Map(sources.filter(source => source.state !== 'dead').map(source => [source.id, source]));
    this.shots = this.shots.filter(shot => {
      const source = this.sources.get(shot.source.id);
      if (!shot.voice.isPlaying || !source) { shot.voice.destroy(); return false; }
      const mix = animalAudioMix(listener, source, shot.reach);
      shot.voice.setVolume(shot.gain * mix.gain); shot.voice.setPan(mix.pan);
      return true;
    });
    for (const id of this.tracks.keys()) if (!this.sources.has(id)) this.tracks.delete(id);
    // Near-first priority and a fixed voice budget keep herds from flooding the mixer.
    for (const source of [...this.sources.values()].sort((a, b) =>
      Math.hypot(a.x - listener.x, a.y - listener.y) - Math.hypot(b.x - listener.x, b.y - listener.y))) {
      const profile = ANIMAL_AUDIO_PROFILES[source.species];
      let track = this.tracks.get(source.id);
      if (!track) {
        track = { distance: 0, wait: source.species === 'rabbit' ? 0 : 12 + this.random() * 28, state: source.state, variant: 0 };
        this.tracks.set(source.id, track);
      }
      const speed = Number.isFinite(source.speed) ? Math.max(0, source.speed) : 0;
      if (speed > 2 && animalAudioMix(listener, source, profile.reach).gain > 0) {
        track.distance += speed * seconds;
        if (track.distance >= profile.stride) {
          track.distance %= profile.stride; // No catch-up burst after a stall or teleport.
          track.variant = (track.variant + 1 + Math.floor(this.random() * 2)) % 3;
          this.emit(source, 'step', track.variant + 1);
        }
      } else track.distance = 0;
      track.wait -= seconds;
      const alert = source.state === 'flee' && track.state !== 'flee';
      if (source.vocal !== false && track.wait <= 0 &&
          (source.species === 'rabbit' ? alert : speed < 3)) {
        if (this.emit(source, 'call', 1)) track.wait = 30 + this.random() * 45;
      }
      track.state = source.state;
    }
    this.mixVoices();
  }
  private emit(source: AnimalAudioSource, kind: 'call' | 'step', variant: number): boolean {
    if (!this.enabled || document.hidden || source.state === 'dead' || !this.layers[kind === 'call' ? 'calls' : 'steps']) return false;
    if (this.shots.length >= 16 || (kind === 'call' && this.shots.filter(shot => shot.kind === 'call').length >= 2)) return false;
    const profile = ANIMAL_AUDIO_PROFILES[source.species];
    const reach = kind === 'call' ? profile.callReach : profile.reach;
    const mix = animalAudioMix(this.listener, source, reach);
    if (mix.gain <= 0) return false;
    const key = `${source.species}-${kind === 'call' ? 'call' : `step-${variant}`}`;
    if (!this.scene.cache.audio.exists(`animal-${key}`)) return false;
    const gain = kind === 'call' ? .42 : profile.gain * (source.speed > 160 ? 1.2 : 1);
    const voice = this.scene.sound.add(`animal-${key}`) as Voice;
    if (!voice.play({ volume: gain * mix.gain, pan: mix.pan, rate: .96 + this.random() * .08 })) { voice.destroy(); return false; }
    this.shots.push({ voice, source, kind, gain, reach, key });
    this.mixVoices();
    this.played++; this.last = key;
    return true;
  }
  private mixVoices(): void {
    const mixes = this.shots.map(shot => animalAudioMix(this.listener, this.sources.get(shot.source.id) ?? shot.source, shot.reach));
    const total = this.shots.reduce((sum, shot, index) => sum + shot.gain * mixes[index].gain, 0);
    // Reserve headroom for ambience and prevent a tightly packed herd multiplying volume.
    const scale = Math.min(1, .75 / Math.max(.75, total));
    this.shots.forEach((shot, index) => {
      shot.voice.setVolume(shot.gain * mixes[index].gain * scale);
      shot.voice.setPan(mixes[index].pan);
    });
  }
  silence(): void {
    this.enabled = false;
    for (const shot of this.shots) shot.voice.destroy();
    this.shots = []; this.tracks.clear(); this.sources.clear();
  }
  destroy(): void { this.silence(); }
}
