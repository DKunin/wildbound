import { describe, expect, it } from 'vitest';
import { WORLD_TILE_SIZE, WORLD_WIDTH } from '../src/game/systems/ProceduralWorld';
import {
  metersToWorldUnits,
  WORLD_TILE_METERS,
  WORLD_UNITS_PER_METER,
  WORLD_WIDTH_METERS,
  worldUnitsToMeters,
} from '../src/game/systems/WorldScaleSystem';
import {
  CARRION_SCENT_RANGE,
  CARRION_SCENT_RANGE_METERS,
  LIVE_ANIMAL_SCENT_RANGE,
  LIVE_ANIMAL_SCENT_RANGE_METERS,
} from '../src/game/systems/ScentRangeSystem';
import { PLAYER_SCENT_PROFILE } from '../src/game/systems/ScentPlumeSystem';
import {
  CACHED_MEAT_SCENT_RADIUS,
  CACHED_MEAT_SCENT_RADIUS_METERS,
  SCENT_RENDER_RADIUS,
  SCENT_TRAIL_RENDER_RADIUS_METERS,
} from '../src/game/systems/ScentDirectionSystem';

describe('world scale', () => {
  it('defines one metre as ten world units across the generated territory', () => {
    expect(WORLD_UNITS_PER_METER).toBe(10);
    expect(worldUnitsToMeters(WORLD_TILE_SIZE)).toBe(WORLD_TILE_METERS);
    expect(WORLD_TILE_METERS).toBe(25.6);
    expect(worldUnitsToMeters(WORLD_WIDTH)).toBe(WORLD_WIDTH_METERS);
    expect(WORLD_WIDTH_METERS).toBe(1_024);
    expect(metersToWorldUnits(274)).toBe(2_740);
  });

  it('states live-animal and carrion scent tiers in metres before conversion', () => {
    expect(LIVE_ANIMAL_SCENT_RANGE_METERS).toBe(115);
    expect(LIVE_ANIMAL_SCENT_RANGE).toBe(1_150);
    expect(CARRION_SCENT_RANGE_METERS).toBe(160);
    expect(CARRION_SCENT_RANGE).toBe(1_600);
    expect(SCENT_TRAIL_RENDER_RADIUS_METERS).toBe(72);
    expect(SCENT_RENDER_RADIUS).toBe(720);
    expect(CACHED_MEAT_SCENT_RADIUS_METERS).toBe(240);
    expect(CACHED_MEAT_SCENT_RADIUS).toBe(2_400);
    expect(worldUnitsToMeters(LIVE_ANIMAL_SCENT_RANGE * PLAYER_SCENT_PROFILE.favorableRangeMultiplier)).toBe(276);
    expect(worldUnitsToMeters(CARRION_SCENT_RANGE * 1.3 * PLAYER_SCENT_PROFILE.favorableRangeMultiplier)).toBeCloseTo(499.2);
  });
});
