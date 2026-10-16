import { describe, expect, it } from 'vitest';
import {
  AnimalTargetTracker,
  ANIMAL_TARGET_LOST_TIMEOUT_MS,
  findClickedAnimal,
  isAnimalTargetAlive,
  type AnimalTargetCandidate,
} from '../src/game/systems/AnimalTargetingSystem';

const animal = (
  species: AnimalTargetCandidate['species'],
  x: number,
  y: number,
  dead = false,
): AnimalTargetCandidate => ({ x, y, species, active: true, isDead: () => dead });

describe('animal click targeting', () => {
  it('selects the closest living animal under the pointer', () => {
    const rabbit = animal('rabbit', 110, 100);
    const deer = animal('deer', 125, 100);
    expect(findClickedAnimal({ x: 100, y: 100 }, [deer, rabbit])).toBe(rabbit);
  });

  it('ignores empty ground, carcasses, and inactive animals', () => {
    const carcass = animal('deer', 100, 100, true);
    const inactive = { ...animal('rabbit', 100, 100), active: false };
    expect(findClickedAnimal({ x: 100, y: 100 }, [carcass, inactive])).toBeUndefined();
    expect(findClickedAnimal({ x: 400, y: 400 }, [animal('deer', 100, 100)])).toBeUndefined();
  });

  it('stops tracking as soon as the selected animal dies', () => {
    let dead = false;
    const target = { ...animal('rabbit', 100, 100), isDead: () => dead };
    expect(isAnimalTargetAlive(target)).toBe(true);

    dead = true;
    expect(isAnimalTargetAlive(target)).toBe(false);
  });

  it('drops a mark only after the animal and its trail stay unavailable', () => {
    const tracker = new AnimalTargetTracker();

    expect(tracker.update(1_000, false)).toBe('searching');
    expect(tracker.update(1_000 + ANIMAL_TARGET_LOST_TIMEOUT_MS - 1, false)).toBe('searching');
    expect(tracker.update(1_000 + ANIMAL_TARGET_LOST_TIMEOUT_MS, false)).toBe('lost');
  });

  it('resets the loss timer when the wolf picks up the animal or trail again', () => {
    const tracker = new AnimalTargetTracker();

    expect(tracker.update(1_000, false)).toBe('searching');
    expect(tracker.update(5_000, true)).toBe('tracking');
    expect(tracker.update(12_000, false)).toBe('searching');
    expect(tracker.update(12_000 + ANIMAL_TARGET_LOST_TIMEOUT_MS - 1, false)).toBe('searching');
  });
});
