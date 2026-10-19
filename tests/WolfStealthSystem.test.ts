import { describe, expect, it } from 'vitest';
import {
  getWolfMovementProfile,
  WOLF_SNEAK_SPEED,
  WOLF_SNEAK_SPEED_METERS_PER_SECOND,
  WOLF_SPRINT_SPEED,
  WOLF_SPRINT_SPEED_METERS_PER_SECOND,
  WOLF_TRAVEL_SPEED,
  WOLF_TRAVEL_SPEED_METERS_PER_SECOND,
} from '../src/game/systems/WolfStealthSystem';

describe('wolf stealth profile', () => {
  it('moves more slowly and produces less sight and sound while sneaking', () => {
    const walking = getWolfMovementProfile({ moving: true, running: false, sneaking: false });
    const sneaking = getWolfMovementProfile({ moving: true, running: false, sneaking: true });

    expect(sneaking.speed).toBeLessThan(walking.speed);
    expect(sneaking.visualSignature).toBeLessThan(walking.visualSignature);
    expect(sneaking.soundSignature).toBeLessThan(walking.soundSignature);
  });

  it('does not erase scent and cannot inherit running speed', () => {
    const running = getWolfMovementProfile({ moving: true, running: true, sneaking: false });
    const sneakingWithRunRequested = getWolfMovementProfile({ moving: true, running: true, sneaking: true });

    expect(sneakingWithRunRequested.speed).toBe(WOLF_SNEAK_SPEED);
    expect(sneakingWithRunRequested.speed).toBeLessThan(running.speed);
    expect(sneakingWithRunRequested.scentSignature).toBeGreaterThan(0.75);
  });

  it('uses metre-calibrated gaits instead of opaque world-unit speeds', () => {
    expect(WOLF_SNEAK_SPEED_METERS_PER_SECOND).toBe(1.2);
    expect(WOLF_TRAVEL_SPEED_METERS_PER_SECOND).toBe(2.25);
    expect(WOLF_SPRINT_SPEED_METERS_PER_SECOND).toBe(14);
    expect(WOLF_SNEAK_SPEED).toBe(12);
    expect(WOLF_TRAVEL_SPEED).toBe(22.5);
    expect(WOLF_SPRINT_SPEED).toBe(140);
  });
});
