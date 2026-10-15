import { describe, expect, it } from 'vitest';
import { getObstacleCollisionGeometry, OBSTACLE_ATLAS_FRAME_SIZE } from '../src/game/systems/ObstacleCollision';
import type { ObstacleKind } from '../src/game/systems/ProceduralWorld';

const kinds: ObstacleKind[] = ['pine', 'birch', 'boulder', 'rockFormation', 'fallenLog', 'cliff'];

describe('obstacle collision footprints', () => {
  it('keeps every footprint inside its rendered sprite frame', () => {
    for (const kind of kinds) {
      const scale = 1.17;
      const geometry = getObstacleCollisionGeometry(kind, scale);
      const displaySize = OBSTACLE_ATLAS_FRAME_SIZE * scale;
      expect(geometry.offsetX).toBeGreaterThanOrEqual(0);
      expect(geometry.offsetY).toBeGreaterThanOrEqual(0);
      expect(geometry.offsetX + geometry.width).toBeLessThanOrEqual(displaySize);
      expect(geometry.offsetY + geometry.height).toBeLessThanOrEqual(displaySize);
    }
  });

  it('scales the size and offset with the rendered object', () => {
    const small = getObstacleCollisionGeometry('fallenLog', 0.75);
    const large = getObstacleCollisionGeometry('fallenLog', 1.5);
    expect(large.width).toBeCloseTo(small.width * 2);
    expect(large.height).toBeCloseTo(small.height * 2);
    expect(large.offsetX).toBeCloseTo(small.offsetX * 2);
    expect(large.offsetY).toBeCloseTo(small.offsetY * 2);
  });

  it('uses distinct footprints for trunks, rocks, logs, and cliffs', () => {
    const footprints = kinds.map((kind) => getObstacleCollisionGeometry(kind, 1));
    expect(new Set(footprints.map(({ width, height }) => `${width}x${height}`)).size).toBe(kinds.length);
  });
});
