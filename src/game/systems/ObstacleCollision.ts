import type { ObstacleKind } from './ProceduralWorld';

export const OBSTACLE_ATLAS_FRAME_SIZE = 313;

export interface ObstacleCollisionGeometry {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

const BASE_FOOTPRINTS: Record<ObstacleKind, { width: number; height: number; offsetY: number }> = {
  pine: { width: 88, height: 54, offsetY: 238 },
  birch: { width: 112, height: 58, offsetY: 232 },
  boulder: { width: 214, height: 94, offsetY: 190 },
  rockFormation: { width: 252, height: 112, offsetY: 174 },
  fallenLog: { width: 270, height: 82, offsetY: 200 },
  cliff: { width: 278, height: 142, offsetY: 154 },
};

export const getObstacleCollisionGeometry = (kind: ObstacleKind, scale: number): ObstacleCollisionGeometry => {
  const footprint = BASE_FOOTPRINTS[kind];
  const displaySize = OBSTACLE_ATLAS_FRAME_SIZE * scale;
  const width = footprint.width * scale;
  const height = footprint.height * scale;
  return {
    width,
    height,
    offsetX: (displaySize - width) / 2,
    offsetY: footprint.offsetY * scale,
  };
};
