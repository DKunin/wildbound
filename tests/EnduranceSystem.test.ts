import { describe, expect, it } from 'vitest';
import { EnduranceSystem } from '../src/game/systems/EnduranceSystem';

describe('EnduranceSystem', () => {
  it('builds recovery debt while sprinting and restores stamina more slowly after repeated exertion', () => {
    const fresh = new EnduranceSystem({ stamina: 40, recoveryDebt: 0 });
    const strained = new EnduranceSystem({ stamina: 40, recoveryDebt: 80 });

    const freshRecovery = fresh.update(1, 'idle');
    const strainedRecovery = strained.update(1, 'idle');

    expect(freshRecovery.stamina).toBeGreaterThan(strainedRecovery.stamina);
    expect(strainedRecovery.recoveryDebt).toBeGreaterThan(70);
  });

  it('clears accumulated strain much faster during a full rest', () => {
    const waiting = new EnduranceSystem({ stamina: 70, recoveryDebt: 72 });
    const resting = new EnduranceSystem({ stamina: 70, recoveryDebt: 72 });

    const waited = waiting.update(4, 'idle');
    const rested = resting.update(4, 'resting');

    expect(rested.stamina).toBeGreaterThan(waited.stamina);
    expect(rested.recoveryDebt).toBeLessThan(waited.recoveryDebt);
  });

  it('slows an exhausted sprinter without stopping all movement', () => {
    const endurance = new EnduranceSystem({ stamina: 0, recoveryDebt: 100 });
    expect(endurance.canSprint()).toBe(false);
    expect(endurance.getSprintSpeedFactor()).toBeCloseTo(0.34);
  });

  it('applies accumulated strain as a geometric speed reduction', () => {
    const profile = {
      minimumSprintSpeedFactor: 0.2,
      depletedSprintSpeedFactor: 0.8,
      strainSpeedRetentionPerPoint: 0.99,
    };
    const fresh = new EnduranceSystem({ stamina: 0, recoveryDebt: 0 }, profile);
    const strained = new EnduranceSystem({ stamina: 0, recoveryDebt: 25 }, profile);
    const heavilyStrained = new EnduranceSystem({ stamina: 0, recoveryDebt: 50 }, profile);

    const firstIntervalRatio = strained.getSprintSpeedFactor() / fresh.getSprintSpeedFactor();
    const secondIntervalRatio = heavilyStrained.getSprintSpeedFactor() / strained.getSprintSpeedFactor();
    expect(firstIntervalRatio).toBeCloseTo(secondIntervalRatio, 10);
  });

  it('supports species profiles without changing the wolf defaults', () => {
    const wolf = new EnduranceSystem();
    const deer = new EnduranceSystem({}, {
      sprintDrainPerSecond: 14,
      recoveryDebtPerSecond: 4.5,
      minimumSprintSpeedFactor: 0.68,
    });

    wolf.update(4, 'sprinting');
    deer.update(4, 'sprinting');

    expect(deer.snapshot().stamina).toBeGreaterThan(wolf.snapshot().stamina);
    expect(deer.snapshot().recoveryDebt).toBeLessThan(wolf.snapshot().recoveryDebt);
    deer.update(10, 'sprinting');
    expect(deer.getSprintSpeedFactor()).toBeCloseTo(0.68);
  });

  it('combines depleted stamina and recovery debt into exhaustion load', () => {
    const fresh = new EnduranceSystem();
    const strained = new EnduranceSystem({ stamina: 15, recoveryDebt: 75 });

    expect(fresh.getExhaustionLoad()).toBe(0);
    expect(strained.getExhaustionLoad()).toBeGreaterThan(0.75);
  });

  it('charges discrete exertion and can cap injured stamina', () => {
    const endurance = new EnduranceSystem();
    expect(endurance.canSpend(20)).toBe(true);
    expect(endurance.spend(20)).toMatchObject({ stamina: 80, recoveryDebt: 9 });
    expect(endurance.limitStamina(68).stamina).toBe(68);
    expect(endurance.canSpend(70)).toBe(false);
  });
});
