import { describe, expect, it } from 'vitest';
import { getAnimalScentSpecies } from '../src/game/systems/ScentSpeciesSystem';

describe('animal scent classification', () => {
  it('keeps producing carrion scent while a corpse remains edible', () => {
    expect(getAnimalScentSpecies('deer', true, true)).toBe('carcass');
    expect(getAnimalScentSpecies('rabbit', true, false)).toBeUndefined();
  });

  it('preserves species scent for living prey', () => {
    expect(getAnimalScentSpecies('deer', false, false)).toBe('deer');
    expect(getAnimalScentSpecies('rabbit', false, false)).toBe('rabbit');
  });
});
