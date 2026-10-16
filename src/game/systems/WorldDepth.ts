import type {
  ObstacleKind,
  ProceduralDecoration,
  ProceduralTerrainFeature,
} from './ProceduralWorld';

const GROUND_FEATURE_DEPTH = -88;
const GROUND_OBSTACLE_DEPTH = -87;
const GROUND_DECORATION_DEPTH = -86;

export const getTerrainFeatureDepth = (feature: ProceduralTerrainFeature, y: number): number => {
  if (!feature.blocked || feature.kind === 'windfall') return GROUND_FEATURE_DEPTH;
  return y + 62;
};

export const getObstacleDepth = (kind: ObstacleKind, y: number): number => (
  kind === 'fallenLog' ? GROUND_OBSTACLE_DEPTH : y + 80
);

export const getDecorationDepth = (decoration: ProceduralDecoration, y: number): number => {
  if (decoration.atlas === 'terrain') return -89;
  if (decoration.kind === 'stones' || decoration.kind === 'fallenBranch') return GROUND_DECORATION_DEPTH;
  return y + 12;
};
