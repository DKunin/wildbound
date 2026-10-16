import { describe, expect, it } from 'vitest';
import {
  getTerritoryMarkStrength,
  getTerritoryMarkColor,
  MAX_TERRITORY_MARKS,
  TERRITORY_MARK_COOLDOWN_MINUTES,
  TERRITORY_MARK_LIFETIME_MINUTES,
  TerritoryMarkSystem,
} from '../src/game/systems/TerritoryMarkSystem';

describe('territory marking', () => {
  it('enforces a cooldown and refreshes a nearby boundary mark', () => {
    const system = new TerritoryMarkSystem();
    expect(system.mark({ x: 100, y: 100 }, 0)).toMatchObject({ marked: true, refreshed: false, count: 1 });
    expect(system.mark({ x: 300, y: 100 }, 1)).toEqual({ marked: false, reason: 'cooldown', count: 1 });
    expect(system.mark({ x: 120, y: 110 }, TERRITORY_MARK_COOLDOWN_MINUTES))
      .toMatchObject({ marked: true, refreshed: true, count: 1 });
  });

  it('caps the active boundary and expires marks after one in-game day', () => {
    const system = new TerritoryMarkSystem();
    for (let index = 0; index < MAX_TERRITORY_MARKS + 2; index += 1) {
      system.mark({ x: index * 400, y: 100 }, index * TERRITORY_MARK_COOLDOWN_MINUTES);
    }
    expect(system.getActiveMarks(MAX_TERRITORY_MARKS * TERRITORY_MARK_COOLDOWN_MINUTES)).toHaveLength(MAX_TERRITORY_MARKS);
    expect(system.getActiveMarks(TERRITORY_MARK_LIFETIME_MINUTES + (MAX_TERRITORY_MARKS + 1) * TERRITORY_MARK_COOLDOWN_MINUTES))
      .toHaveLength(0);
  });

  it('fades territory scent with both age and distance', () => {
    expect(getTerritoryMarkStrength(0, 0)).toBe(1);
    expect(getTerritoryMarkStrength(720, 0)).toBeCloseTo(0.5);
    expect(getTerritoryMarkStrength(0, 750)).toBeCloseTo(0.5);
    expect(getTerritoryMarkStrength(TERRITORY_MARK_LIFETIME_MINUTES, 0)).toBe(0);
  });

  it('defaults the player to green and keeps separate colors for future wolves', () => {
    const system = new TerritoryMarkSystem();
    system.mark({ x: 100, y: 100 }, 0);
    system.mark({ x: 110, y: 105 }, 0, { id: 'rival-wolf', color: 0x8f7de8 });

    const marks = system.snapshot(0);
    expect(marks).toHaveLength(2);
    expect(getTerritoryMarkColor(marks[0])).toBe(0x78d98b);
    expect(getTerritoryMarkColor(marks[1])).toBe(0x8f7de8);
  });
});
