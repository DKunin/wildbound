export type BaseDirection = 'down-right' | 'down-left' | 'up-right' | 'up-left';

export interface DirectionalFacing {
  animationDirection: BaseDirection;
  rotation: number;
  compass: 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';
}

export const PLAYER_DIRECTIONS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const;
export type PlayerDirection = typeof PLAYER_DIRECTIONS[number];

export const getPlayerDirectionVector = (direction: PlayerDirection): readonly [number, number] => {
  const diagonal = Math.SQRT1_2;
  const vectors: Record<PlayerDirection, readonly [number, number]> = {
    east: [1, 0],
    southeast: [diagonal, diagonal],
    south: [0, 1],
    southwest: [-diagonal, diagonal],
    west: [-1, 0],
    northwest: [-diagonal, -diagonal],
    north: [0, -1],
    northeast: [diagonal, -diagonal],
  };
  return vectors[direction];
};

export interface PlayerFacing extends Omit<DirectionalFacing, 'animationDirection'> {
  animationDirection: PlayerDirection;
}

const TAU = Math.PI * 2;
const COMPASS: DirectionalFacing['compass'][] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const BASES: Array<{ angle: number; animationDirection: BaseDirection }> = [
  { angle: Math.PI / 4, animationDirection: 'down-right' },
  { angle: Math.PI * 3 / 4, animationDirection: 'down-left' },
  { angle: Math.PI * 5 / 4, animationDirection: 'up-left' },
  { angle: Math.PI * 7 / 4, animationDirection: 'up-right' },
];

const normalizeAngle = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const shortestDelta = (from: number, to: number): number => {
  const delta = normalizeAngle(to - from + Math.PI) - Math.PI;
  return delta === -Math.PI ? Math.PI : delta;
};

export const resolveDirectionalFacing = (x: number, y: number): DirectionalFacing => {
  if (x === 0 && y === 0) return { animationDirection: 'down-right', rotation: 0, compass: 'SE' };
  const angle = normalizeAngle(Math.atan2(y, x));
  const base = BASES.reduce((closest, candidate) => (
    Math.abs(shortestDelta(candidate.angle, angle)) < Math.abs(shortestDelta(closest.angle, angle)) ? candidate : closest
  ));
  const compassIndex = Math.round(angle / (Math.PI / 4)) % 8;
  return {
    animationDirection: base.animationDirection,
    rotation: shortestDelta(base.angle, angle),
    compass: COMPASS[compassIndex],
  };
};

export const resolvePlayerFacing = (x: number, y: number): PlayerFacing => {
  const facing = resolveDirectionalFacing(x, y);
  const directionByCompass: Record<DirectionalFacing['compass'], PlayerDirection> = {
    E: 'east',
    SE: 'southeast',
    S: 'south',
    SW: 'southwest',
    W: 'west',
    NW: 'northwest',
    N: 'north',
    NE: 'northeast',
  };
  return { ...facing, animationDirection: directionByCompass[facing.compass], rotation: 0 };
};
