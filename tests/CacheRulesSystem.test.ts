import { describe, expect, it } from 'vitest';
import { applyScavengerLoss, selectProtectedCaches, validateCachePlacement } from '../src/game/systems/CacheRulesSystem';

describe('cache rules', () => {
  it('requires dry soft ground and separation from other caches', () => {
    expect(validateCachePlacement({ x: 0, y: 0 }, 'forest', false, false, [], 500)).toEqual({ allowed: true });
    expect(validateCachePlacement({ x: 0, y: 0 }, 'path', false, false, [], 500)).toEqual({ allowed: false, reason: 'blocked-ground' });
    expect(validateCachePlacement({ x: 100, y: 0 }, 'meadow', false, false, [{ x: 0, y: 0 }], 500))
      .toEqual({ allowed: false, reason: 'too-close' });
  });

  it('protects only the three caches nearest active marks', () => {
    const caches = [100, 200, 300, 400].map((x) => ({ x, y: 0 }));
    const protectedCaches = selectProtectedCaches(caches, [{ x: 0, y: 0 }], 3, 1_500);
    expect([...protectedCaches]).toEqual(caches.slice(0, 3));
    expect(applyScavengerLoss(65, 0.3)).toBeCloseTo(45.5);
  });
});
