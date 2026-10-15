import { describe, expect, it } from 'vitest';
import { PopulationSystem } from '../src/game/systems/PopulationSystem';

describe('PopulationSystem', () => {
  it('does not add animals while populations are healthy', () => {
    const system = new PopulationSystem();
    expect(system.update(0, { rabbit: 20, deer: 22 })).toEqual([]);
  });

  it('replenishes rabbits sooner than deer after a loss', () => {
    const system = new PopulationSystem();
    expect(system.update(0, { rabbit: 19, deer: 21 })).toEqual([]);
    expect(system.update(18_000, { rabbit: 19, deer: 21 })).toEqual(['rabbit']);
    expect(system.update(32_000, { rabbit: 20, deer: 21 })).toEqual(['deer']);
  });

  it('cancels a pending spawn when the desired population returns', () => {
    const system = new PopulationSystem();
    system.update(0, { rabbit: 19, deer: 22 });
    expect(system.update(20_000, { rabbit: 20, deer: 22 })).toEqual([]);
    expect(system.update(40_000, { rabbit: 20, deer: 22 })).toEqual([]);
  });
});
