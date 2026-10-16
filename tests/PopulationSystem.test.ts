import { describe, expect, it } from 'vitest';
import { PopulationSystem } from '../src/game/systems/PopulationSystem';
import { BALANCE_PROFILES } from '../src/game/systems/BalanceConfig';

describe('PopulationSystem', () => {
  it('does not add animals while populations are healthy', () => {
    const system = new PopulationSystem();
    expect(system.update(0, { rabbit: 20, deer: 22, elk: 10, boar: 8 })).toEqual([]);
  });

  it('replenishes rabbits sooner than deer after a loss', () => {
    const system = new PopulationSystem();
    expect(system.update(0, { rabbit: 19, deer: 21, elk: 10, boar: 8 })).toEqual([]);
    expect(system.update(18_000, { rabbit: 19, deer: 21, elk: 10, boar: 8 })).toEqual(['rabbit']);
    expect(system.update(32_000, { rabbit: 20, deer: 21, elk: 10, boar: 8 })).toEqual(['deer']);
  });

  it('cancels a pending spawn when the desired population returns', () => {
    const system = new PopulationSystem();
    system.update(0, { rabbit: 19, deer: 22, elk: 10, boar: 8 });
    expect(system.update(20_000, { rabbit: 20, deer: 22, elk: 10, boar: 8 })).toEqual([]);
    expect(system.update(40_000, { rabbit: 20, deer: 22, elk: 10, boar: 8 })).toEqual([]);
  });

  it('holds survival migration until dawn or dusk and respects carcass biomass', () => {
    const system = new PopulationSystem(BALANCE_PROFILES.survival);
    const living = { rabbit: 13, deer: 9, elk: 4, boar: 3 };
    expect(system.update(0, living, { biomass: { rabbit: 14, deer: 10, elk: 5, boar: 4 }, migrationOpen: true })).toEqual([]);
    expect(system.update(1, living, { biomass: living, migrationOpen: true })).toEqual([]);
    expect(system.update(400_000, living, { biomass: living, migrationOpen: false })).toEqual([]);
    expect(system.update(420_001, living, { biomass: living, migrationOpen: true })).toEqual(['rabbit', 'deer', 'elk', 'boar']);
  });

  it('reduces the survival carrying capacity on lean days', () => {
    const system = new PopulationSystem(BALANCE_PROFILES.survival);
    expect(system.getDesired(true)).toEqual({ rabbit: 8, deer: 6, elk: 3, boar: 2 });
  });
});
