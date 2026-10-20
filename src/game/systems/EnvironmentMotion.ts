import { windResponse } from './WindResponse';

export type EnvironmentMotionKind = 'tree' | 'bush' | 'water' | 'water-flow';

export interface EnvironmentMotionPoint {
  x: number;
  y: number;
}

export interface EnvironmentMotionSample {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export const ENVIRONMENT_MOTION_RADIUS = 1_200;
export const ENVIRONMENT_MOTION_INTERVAL_MS = 100;
export const ENVIRONMENT_MOTION_BUCKET_SIZE = 512;

const TAU = Math.PI * 2;

export const getEnvironmentMotionBucketKey = (
  point: EnvironmentMotionPoint,
  bucketSize = ENVIRONMENT_MOTION_BUCKET_SIZE,
): string => `${Math.floor(point.x / bucketSize)},${Math.floor(point.y / bucketSize)}`;

export const getNearbyEnvironmentMotionBucketKeys = (
  point: EnvironmentMotionPoint,
  radius = ENVIRONMENT_MOTION_RADIUS,
  bucketSize = ENVIRONMENT_MOTION_BUCKET_SIZE,
): string[] => {
  const centerColumn = Math.floor(point.x / bucketSize);
  const centerRow = Math.floor(point.y / bucketSize);
  const bucketRadius = Math.ceil(radius / bucketSize);
  const keys: string[] = [];
  for (let row = centerRow - bucketRadius; row <= centerRow + bucketRadius; row += 1) {
    for (let column = centerColumn - bucketRadius; column <= centerColumn + bucketRadius; column += 1) {
      keys.push(`${column},${row}`);
    }
  }
  return keys;
};

export const isEnvironmentMotionNearby = (
  anchor: EnvironmentMotionPoint,
  player: EnvironmentMotionPoint,
  radius = ENVIRONMENT_MOTION_RADIUS,
): boolean => {
  const x = anchor.x - player.x;
  const y = anchor.y - player.y;
  return x * x + y * y <= radius * radius;
};

export const getEnvironmentMotionPhase = (point: EnvironmentMotionPoint, salt = 0): number => {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  let hash = Math.imul(x + 31, 73_856_093) ^ Math.imul(y + 17, 19_349_663) ^ Math.imul(salt + 7, 83_492_791);
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_296 * TAU;
};

export const getEnvironmentMotionSample = (
  kind: EnvironmentMotionKind,
  time: number,
  phase: number,
  flow: EnvironmentMotionPoint = { x: 0, y: 0 },
  windStrength = 0.53,
): EnvironmentMotionSample => {
  if (kind === 'tree') {
    const wave = Math.sin(time / 2_600 + phase) * windResponse(windStrength).motionAmplitude;
    return { x: 0, y: 0, angle: wave * 0.22, scaleX: 1 + wave * 0.0015, scaleY: 1 - wave * 0.001, alpha: 1 };
  }
  if (kind === 'bush') {
    const wave = Math.sin(time / 1_900 + phase) * windResponse(windStrength).motionAmplitude;
    return { x: 0, y: 0, angle: wave * 0.14, scaleX: 1 + wave * 0.003, scaleY: 1 - wave * 0.002, alpha: 1 };
  }
  if (kind === 'water') {
    const wave = Math.sin(time / 1_350 + phase);
    return { x: 0, y: 0, angle: 0, scaleX: 1 + wave * 0.0015, scaleY: 1 - wave * 0.0015, alpha: 0.965 + (wave + 1) * 0.0175 };
  }

  const length = Math.hypot(flow.x, flow.y) || 1;
  const progress = (((time / 2_200) + phase / TAU) % 1 + 1) % 1;
  const travel = -10 + progress * 20;
  return {
    x: flow.x / length * travel,
    y: flow.y / length * travel,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 0.4 + Math.sin(Math.PI * progress) * 0.8,
  };
};
