import { describe, expect, it } from 'vitest';
import { getBoarDefense } from '../src/game/systems/BoarBehaviorSystem';

describe('boar defensive behavior', () => {
  it('flees from a rear attack when healthy and separated from a sounder', () => {
    const result = getBoarDefense({
      boar: { x: 100, y: 100 },
      attacker: { x: 20, y: 100 },
      boarFacing: 'east',
      healthFraction: 0.8,
      sounderSize: 1,
      survivalMode: true,
    });

    expect(result.charges).toBe(false);
    expect(result.damage).toBe(0);
  });

  it('counter-charges a close frontal attacker', () => {
    const result = getBoarDefense({
      boar: { x: 100, y: 100 },
      attacker: { x: 190, y: 100 },
      boarFacing: 'east',
      healthFraction: 0.8,
      sounderSize: 1,
      survivalMode: true,
    });

    expect(result).toMatchObject({ charges: true, chargeFacing: 'east', durationMs: 800 });
    expect(result.damage).toBeGreaterThan(0);
  });

  it('defends at close range when wounded or supported by a sounder', () => {
    const base = {
      boar: { x: 100, y: 100 },
      attacker: { x: 20, y: 100 },
      boarFacing: 'east' as const,
      survivalMode: true,
    };
    expect(getBoarDefense({ ...base, healthFraction: 0.6, sounderSize: 1 }).charges).toBe(true);
    expect(getBoarDefense({ ...base, healthFraction: 0.8, sounderSize: 4 }).charges).toBe(true);
  });

  it('keeps Explorer retaliation lighter than Survival retaliation', () => {
    const base = {
      boar: { x: 100, y: 100 },
      attacker: { x: 180, y: 100 },
      boarFacing: 'east' as const,
      healthFraction: 0.6,
      sounderSize: 3,
    };
    expect(getBoarDefense({ ...base, survivalMode: false }).damage)
      .toBeLessThan(getBoarDefense({ ...base, survivalMode: true }).damage);
  });
});
