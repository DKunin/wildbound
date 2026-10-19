import { metersToWorldUnits } from './WorldScaleSystem';

export const SNEAK_ANIMATION_TIME_SCALE = 0.58;

// The player continuously crosses a one-kilometre territory, so its controls
// use compressed exploration tempo rather than literal day-long travel time.
// Sprint remains below Yellowstone's reported 45 mph short-distance top speed
// and is restricted to a brief endurance-limited burst.
export const WOLF_SNEAK_SPEED_METERS_PER_SECOND = 3;
export const WOLF_TRAVEL_SPEED_METERS_PER_SECOND = 10;
export const WOLF_SPRINT_SPEED_METERS_PER_SECOND = 18;

export const WOLF_SNEAK_SPEED = metersToWorldUnits(WOLF_SNEAK_SPEED_METERS_PER_SECOND);
export const WOLF_TRAVEL_SPEED = metersToWorldUnits(WOLF_TRAVEL_SPEED_METERS_PER_SECOND);
export const WOLF_SPRINT_SPEED = metersToWorldUnits(WOLF_SPRINT_SPEED_METERS_PER_SECOND);

export interface WolfMovementProfileInput {
  moving: boolean;
  running: boolean;
  sneaking: boolean;
}

export interface WolfMovementProfile {
  speed: number;
  visualSignature: number;
  soundSignature: number;
  scentSignature: number;
}

export const getWolfMovementProfile = (input: WolfMovementProfileInput): WolfMovementProfile => {
  if (input.sneaking) {
    return {
      speed: input.moving ? WOLF_SNEAK_SPEED : 0,
      visualSignature: 0.55,
      soundSignature: input.moving ? 0.12 : 0,
      scentSignature: 0.82,
    };
  }
  if (input.running) {
    return { speed: WOLF_SPRINT_SPEED, visualSignature: 1.18, soundSignature: 1, scentSignature: 1 };
  }
  if (input.moving) {
    return { speed: WOLF_TRAVEL_SPEED, visualSignature: 1, soundSignature: 0.5, scentSignature: 1 };
  }
  return { speed: 0, visualSignature: 0.82, soundSignature: 0, scentSignature: 1 };
};
