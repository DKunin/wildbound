import { describe, expect, it } from 'vitest';
import {
  getDeerRetaliation,
  getInjuryMobilityFactor,
  getInjuryStaminaCapacity,
  isRetaliationActive,
  getWoundLevel,
  getWoundStage,
  getWoundTextureSuffix,
  WOUND_LEVELS,
} from '../src/game/systems/HuntBalanceSystem';

describe('hunt balance', () => {
  it('makes a rear ambush safe but turns a frontal attack into a deterministic kick', () => {
    const deer = { x: 100, y: 100 };
    expect(getDeerRetaliation({ deer, attacker: { x: 0, y: 100 }, deerFacing: 'east' }))
      .toMatchObject({ safeRearAttack: true, damage: 0 });
    expect(getDeerRetaliation({ deer, attacker: { x: 200, y: 100 }, deerFacing: 'east' }))
      .toEqual({ safeRearAttack: false, damage: 20, kickFacing: 'west' });
  });

  it('selects the matching diagonal retaliation artwork', () => {
    const deer = { x: 100, y: 100 };
    expect(getDeerRetaliation({ deer, attacker: { x: 200, y: 200 }, deerFacing: 'southeast' }))
      .toEqual({ safeRearAttack: false, damage: 20, kickFacing: 'northwest' });
  });

  it('keeps the deer protected for the full kick, beyond the player attack cooldown', () => {
    const startedAt = 10_000;
    const retaliationUntil = startedAt + 900;
    expect(isRetaliationActive(startedAt + 620, retaliationUntil)).toBe(true);
    expect(isRetaliationActive(startedAt + 899, retaliationUntil)).toBe(true);
    expect(isRetaliationActive(startedAt + 900, retaliationUntil)).toBe(false);
  });

  it('reduces speed and stamina capacity as wounds deepen', () => {
    expect(getInjuryMobilityFactor(100)).toBe(1);
    expect(getInjuryMobilityFactor(50)).toBeLessThan(1);
    expect(getInjuryMobilityFactor(20)).toBeLessThan(getInjuryMobilityFactor(50));
    expect(getInjuryStaminaCapacity(20)).toBe(68);
  });

  it('maps healthy, wounded, badly wounded, and critical animals to visible wound stages', () => {
    expect([100, 85, 84, 60, 59, 30, 29, 1].map(getWoundStage)).toEqual([-1, -1, 0, 0, 1, 1, 2, 2]);
  });

  it('maps health to stable healthy, light, moderate, and severe sprite tiers', () => {
    expect([100, 85, 84, 60, 59, 30, 29, 0].map(getWoundLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(WOUND_LEVELS.map(getWoundTextureSuffix)).toEqual(['', '-wound-1', '-wound-2', '-wound-3']);
  });
});
