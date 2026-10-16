import { describe, expect, it } from 'vitest';
import { BALANCE_PROFILES, DEFAULT_DIFFICULTY } from '../src/game/systems/BalanceConfig';

describe('balance profiles', () => {
  it('defaults to survival while retaining the original explorer economy', () => {
    expect(DEFAULT_DIFFICULTY).toBe('survival');
    expect(BALANCE_PROFILES.explorer.population.desired).toEqual({ rabbit: 20, deer: 22, elk: 10, boar: 8 });
    expect(BALANCE_PROFILES.explorer.meat).toEqual({ rabbit: 46, deer: 120, elk: 170, boar: 150 });
  });

  it('makes survival prey, meat, healing, and storage scarcer', () => {
    const survival = BALANCE_PROFILES.survival;
    expect(survival.population.desired).toEqual({ rabbit: 14, deer: 10, elk: 5, boar: 4 });
    expect(survival.meat.deer).toBeLessThan(82 / 0.72);
    expect(survival.meat.elk).toBeGreaterThan(survival.meat.deer);
    expect(survival.meat.boar).toBeGreaterThan(survival.meat.deer);
    expect(survival.player.healingPerSecond).toBeLessThan(BALANCE_PROFILES.explorer.player.healingPerSecond);
    expect(survival.cache.buriedLifetimeSeconds).toBeLessThan(BALANCE_PROFILES.explorer.cache.buriedLifetimeSeconds);
    expect(survival.cache.maximumProtected).toBe(3);
  });
});
