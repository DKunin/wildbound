import { describe, expect, it } from 'vitest';
import {
  AnimalAwarenessSystem,
  type AwarenessEnvironment,
  type AwarenessObserver,
  type AwarenessThreat,
} from '../src/game/systems/AnimalAwarenessSystem';

const system = new AnimalAwarenessSystem();
const observer: AwarenessObserver = {
  x: 0,
  y: 0,
  facingX: 1,
  facingY: 0,
  sightRange: 500,
  fieldOfViewDegrees: 240,
  hearingRange: 500,
  scentRange: 420,
};
const threat: AwarenessThreat = {
  x: 180,
  y: 0,
  visualSignature: 1,
  soundSignature: 0,
  scentSignature: 0,
};
const environment: AwarenessEnvironment = {
  visibility: 1,
  windX: 1,
  windY: 0,
  windStrength: 0.7,
  hasLineOfSight: () => true,
};

describe('animal awareness', () => {
  it('uses a forward vision cone and obstacle occlusion', () => {
    const visible = system.evaluate(observer, threat, environment);
    const behind = system.evaluate(observer, { ...threat, x: -180 }, environment);
    const occluded = system.evaluate(observer, threat, { ...environment, hasLineOfSight: () => false });

    expect(visible.sight).toBeGreaterThan(0.5);
    expect(behind.sight).toBe(0);
    expect(occluded.sight).toBe(0);
  });

  it('hears moving threats without requiring line of sight', () => {
    const running = system.evaluate(observer, {
      ...threat,
      visualSignature: 0,
      soundSignature: 1,
    }, { ...environment, hasLineOfSight: () => false });
    const silent = system.evaluate(observer, {
      ...threat,
      visualSignature: 0,
      soundSignature: 0,
    }, { ...environment, hasLineOfSight: () => false });

    expect(running.sound).toBeGreaterThan(0.6);
    expect(silent.sound).toBe(0);
  });

  it('carries scent farther downwind than upwind', () => {
    const scented = { ...threat, visualSignature: 0, scentSignature: 1 };
    const downwind = system.evaluate(observer, { ...scented, x: -180 }, environment);
    const upwind = system.evaluate(observer, scented, environment);

    expect(downwind.scent).toBeGreaterThan(upwind.scent);
  });

  it('makes an against-wind approach substantially harder to smell', () => {
    const scented = { ...threat, visualSignature: 0, scentSignature: 1 };
    const strongWind = { ...environment, windStrength: 0.9 };
    const approachingAgainstWind = system.evaluate(observer, { ...scented, x: 180 }, strongWind);
    const approachingWithWind = system.evaluate(observer, { ...scented, x: -180 }, strongWind);

    expect(approachingAgainstWind.scent).toBeLessThan(0.08);
    expect(approachingWithWind.scent).toBeGreaterThan(approachingAgainstWind.scent * 8);
  });

  it('keeps scent comparatively even when the air is nearly calm', () => {
    const scented = { ...threat, visualSignature: 0, scentSignature: 1 };
    const calm = { ...environment, windStrength: 0.02 };
    const east = system.evaluate(observer, scented, calm);
    const west = system.evaluate(observer, { ...scented, x: -180 }, calm);

    expect(Math.abs(east.scent - west.scent)).toBeLessThan(0.03);
  });

  it('makes a sneaking wolf harder to combine across senses', () => {
    const walking = system.evaluate(observer, {
      ...threat,
      visualSignature: 1,
      soundSignature: 0.5,
      scentSignature: 1,
    }, environment);
    const sneaking = system.evaluate(observer, {
      ...threat,
      visualSignature: 0.55,
      soundSignature: 0.12,
      scentSignature: 0.82,
    }, environment);

    expect(sneaking.level).toBeLessThan(walking.level);
    expect(sneaking.scent).toBeGreaterThan(0);
  });
});
