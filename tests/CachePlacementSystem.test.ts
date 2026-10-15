import { describe, expect, it } from 'vitest';
import { getCacheBurialPosition } from '../src/game/systems/CachePlacementSystem';

const bounds = { width: 8_192, height: 8_192, margin: 90 };

describe('cache burial placement', () => {
  it('places the cache beyond the wolf and mound silhouettes', () => {
    const position = getCacheBurialPosition({
      x: 3_200,
      y: 5_248,
      directionX: 1,
      directionY: 0,
      clearance: 165,
      bounds,
    });

    expect(position).toEqual({ x: 3_365, y: 5_248 });
    expect(Math.hypot(position.x - 3_200, position.y - 5_248)).toBeGreaterThanOrEqual(165);
  });

  it('uses the opposite side when the forward position is clipped by the territory edge', () => {
    const position = getCacheBurialPosition({
      x: 8_080,
      y: 4_000,
      directionX: 1,
      directionY: 0,
      clearance: 165,
      bounds,
    });

    expect(position.x).toBeLessThan(8_080);
    expect(Math.hypot(position.x - 8_080, position.y - 4_000)).toBeGreaterThanOrEqual(165);
  });
});
