import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { ANIMAL_AUDIO_ASSETS, ANIMAL_AUDIO_PROFILES, AnimalAudioSystem, animalAudioMix, animalAudioUrl, type AnimalAudioSource } from '../src/game/systems/AnimalAudioSystem';

function setup(missing = false) {
  vi.stubGlobal('document', { hidden: false });
  const voices: Array<ReturnType<typeof voice>> = [];
  function voice() {
    return { isPlaying: false, volume: 0, pan: 0, rate: 1,
      play(config: { volume: number; pan: number; rate: number }) { Object.assign(this, config); this.isPlaying = true; return true; },
      setVolume(value: number) { this.volume = value; },
      setPan(value: number) { this.pan = value; },
      destroy: vi.fn(function (this: { isPlaying: boolean }) { this.isPlaying = false; }),
    };
  }
  const scene = { cache: { audio: { exists: () => !missing } }, sound: { add: () => { const v = voice(); voices.push(v); return v; } } };
  const system = new AnimalAudioSystem(scene as unknown as Phaser.Scene, () => .5);
  const source: AnimalAudioSource = { id: {}, species: 'wolf', x: 0, y: 0, speed: 100, state: 'walk', vocal: false };
  const tick = (count = 1, sources = [source], active = true) => {
    for (let i = 0; i < count; i++) system.update(100, { x: 0, y: 0 }, sources, active);
  };
  return { system, source, tick, voices };
}
afterEach(() => vi.unstubAllGlobals());
describe('animal spatial audio', () => {
  it('invalidates cached synthetic steps without changing the call URLs', () => {
    expect(animalAudioUrl('wolf-step-1')).toBe('assets/audio/animals/wolf-step-1.wav?v=recorded-1');
    expect(animalAudioUrl('wolf-call')).toBe('assets/audio/animals/wolf-call.wav');
  });
  it('attenuates with radial distance, pans horizontally, and stops at reach', () => {
    expect(animalAudioMix({ x: 0, y: 0 }, { x: 0, y: 0 }, 100).gain).toBe(1);
    expect(animalAudioMix({ x: 0, y: 0 }, { x: 50, y: 0 }, 100).gain).toBe(.25);
    expect(animalAudioMix({ x: 0, y: 0 }, { x: -50, y: 0 }, 100).pan).toBeLessThan(0);
    expect(animalAudioMix({ x: 0, y: 0 }, { x: 0, y: 100 }, 100).gain).toBe(0);
  });
  it('uses distinct species cadence, range and sample sets', () => {
    expect(new Set(Object.values(ANIMAL_AUDIO_PROFILES).map(p => p.stride)).size).toBe(5);
    expect(ANIMAL_AUDIO_PROFILES.elk.reach).toBeGreaterThan(ANIMAL_AUDIO_PROFILES.rabbit.reach);
    expect(ANIMAL_AUDIO_ASSETS).toHaveLength(20);
    for (const species of ['wolf', 'rabbit', 'deer', 'elk', 'boar'] as const) {
      const { system, source, tick } = setup();
      source.species = species;
      tick(10);
      expect(system.snapshot().last).toMatch(new RegExp(`^${species}-step-`));
    }
  });
  it('drives steps by distance travelled, not wall clock; varies consecutive impacts', () => {
    const { source, system, tick, voices } = setup();
    source.speed = 0; tick(30); expect(system.snapshot().played).toBe(0);
    source.speed = 100; tick(4);
    const first = system.snapshot().last;
    tick(4); expect(system.snapshot().last).not.toBe(first);
    expect(voices).toHaveLength(2);
  });
  it('accelerates cadence with real velocity and bounds long-frame catchup', () => {
    const slow = setup(); slow.tick(10);
    const fast = setup(); fast.source.speed = 240; fast.tick(10);
    expect(fast.system.snapshot().played).toBeGreaterThan(slow.system.snapshot().played);
    const before = fast.system.snapshot().played;
    fast.system.update(60_000, { x: 0, y: 0 }, [fast.source], true);
    expect(fast.system.snapshot().played - before).toBeLessThanOrEqual(1);
  });
  it('stops removed/dead sources and updates active shot panning', () => {
    const { source, system, tick, voices } = setup();
    tick(4); source.x = -50; tick();
    expect(voices[0].pan).toBeLessThan(0);
    source.state = 'dead'; tick();
    expect(system.snapshot().active).toBe(0);
    expect(voices[0].destroy).toHaveBeenCalledOnce();
  });
  it('has no out-of-range steps or stationary movement sounds', () => {
    const { source, system, tick } = setup();
    source.x = 2000; tick(50);
    expect(system.snapshot().played).toBe(0);
    expect(system.audition(source, 'call')).toBe(false);
  });
  it('silences on pause/hidden, blocks manual auditions, cleans up on destruction', () => {
    const { source, system, tick, voices } = setup();
    tick(4); tick(1, [source], false);
    expect(system.snapshot().active).toBe(0);
    expect(system.audition(source, 'call')).toBe(false);
    tick(4); vi.stubGlobal('document', { hidden: true }); tick();
    expect(system.snapshot().active).toBe(0);
    vi.stubGlobal('document', { hidden: false }); tick(4); system.destroy();
    expect(voices.every(v => v.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('isolates calls and steps and bounds overlapping voices', () => {
    const { source, system, tick } = setup();
    tick(); system.setLayerEnabled('steps', false); tick(10);
    expect(system.snapshot().played).toBe(0);
    expect(system.audition(source, 'call')).toBe(true);
    expect(system.audition(source, 'call')).toBe(true);
    expect(system.audition(source, 'call')).toBe(false);
    system.setLayerEnabled('calls', false);
    expect(system.snapshot().active).toBe(0);
    system.setLayerEnabled('steps', true);
    for (let i = 0; i < 30; i++) system.audition(source, 'step');
    expect(system.snapshot().active).toBe(16);
    expect(system.snapshot().voices.reduce((sum, voice) => sum + voice.volume, 0)).toBeLessThanOrEqual(.750001);
  });
  it('reclaims completed voices and handles unavailable audio', () => {
    const { system, tick, voices } = setup();
    tick(4); voices[0].isPlaying = false; tick();
    expect(system.snapshot().active).toBe(0);
    expect(voices[0].destroy).toHaveBeenCalledOnce();
    const missing = setup(true); missing.tick(100);
    expect(missing.system.snapshot().played).toBe(0);
  });
  it('lets the lab audition every step variation explicitly', () => {
    const { source, system, tick } = setup();
    source.speed = 0; tick();
    const variants = [];
    for (let i = 0; i < 3; i++) {
      expect(system.audition(source, 'step')).toBe(true);
      variants.push(system.snapshot().last);
    }
    expect(variants).toEqual(['wolf-step-1', 'wolf-step-2', 'wolf-step-3']);
  });
  it('gives rabbits alarm thumps, not routine idle calls, with cooldown', () => {
    const { source, system, tick } = setup();
    Object.assign(source, { species: 'rabbit', speed: 0, state: 'idle', vocal: true });
    tick(500); expect(system.snapshot().played).toBe(0);
    source.state = 'flee'; tick(); expect(system.snapshot().last).toBe('rabbit-call');
    source.state = 'idle'; tick(); source.state = 'flee'; tick();
    expect(system.snapshot().played).toBe(1);
  });
  it('schedules sparse idle calls but not automatic player howls', () => {
    const a = setup(); a.source.speed = 0; a.source.vocal = true; a.tick(300);
    expect(a.system.snapshot().last).toBe('wolf-call');
    const b = setup(); b.source.speed = 0; b.tick(500);
    expect(b.system.snapshot().played).toBe(0);
  });
  it('ships nonempty mono PCM samples with small silent edges and distinct steps', () => {
    const hashes = new Set<string>();
    for (const key of ANIMAL_AUDIO_ASSETS) {
      const bytes = readFileSync(`public/assets/audio/animals/${key}.wav`);
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.readUInt16LE(22)).toBe(1);
      const data = bytes.indexOf(Buffer.from('data'));
      const size = bytes.readUInt32LE(data + 4);
      expect(size).toBeGreaterThan(1000);
      let peak = 0;
      for (let i = data + 8; i < data + 8 + size; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
      expect(peak).toBeGreaterThan(100);
      expect(peak).toBeLessThan(32767);
      if (key.includes('step')) {
        expect(Math.abs(bytes.readInt16LE(data + 8))).toBeLessThan(100);
        expect(Math.abs(bytes.readInt16LE(data + 6 + size))).toBeLessThan(100);
        hashes.add(bytes.toString('base64'));
      }
    }
    expect(hashes.size).toBe(15);
  });
});
