import { describe, expect, it } from 'vitest';
import {
  getScentParticleAppearance,
  getScentParticlePosition,
  getStablePulse,
  getStableScentPhase,
  SCENT_DRIFT_DISTANCE,
  SCENT_WOBBLE_DISTANCE,
} from '../src/game/systems/ScentMotionSystem';

const positionFor = (
  mark: { x: number; y: number; createdAt: number; salt: number },
  timeMs: number,
  ageProgress = 0.4,
) => getScentParticlePosition({
  x: mark.x,
  y: mark.y,
  windX: 0.8,
  windY: 0.6,
  ageProgress,
  timeMs,
  phase: getStableScentPhase(mark.x, mark.y, mark.createdAt, mark.salt),
});

describe('scent particle motion', () => {
  it('keeps weak trails readable without overpowering fresh or marked scent', () => {
    const weak = getScentParticleAppearance(0.05, false);
    const fresh = getScentParticleAppearance(1, false);
    const marked = getScentParticleAppearance(1, true);

    expect(weak.fillAlpha).toBe(0.16);
    expect(weak.radius).toBeGreaterThan(4.5);
    expect(fresh.fillAlpha).toBeLessThanOrEqual(0.68);
    expect(fresh.radius).toBeLessThanOrEqual(9.5);
    expect(marked.fillAlpha).toBeGreaterThan(fresh.fillAlpha);
    expect(marked.ringAlpha).toBeLessThanOrEqual(0.38);
  });

  it('keeps a surviving mark in place when an older mark is pruned', () => {
    const marks = [
      { x: 120, y: 220, createdAt: 1_000, salt: 4 },
      { x: 280, y: 310, createdAt: 1_580, salt: 4 },
    ];
    const beforePruning = positionFor(marks[1], 9_000);
    marks.shift();

    expect(positionFor(marks[0], 9_000)).toEqual(beforePruning);
  });

  it('moves by a bounded distance between adjacent rendered frames', () => {
    const mark = { x: 400, y: 700, createdAt: 2_320, salt: 6 };
    const before = positionFor(mark, 8_000, 0.35);
    const after = positionFor(mark, 8_016, 0.35 + 16 / 60_000);

    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.3);
  });

  it('keeps oscillation perpendicular to the wind and within its configured radius', () => {
    const phase = getStableScentPhase(50, 70, 2_000, 4);
    for (let timeMs = 0; timeMs <= 10_000; timeMs += 100) {
      const position = getScentParticlePosition({
        x: 50,
        y: 70,
        windX: 1,
        windY: 0,
        ageProgress: 0,
        timeMs,
        phase,
      });
      expect(Math.abs(position.y - 70)).toBeLessThanOrEqual(SCENT_WOBBLE_DISTANCE + 0.000_001);
      expect(position.x).toBe(50);
    }
  });

  it('adds stable monotonic drift without changing the oscillation offset', () => {
    const input = {
      x: 25,
      y: 35,
      windX: 0.6,
      windY: 0.8,
      timeMs: 4_200,
      phase: getStableScentPhase(25, 35, 900, 3),
    };
    const younger = getScentParticlePosition({ ...input, ageProgress: 0.2 });
    const older = getScentParticlePosition({ ...input, ageProgress: 0.7 });
    const drift = SCENT_DRIFT_DISTANCE * 0.5;

    expect(older.x - younger.x).toBeCloseTo(input.windX * drift, 10);
    expect(older.y - younger.y).toBeCloseTo(input.windY * drift, 10);
  });

  it('gives territory and cache pulses stable phases independent of list order', () => {
    const phase = getStableScentPhase(600, 900, 4_500, 11);
    const beforePruning = getStablePulse(12_000, phase, 520, 1, 0.06);
    expect(getStablePulse(12_000, phase, 520, 1, 0.06)).toBe(beforePruning);
    expect(beforePruning).toBeGreaterThanOrEqual(0.94);
    expect(beforePruning).toBeLessThanOrEqual(1.06);
  });
});
