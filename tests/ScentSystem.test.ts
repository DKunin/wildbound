import { describe, expect, it } from 'vitest';
import { getAnimalScentSpecies } from '../src/game/systems/ScentSpeciesSystem';
import { CACHED_MEAT_SCENT_RADIUS, getCachedMeatScentStrength } from '../src/game/systems/ScentDirectionSystem';

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

describe('cached meat scent', () => {
  it('remains detectable far beyond an ordinary scent trail', () => {
    expect(CACHED_MEAT_SCENT_RADIUS).toBeGreaterThan(2_000);
    expect(getCachedMeatScentStrength(1_500)).toBeGreaterThan(0);
    expect(getCachedMeatScentStrength(CACHED_MEAT_SCENT_RADIUS)).toBe(0);
    expect(getCachedMeatScentStrength(CACHED_MEAT_SCENT_RADIUS + 1)).toBe(0);
  });
});
