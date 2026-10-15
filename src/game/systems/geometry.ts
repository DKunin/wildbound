export interface PointLike {
  x: number;
  y: number;
}

export interface AxisAlignedArea extends PointLike {
  width: number;
  height: number;
}

export const distanceToSegment = (point: PointLike, start: PointLike, end: PointLike): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export const distanceToPath = (point: PointLike, path: readonly PointLike[]): number => {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);

  let shortest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    shortest = Math.min(shortest, distanceToSegment(point, path[index - 1], path[index]));
  }
  return shortest;
};

export const distanceToArea = (point: PointLike, area: AxisAlignedArea): number => {
  const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
  const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
  return Math.hypot(dx, dy);
};

export const distanceToAreas = (point: PointLike, areas: readonly AxisAlignedArea[]): number => {
  let shortest = Number.POSITIVE_INFINITY;
  for (const area of areas) shortest = Math.min(shortest, distanceToArea(point, area));
  return shortest;
};
