import type { GroundKind } from './ProceduralWorld';

export interface CachePoint {
  x: number;
  y: number;
}

export type CachePlacementFailure = 'blocked-ground' | 'too-close';

export const isDrySoftGround = (ground: GroundKind | undefined, blocked: boolean, water: boolean): boolean => (
  !blocked && !water && (ground === 'forest' || ground === 'meadow' || ground === 'flowers')
);

export const validateCachePlacement = (
  candidate: CachePoint,
  ground: GroundKind | undefined,
  blocked: boolean,
  water: boolean,
  existingCaches: readonly CachePoint[],
  minimumSpacing: number,
): { allowed: true } | { allowed: false; reason: CachePlacementFailure } => {
  if (!isDrySoftGround(ground, blocked, water)) return { allowed: false, reason: 'blocked-ground' };
  if (existingCaches.some((cache) => Math.hypot(cache.x - candidate.x, cache.y - candidate.y) < minimumSpacing)) {
    return { allowed: false, reason: 'too-close' };
  }
  return { allowed: true };
};

export const selectProtectedCaches = <T extends CachePoint>(
  caches: readonly T[],
  marks: readonly CachePoint[],
  maximumProtected: number,
  protectionRadius: number,
): Set<T> => {
  const candidates = caches
    .map((cache) => ({
      cache,
      distance: marks.reduce((nearest, mark) => Math.min(nearest, Math.hypot(cache.x - mark.x, cache.y - mark.y)), Number.POSITIVE_INFINITY),
    }))
    .filter((candidate) => candidate.distance <= protectionRadius)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, maximumProtected);
  return new Set(candidates.map((candidate) => candidate.cache));
};

export const applyScavengerLoss = (meat: number, lossFraction: number): number => (
  Math.max(0, meat * (1 - Math.max(0, Math.min(1, lossFraction))))
);
