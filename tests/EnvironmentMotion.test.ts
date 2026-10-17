import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_MOTION_BUCKET_SIZE,
  ENVIRONMENT_MOTION_RADIUS,
  getEnvironmentMotionBucketKey,
  getEnvironmentMotionSample,
  getNearbyEnvironmentMotionBucketKeys,
  isEnvironmentMotionNearby,
} from '../src/game/systems/EnvironmentMotion';

describe('environment motion', () => {
  it('limits animation eligibility to the player vicinity', () => {
    const player = { x: 2_000, y: 3_000 };
    expect(isEnvironmentMotionNearby({ x: player.x + ENVIRONMENT_MOTION_RADIUS, y: player.y }, player)).toBe(true);
    expect(isEnvironmentMotionNearby({ x: player.x + ENVIRONMENT_MOTION_RADIUS + 1, y: player.y }, player)).toBe(false);
  });

  it('looks up only spatial buckets around the player', () => {
    const player = { x: 2_000, y: 3_000 };
    const keys = getNearbyEnvironmentMotionBucketKeys(player);
    expect(keys).toContain(getEnvironmentMotionBucketKey(player));
    expect(keys.length).toBe((Math.ceil(ENVIRONMENT_MOTION_RADIUS / ENVIRONMENT_MOTION_BUCKET_SIZE) * 2 + 1) ** 2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps foliage motion subtle and water flow directional', () => {
    for (const kind of ['tree', 'bush'] as const) {
      const sample = getEnvironmentMotionSample(kind, 4_200, 1.3);
      expect(Math.abs(sample.angle)).toBeLessThan(0.25);
      expect(Math.abs(sample.scaleX - 1)).toBeLessThan(0.004);
      expect(Math.abs(sample.scaleY - 1)).toBeLessThan(0.004);
    }

    const flow = getEnvironmentMotionSample('water-flow', 4_200, 0.8, { x: 1, y: 0 });
    expect(Math.abs(flow.y)).toBe(0);
    expect(Math.abs(flow.x)).toBeLessThanOrEqual(10);
    expect(flow.alpha).toBeGreaterThanOrEqual(0.4);
    expect(flow.alpha).toBeLessThanOrEqual(1.2);
  });
});
