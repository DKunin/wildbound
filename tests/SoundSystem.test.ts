import { describe, expect, it } from 'vitest';
import { selectStrongestSound, type AmbientSoundArea, type TimedSound } from '../src/game/systems/SoundModel';

describe('hearing direction', () => {
  it('follows a moving source for the lifetime of its sound cue', () => {
    const runningAnimal = { x: 120, y: 40 };
    const event: TimedSound = { source: runningAnimal, label: 'DISTANT HOOVES', createdAt: 0, reach: 760 };
    expect(selectStrongestSound(100, { x: 0, y: 0 }, 1, [event], [])).toMatchObject({ x: 120, y: 40 });

    runningAnimal.x = 380;
    runningAnimal.y = -25;
    expect(selectStrongestSound(600, { x: 0, y: 0 }, 1, [event], [])).toMatchObject({ x: 380, y: -25 });
  });

  it('keeps flowing water audible without an expiry time and points to its nearest section', () => {
    const river: AmbientSoundArea = {
      x: 300,
      y: 100,
      width: 0,
      height: 500,
      label: 'FLOWING WATER',
      reach: 720,
      intensity: 0.68,
    };
    expect(selectStrongestSound(1_000_000, { x: 0, y: 360 }, 1, [], [river])).toMatchObject({
      x: 300,
      y: 360,
      label: 'FLOWING WATER',
    });
    expect(selectStrongestSound(1_000_000, { x: -500, y: 360 }, 1, [], [river])).toBeUndefined();
  });

  it('allows a nearby animal to stand out over river noise', () => {
    const deer: TimedSound = { source: { x: 35, y: 0 }, label: 'DISTANT HOOVES', createdAt: 100, reach: 760 };
    const river: AmbientSoundArea = { x: 260, y: -100, width: 0, height: 200, label: 'FLOWING WATER', reach: 720, intensity: 0.68 };
    expect(selectStrongestSound(150, { x: 0, y: 0 }, 1, [deer], [river])?.label).toBe('DISTANT HOOVES');
  });
});
