import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { FOREST_AUDIO_ASSETS, ForestAudioSystem, treeAudioMix, waterAudioMix } from '../src/game/systems/ForestAudioSystem';

const river = { x: 0, y: 0, width: 100, height: 1000 };
const listener = { x: 50, y: 300 };

function setup(missing = false, treePoints: Array<{ x: number; y: number }> = [], controls = true) {
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const button = Object.assign(new EventTarget(), { setAttribute: vi.fn(), textContent: '' });
  const doc = Object.assign(documentEvents, { hidden: false, querySelector: () => button });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const voices = new Map<string, ReturnType<typeof makeVoice>>();
  function makeVoice() {
    return {
      volume: 0, pan: 0, rate: 1, isPlaying: false, isPaused: false,
      play: vi.fn(function (this: { isPlaying: boolean; isPaused: boolean }) { this.isPlaying = true; this.isPaused = false; return true; }),
      pause: vi.fn(function (this: { isPlaying: boolean; isPaused: boolean }) { this.isPlaying = false; this.isPaused = true; }),
      resume: vi.fn(function (this: { isPlaying: boolean; isPaused: boolean }) { this.isPlaying = true; this.isPaused = false; }),
      stop: vi.fn(function (this: { isPlaying: boolean }) { this.isPlaying = false; }),
      setVolume: vi.fn(function (this: { volume: number }, value: number) { this.volume = value; }),
      setPan: vi.fn(function (this: { pan: number }, value: number) { this.pan = value; }),
      setRate: vi.fn(function (this: { rate: number }, value: number) { this.rate = value; }),
      destroy: vi.fn(),
    };
  }
  const scene = {
    cache: { audio: { exists: () => !missing } },
    sound: { add: (key: string) => { const voice = makeVoice(); voices.set(key, voice); return voice; } },
  } as unknown as Phaser.Scene;
  const system = new ForestAudioSystem(scene, [river], () => 0.5, { trees: () => treePoints, controls });
  const advance = (seconds: number, night = false, active = true, position = listener, wind = 0.5) => {
    for (let i = 0; i < seconds * 10; i++) system.update(100, position, wind, night, active);
  };
  return { system, advance, voices, doc, button };
}

afterEach(() => vi.unstubAllGlobals());

describe('forest audio', () => {
  it('ships non-silent PCM clips with click-free loop boundaries and bounded download size', () => {
    let totalBytes = 0;
    for (const key of FOREST_AUDIO_ASSETS) {
      const wav = readFileSync(new URL(`../public/assets/audio/${key}.wav`, import.meta.url));
      totalBytes += wav.length;
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      let samples: Buffer | undefined;
      for (let offset = 12; offset + 8 <= wav.length;) {
        const kind = wav.toString('ascii', offset, offset + 4);
        const length = wav.readUInt32LE(offset + 4);
        if (kind === 'fmt ') {
          expect(wav.readUInt16LE(offset + 8)).toBe(1); // PCM
          expect(wav.readUInt16LE(offset + 10)).toBe(1); // mono
          expect(wav.readUInt32LE(offset + 12)).toBe(22050);
        }
        if (kind === 'data') samples = wav.subarray(offset + 8, offset + 8 + length);
        offset += 8 + length + length % 2;
      }
      expect(samples).toBeDefined();
      let energy = 0;
      for (let offset = 0; offset < samples!.length; offset += 2) energy += (samples!.readInt16LE(offset) / 32768) ** 2;
      expect(Math.sqrt(energy / (samples!.length / 2))).toBeGreaterThan(0.005);
      expect(Math.abs(samples!.readInt16LE(0) - samples!.readInt16LE(samples!.length - 2)) / 32768).toBeLessThan(0.002);
      if (key === 'forest' || key === 'water' || key === 'foliage') expect(samples!.length / 2 / 22050).toBe(24);
    }
    expect(totalBytes).toBeLessThan(4_500_000);
  });

  it('only hears nearby trees, points toward them, and does not amplify duplicated trunks', () => {
    const tree = { x: 100, y: 300 };
    expect(treeAudioMix(listener, [])).toEqual({ proximity: 0, pan: 0 });
    expect(treeAudioMix({ x: -300, y: 300 }, [tree]).proximity).toBe(0);
    expect(treeAudioMix(tree, [tree]).proximity).toBe(1);
    expect(treeAudioMix(listener, [tree]).pan).toBeGreaterThan(0);
    expect(treeAudioMix({ x: 200, y: 300 }, [tree]).pan).toBeLessThan(0);
    expect(treeAudioMix(listener, [tree, tree])).toEqual(treeAudioMix(listener, [tree]));
  });

  it('changes wind volume and speed live, silences calm wind, and fades leaves with distance', () => {
    const { system, advance, voices } = setup(false, [listener]);
    const wind = voices.get('nature-forest')!;
    const foliage = voices.get('nature-foliage')!;
    advance(20, false, true, listener, 0.1);
    const soft = { volume: wind.volume, rate: wind.rate, leaves: foliage.volume };
    advance(20, false, true, listener, 1);
    expect(wind.volume).toBeGreaterThan(soft.volume);
    expect(wind.rate).toBeGreaterThan(soft.rate);
    expect(foliage.volume).toBeGreaterThan(soft.leaves);
    advance(20, false, true, { x: 900, y: 300 }, 0);
    expect(wind.volume).toBeLessThan(0.00001);
    expect(foliage.volume).toBeLessThan(0.00001);
    expect(wind.play).toHaveBeenCalledTimes(1);
    system.destroy();
  });

  it('isolates testground layers without touching saved gameplay mute', () => {
    const { system, advance, voices, button } = setup(false, [listener], false);
    system.setLayerEnabled('wind', false);
    system.setLayerEnabled('birds', false);
    system.setLayerEnabled('water', false);
    advance(60);
    expect(voices.get('nature-foliage')!.volume).toBeGreaterThan(0);
    expect(voices.get('nature-forest')!.volume).toBe(0);
    expect(voices.get('nature-water')!.volume).toBe(0);
    expect(voices.get('nature-gust')!.play).not.toHaveBeenCalled();
    expect(voices.get('nature-bird-1')!.play).not.toHaveBeenCalled();
    button.dispatchEvent(new Event('click'));
    expect(localStorage.setItem).not.toHaveBeenCalled();
    system.destroy();
  });

  it('fades out beyond 720 units, points toward the bank, and never stacks overlapping tiles', () => {
    expect(waterAudioMix(listener, [river]).volume).toBeCloseTo(0.46);
    expect(waterAudioMix(listener, [river, river])).toEqual(waterAudioMix(listener, [river]));
    expect(waterAudioMix({ x: 820, y: 300 }, [river]).volume).toBe(0);
    expect(waterAudioMix({ x: 400, y: 300 }, [river]).pan).toBeLessThan(0);
    expect(waterAudioMix({ x: -300, y: 300 }, [river]).pan).toBeGreaterThan(0);
    expect(waterAudioMix(listener, [])).toEqual({ volume: 0, pan: 0 });
  });

  it('smoothly fades water in and out while keeping a single looping voice', () => {
    const { system, advance, voices } = setup();
    const water = voices.get('nature-water')!;
    advance(0.1);
    expect(water.volume).toBeGreaterThan(0);
    expect(water.volume).toBeLessThan(0.05);
    advance(20);
    expect(water.volume).toBeCloseTo(0.46, 4);
    advance(20, false, true, { x: 5000, y: 5000 });
    expect(water.volume).toBeLessThan(0.00001);
    expect(water.play).toHaveBeenCalledTimes(1);
    system.destroy();
  });

  it('varies bird phrases, schedules gusts, and silences birds at night', () => {
    const { system, advance, voices } = setup();
    advance(60);
    const birds = [1, 2, 3].map(index => voices.get(`nature-bird-${index}`)!);
    expect(birds.filter(voice => voice.play.mock.calls.length > 0).length).toBe(3);
    expect(voices.get('nature-gust')!.play).toHaveBeenCalled();
    const counts = birds.map(voice => voice.play.mock.calls.length);
    advance(60, true);
    expect(birds.map(voice => voice.play.mock.calls.length)).toEqual(counts);
    expect(birds.every(voice => !voice.isPlaying)).toBe(true);
    system.destroy();
  });

  it('pauses during gameplay interruptions and immediately on tab hide, then resumes without duplicate loops', () => {
    const { system, advance, voices, doc } = setup();
    advance(5);
    advance(1, false, false);
    expect([...voices.values()].every(voice => !voice.isPlaying)).toBe(true);
    advance(1);
    expect(voices.get('nature-forest')!.resume).toHaveBeenCalledTimes(1);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect([...voices.values()].every(voice => !voice.isPlaying)).toBe(true);
    advance(20);
    expect(voices.get('nature-forest')!.play).toHaveBeenCalledTimes(1);
    doc.hidden = false;
    advance(1);
    expect(voices.get('nature-forest')!.resume).toHaveBeenCalledTimes(2);
    system.destroy();
  });

  it('persists mute, updates its control, and removes listeners and voices on shutdown', () => {
    const { system, advance, voices, button } = setup();
    advance(5);
    button.dispatchEvent(new Event('click'));
    advance(30);
    expect([...voices.values()].every(voice => !voice.isPlaying)).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith('wildbound:audio-muted', 'true');
    expect(button.textContent).toContain('OFF');
    system.destroy();
    for (const voice of voices.values()) expect(voice.destroy).toHaveBeenCalledTimes(1);
    button.dispatchEvent(new Event('click'));
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('continues safely if assets are unavailable', () => {
    const { system, advance, voices } = setup(true);
    expect(() => advance(60)).not.toThrow();
    expect(voices.size).toBe(0);
    system.destroy();
  });

  it('uses all shipped channels', () => {
    const { system, voices } = setup();
    expect(voices.size).toBe(FOREST_AUDIO_ASSETS.length);
    system.destroy();
  });
});
