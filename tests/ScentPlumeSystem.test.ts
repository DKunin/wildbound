import { describe, expect, it } from 'vitest';
import {
  ANIMAL_AWARENESS_SCENT_PROFILE,
  getScentIntermittency,
  getScentPlumeReading,
  getStableScentSourcePhase,
  PLAYER_SCENT_PROFILE,
} from '../src/game/systems/ScentPlumeSystem';

const listener = { x: 0, y: 0 };
const base = {
  listener,
  windX: 1,
  windY: 0,
  windStrength: 0.8,
  baseRange: 1_000,
  profile: PLAYER_SCENT_PROFILE,
};

describe('shared scent plume model', () => {
  it('carries scent much farther from an upwind source toward the listener', () => {
    const favorable = getScentPlumeReading({ ...base, source: { x: -1_200, y: 0 } });
    const adverse = getScentPlumeReading({ ...base, source: { x: 1_200, y: 0 } });

    expect(favorable.range).toBeGreaterThan(1_900);
    expect(favorable.strength).toBeGreaterThan(0.25);
    expect(adverse.range).toBeLessThan(500);
    expect(adverse.strength).toBe(0);
  });

  it('keeps calm-air scent weaker but broadly direction independent', () => {
    const calm = { ...base, windStrength: 0.01 };
    const east = getScentPlumeReading({ ...calm, source: { x: 600, y: 0 } });
    const west = getScentPlumeReading({ ...calm, source: { x: -600, y: 0 } });

    expect(Math.abs(east.range - west.range)).toBeLessThan(25);
    expect(Math.abs(east.strength - west.strength)).toBeLessThan(0.02);
  });

  it('supports the shorter profile used by prey awareness', () => {
    const reading = getScentPlumeReading({
      ...base,
      source: { x: -500, y: 0 },
      baseRange: 420,
      profile: ANIMAL_AWARENESS_SCENT_PROFILE,
    });

    expect(reading.range).toBeLessThan(700);
    expect(reading.strength).toBeGreaterThan(0);
  });

  it('gives distant scent a stable intermittent pulse without flickering nearby scent', () => {
    const phase = getStableScentSourcePhase('deer:17');

    expect(getStableScentSourcePhase('deer:17')).toBe(phase);
    expect(getScentIntermittency(4_000, phase, 0.4)).toBe(1);
    expect(getScentIntermittency(4_000, phase, 0.9)).toBeGreaterThanOrEqual(0.12);
    expect(getScentIntermittency(4_000, phase, 0.9)).toBeLessThanOrEqual(1);
    expect(getScentIntermittency(4_500, phase, 0.9)).not.toBe(getScentIntermittency(4_000, phase, 0.9));
  });
});
