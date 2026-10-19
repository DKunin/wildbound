import { WORLD_HEIGHT, WORLD_TILE_SIZE, WORLD_WIDTH } from './ProceduralWorld';

/**
 * Spatial scale is intentionally separate from the accelerated survival clock.
 * Physics velocities are world units per real second; time-of-day is a gameplay
 * clock and must not be used to infer travel distance.
 */
export const WORLD_UNITS_PER_METER = 10;
export const METERS_PER_WORLD_UNIT = 1 / WORLD_UNITS_PER_METER;

export const metersToWorldUnits = (meters: number): number => meters * WORLD_UNITS_PER_METER;
export const worldUnitsToMeters = (worldUnits: number): number => worldUnits * METERS_PER_WORLD_UNIT;

export const WORLD_TILE_METERS = worldUnitsToMeters(WORLD_TILE_SIZE);
export const WORLD_WIDTH_METERS = worldUnitsToMeters(WORLD_WIDTH);
export const WORLD_HEIGHT_METERS = worldUnitsToMeters(WORLD_HEIGHT);
