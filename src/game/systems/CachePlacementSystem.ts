export interface CachePlacementBounds {
  width: number;
  height: number;
  margin: number;
}

export interface CachePlacementInput {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  clearance: number;
  bounds: CachePlacementBounds;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

export const getCacheBurialPosition = ({
  x,
  y,
  directionX,
  directionY,
  clearance,
  bounds,
}: CachePlacementInput): { x: number; y: number } => {
  const directionLength = Math.hypot(directionX, directionY) || 1;
  const normalizedX = directionX / directionLength;
  const normalizedY = directionY / directionLength;
  const project = (sign: 1 | -1) => ({
    x: clamp(x + normalizedX * clearance * sign, bounds.margin, bounds.width - bounds.margin),
    y: clamp(y + normalizedY * clearance * sign, bounds.margin, bounds.height - bounds.margin),
  });
  const forward = project(1);
  const forwardDistance = Math.hypot(forward.x - x, forward.y - y);
  return forwardDistance >= clearance * 0.82 ? forward : project(-1);
};
