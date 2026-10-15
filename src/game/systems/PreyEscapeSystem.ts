export interface EscapePoint {
  x: number;
  y: number;
}

export interface EscapeGrid {
  columns: number;
  rows: number;
  tileSize: number;
  isPassable(column: number, row: number): boolean;
}

interface EscapeCell {
  column: number;
  row: number;
}

const cellKey = (cell: EscapeCell): string => `${cell.column},${cell.row}`;

const clampCell = (value: number, size: number): number => Math.max(0, Math.min(size - 1, value));

const getNeighbors = (grid: EscapeGrid, cell: EscapeCell): EscapeCell[] => {
  const neighbors: EscapeCell[] = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (columnOffset === 0 && rowOffset === 0) continue;
      const column = cell.column + columnOffset;
      const row = cell.row + rowOffset;
      if (!grid.isPassable(column, row)) continue;
      if (columnOffset !== 0 && rowOffset !== 0
        && (!grid.isPassable(cell.column + columnOffset, cell.row)
          || !grid.isPassable(cell.column, cell.row + rowOffset))) continue;
      neighbors.push({ column, row });
    }
  }
  return neighbors;
};

const cellCenter = (cell: EscapeCell, tileSize: number): EscapePoint => ({
  x: (cell.column + 0.5) * tileSize,
  y: (cell.row + 0.5) * tileSize,
});

const reconstruct = (
  cameFrom: ReadonlyMap<string, string>,
  cells: ReadonlyMap<string, EscapeCell>,
  destinationKey: string,
  tileSize: number,
): EscapePoint[] => {
  const keys = [destinationKey];
  while (cameFrom.has(keys[0])) keys.unshift(cameFrom.get(keys[0])!);
  return keys.slice(1).map((key) => cellCenter(cells.get(key)!, tileSize));
};

export const findEscapePath = (
  start: EscapePoint,
  threat: EscapePoint,
  grid: EscapeGrid,
  maxSteps = 8,
): EscapePoint[] => {
  const startCell = {
    column: clampCell(Math.floor(start.x / grid.tileSize), grid.columns),
    row: clampCell(Math.floor(start.y / grid.tileSize), grid.rows),
  };
  if (!grid.isPassable(startCell.column, startCell.row)) return [];

  const startKey = cellKey(startCell);
  const queue: EscapeCell[] = [startCell];
  const cells = new Map<string, EscapeCell>([[startKey, startCell]]);
  const cameFrom = new Map<string, string>();
  const distance = new Map<string, number>([[startKey, 0]]);
  const awayX = start.x - threat.x;
  const awayY = start.y - threat.y;
  const awayLength = Math.hypot(awayX, awayY) || 1;
  const normalizedAwayX = awayX / awayLength;
  const normalizedAwayY = awayY / awayLength;
  const startThreatDistance = awayLength / grid.tileSize;
  let bestKey = startKey;
  let bestScore = -Infinity;

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentKey = cellKey(current);
    const steps = distance.get(currentKey) ?? 0;
    const center = cellCenter(current, grid.tileSize);
    const neighbors = getNeighbors(grid, current);
    const threatDistance = Math.hypot(center.x - threat.x, center.y - threat.y) / grid.tileSize;
    const awayProgress = ((center.x - start.x) * normalizedAwayX + (center.y - start.y) * normalizedAwayY) / grid.tileSize;
    const exits = neighbors.length;
    const edgeClearance = Math.min(current.column, current.row, grid.columns - 1 - current.column, grid.rows - 1 - current.row);
    const edgePenalty = edgeClearance === 0 ? 18 : edgeClearance === 1 ? 6 : 0;
    const deadEndPenalty = exits <= 2 ? 14 : exits <= 3 ? 5 : 0;
    const lostGroundPenalty = threatDistance < startThreatDistance ? 24 : 0;
    const score = threatDistance * 4.2
      + awayProgress * 3.4
      + exits * 0.9
      + Math.min(3, edgeClearance) * 1.8
      + steps * 0.45
      - edgePenalty
      - deadEndPenalty
      - lostGroundPenalty;
    if (steps > 0 && score > bestScore) {
      bestScore = score;
      bestKey = currentKey;
    }

    if (steps >= maxSteps) continue;
    for (const neighbor of neighbors) {
      const neighborKey = cellKey(neighbor);
      if (distance.has(neighborKey)) continue;
      cells.set(neighborKey, neighbor);
      cameFrom.set(neighborKey, currentKey);
      distance.set(neighborKey, steps + 1);
      queue.push(neighbor);
    }
  }

  return bestKey === startKey ? [] : reconstruct(cameFrom, cells, bestKey, grid.tileSize);
};
