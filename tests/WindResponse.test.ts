import { describe, expect, it } from 'vitest';
import { windResponse, WindMotionClock } from '../src/game/systems/WindResponse';
import { getEnvironmentMotionSample } from '../src/game/systems/EnvironmentMotion';

describe('wind response shared by game and testground', () => {
  it('maps calm to silence and increases volume, speed, motion and gust frequency with power', () => {
    expect(windResponse(0).volume).toBe(0);
    expect(windResponse(0).gustVolume).toBe(0);
    for (let power = 0.1; power <= 1; power += 0.1) {
      const previous = windResponse(power - 0.1);
      const next = windResponse(power);
      expect(next.volume).toBeGreaterThan(previous.volume);
      expect(next.rate).toBeGreaterThan(previous.rate);
      expect(next.motionSpeed).toBeGreaterThan(previous.motionSpeed);
      expect(next.foliageVolume).toBeGreaterThan(previous.foliageVolume);
      expect(next.gustInterval).toBeLessThan(previous.gustInterval);
    }
    expect(windResponse(-5)).toEqual(windResponse(0));
    expect(windResponse(50)).toEqual(windResponse(1));
    expect(windResponse(NaN)).toEqual(windResponse(0));
  });

  it('integrates changing wind speed without jumping phase or catching up a hidden tab', () => {
    const clock = new WindMotionClock();
    clock.advance(100, 0.2);
    const before = clock.time;
    clock.advance(0, 1);
    expect(clock.time).toBe(before);
    clock.advance(100, 1);
    expect(clock.time - before).toBeCloseTo(100 * windResponse(1).motionSpeed);
    const visible = clock.time;
    clock.advance(100_000, 1);
    expect(clock.time - visible).toBeLessThanOrEqual(250 * windResponse(1).motionSpeed);
  });

  it('stops foliage in still air while leaving flowing-water motion independent', () => {
    const calm = getEnvironmentMotionSample('tree', 2000, 0, undefined, 0);
    expect(calm).toMatchObject({ angle: 0, scaleX: 1, scaleY: 1 });
    const strong = getEnvironmentMotionSample('tree', 2000, 0, undefined, 1);
    const light = getEnvironmentMotionSample('tree', 2000, 0, undefined, 0.2);
    expect(Math.abs(strong.angle)).toBeGreaterThan(Math.abs(light.angle));
    expect(getEnvironmentMotionSample('water-flow', 2000, 0, { x: 1, y: 0 }, 0))
      .toEqual(getEnvironmentMotionSample('water-flow', 2000, 0, { x: 1, y: 0 }, 1));
  });
});
