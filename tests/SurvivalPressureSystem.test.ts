import { describe, expect, it } from 'vitest';
import {
  getDayNumber,
  isLeanDay,
  isMigrationWindow,
  RegionalHuntPressureSystem,
} from '../src/game/systems/SurvivalPressureSystem';

describe('survival pressure', () => {
  it('makes every third day lean and migration limited to dawn and dusk', () => {
    expect(getDayNumber(0)).toBe(1);
    expect(isLeanDay(2 * 1_440)).toBe(true);
    expect(isLeanDay(3 * 1_440)).toBe(false);
    expect(isMigrationWindow(5 * 60 + 20)).toBe(true);
    expect(isMigrationWindow(18 * 60 + 20)).toBe(true);
    expect(isMigrationWindow(12 * 60)).toBe(false);
  });

  it('marks a region overhunted after two recent kills and lets pressure expire', () => {
    const pressure = new RegionalHuntPressureSystem();
    pressure.record({ species: 'deer', x: 1_000, y: 1_000, simulationMinutes: 100 });
    expect(pressure.isOverhunted({ x: 1_100, y: 1_000 }, 101)).toBe(false);
    pressure.record({ species: 'rabbit', x: 1_300, y: 1_000, simulationMinutes: 110 });
    expect(pressure.isOverhunted({ x: 1_100, y: 1_000 }, 111)).toBe(true);
    expect(pressure.isOverhunted({ x: 1_100, y: 1_000 }, 110 + 2 * 1_440 + 1)).toBe(false);
  });
});
