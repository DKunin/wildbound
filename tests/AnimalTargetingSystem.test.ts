import { describe, expect, it } from 'vitest';
import {
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
});
