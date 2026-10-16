import { describe, expect, it } from 'vitest';
import type {
  ObstacleKind,
  ProceduralDecoration,
  ProceduralTerrainFeature,
} from '../src/game/systems/ProceduralWorld';
import { getDecorationDepth, getObstacleDepth, getTerrainFeatureDepth } from '../src/game/systems/WorldDepth';

const feature = (kind: ProceduralTerrainFeature['kind'], blocked: boolean): ProceduralTerrainFeature => ({
  kind,
  blocked,
  frame: 0,
  scale: 1,
  flipX: false,
});

const decoration = (kind: ProceduralDecoration['kind'], atlas: ProceduralDecoration['atlas']): ProceduralDecoration => ({
  kind,
  atlas,
  frame: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  flipX: false,
  alpha: 1,
});

describe('world object depth', () => {
  it('keeps low terrain features and fallen logs below every living creature', () => {
    expect(getTerrainFeatureDepth(feature('windfall', true), 5_000)).toBeLessThan(0);
    expect(getTerrainFeatureDepth(feature('berryThicket', false), 5_000)).toBeLessThan(0);
    expect(getObstacleDepth('fallenLog', 5_000)).toBeLessThan(0);
  });

  it('keeps loose ground decorations below animals', () => {
    expect(getDecorationDepth(decoration('stones', 'obstacle'), 5_000)).toBeLessThan(0);
    expect(getDecorationDepth(decoration('fallenBranch', 'obstacle'), 5_000)).toBeLessThan(0);
    expect(getDecorationDepth(decoration('wildflowers', 'terrain'), 5_000)).toBeLessThan(0);
  });

  it('retains positional occlusion for tall or raised scenery', () => {
    for (const kind of ['pine', 'birch', 'boulder', 'rockFormation', 'cliff'] satisfies ObstacleKind[]) {
      expect(getObstacleDepth(kind, 5_000)).toBeGreaterThan(5_000);
    }
    expect(getTerrainFeatureDepth(feature('graniteScree', true), 5_000)).toBeGreaterThan(5_000);
    expect(getDecorationDepth(decoration('sapling', 'obstacle'), 5_000)).toBeGreaterThan(5_000);
  });
});
