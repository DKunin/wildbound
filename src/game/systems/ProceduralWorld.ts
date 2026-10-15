export const WORLD_SEED = 'pine-ridge-2026';
export const WORLD_TILE_SIZE = 256;
export const WORLD_COLUMNS = 24;
export const WORLD_ROWS = 24;
export const WORLD_WIDTH = WORLD_COLUMNS * WORLD_TILE_SIZE;
export const WORLD_HEIGHT = WORLD_ROWS * WORLD_TILE_SIZE;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WaterArea extends WorldPoint {
  width: number;
  height: number;
}

export interface HabitatResources {
  food: readonly WorldPoint[];
  water: readonly WorldPoint[];
  shelter: readonly WorldPoint[];
  explore: readonly WorldPoint[];
}

export type GroundKind = 'meadow' | 'forest' | 'path' | 'flowers' | 'bank';
export type ObstacleKind = 'tree' | 'rock' | 'log' | 'mountain';

export interface ProceduralObstacle {
  kind: ObstacleKind;
  frame: number;
  scale: number;
}

export interface WorldCell {
  column: number;
  row: number;
  ground: GroundKind;
  groundFrame: number;
  water: boolean;
  waterFrame: number;
  blocked: boolean;
  obstacle?: ProceduralObstacle;
}

const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const randomAt = (seed: number, column: number, row: number, salt = 0): number => {
  let value = seed ^ Math.imul(column + 31, 374761393) ^ Math.imul(row + 17, 668265263) ^ Math.imul(salt + 7, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const cellKey = (column: number, row: number): string => `${column},${row}`;

export class ProceduralWorld {
  readonly cells: WorldCell[];
  readonly spawnCell = { column: 9, row: 15 };
  private readonly seedNumber: number;
  private readonly waterRuns: ReadonlyArray<{ column: number; startRow: number; endRow: number }>;
  private readonly waterAreas: ReadonlyArray<WaterArea>;

  constructor(readonly seed = WORLD_SEED) {
    this.seedNumber = hashSeed(seed);
    this.waterRuns = [
      { column: Math.round(WORLD_COLUMNS * 0.73), startRow: 0, endRow: WORLD_ROWS - 1 },
      {
        column: 4 + Math.floor(randomAt(this.seedNumber, 0, 0, 20) * 3),
        startRow: 1,
        endRow: 9 + Math.floor(randomAt(this.seedNumber, 0, 0, 21) * 3),
      },
      {
        column: 10 + Math.floor(randomAt(this.seedNumber, 0, 0, 22) * 3),
        startRow: 18 + Math.floor(randomAt(this.seedNumber, 0, 0, 23) * 2),
        endRow: WORLD_ROWS - 1,
      },
    ];
    this.cells = this.generate();
    this.waterAreas = this.cells
      .filter((cell) => cell.water)
      .map((cell) => ({
        x: (cell.column + 0.5) * WORLD_TILE_SIZE,
        y: cell.row * WORLD_TILE_SIZE,
        width: 0,
        height: WORLD_TILE_SIZE,
      }));
  }

  getCell(column: number, row: number): WorldCell | undefined {
    if (column < 0 || row < 0 || column >= WORLD_COLUMNS || row >= WORLD_ROWS) return undefined;
    return this.cells[row * WORLD_COLUMNS + column];
  }

  getCellAt(point: WorldPoint): WorldCell | undefined {
    return this.getCell(Math.floor(point.x / WORLD_TILE_SIZE), Math.floor(point.y / WORLD_TILE_SIZE));
  }

  getCellCenter(column: number, row: number): WorldPoint {
    return { x: (column + 0.5) * WORLD_TILE_SIZE, y: (row + 0.5) * WORLD_TILE_SIZE };
  }

  getSpawnPoint(): WorldPoint {
    return this.getCellCenter(this.spawnCell.column, this.spawnCell.row);
  }

  getWaterPaths(): WorldPoint[][] {
    return this.waterRuns.map((run) => Array.from(
      { length: run.endRow - run.startRow + 1 },
      (_, index) => this.getCellCenter(run.column, run.startRow + index),
    ));
  }

  getWaterAreas(): readonly WaterArea[] {
    return this.waterAreas;
  }

  getHabitatResources(species: 'rabbit' | 'deer'): HabitatResources {
    const open = this.cells.filter((cell) => !cell.blocked && !cell.water);
    const points = (cells: readonly WorldCell[]): WorldPoint[] => cells.map((cell) => this.getCellCenter(cell.column, cell.row));
    const food = open.filter((cell) => species === 'rabbit'
      ? cell.ground === 'flowers' || cell.ground === 'meadow'
      : cell.ground === 'flowers' || cell.ground === 'meadow' || cell.ground === 'forest');
    const shelter = open.filter((cell) => species === 'rabbit'
      ? cell.ground === 'forest' || cell.ground === 'bank'
      : cell.ground === 'forest');
    const water = open.filter((cell) => cell.ground === 'bank');
    return {
      food: points(food),
      water: points(water),
      shelter: points(shelter),
      explore: points(open.filter((cell) => cell.ground === 'path' || cell.ground === 'meadow')),
    };
  }

  getTerritoryName(point: WorldPoint): string {
    const cell = this.getCellAt(point);
    if (!cell) return 'WILDERNESS EDGE';
    if (Math.hypot(cell.column - this.spawnCell.column, cell.row - this.spawnCell.row) < 4.5) return 'PINE RIDGE';
    if (cell.water || cell.ground === 'bank') return 'STONE RUN';
    if (cell.row < 8) return 'PINE RIDGE';
    if (cell.column < 9) return 'BIRCH HOLLOW';
    if (cell.ground === 'flowers' || cell.row > 16) return 'ELK MEADOW';
    return 'NORTHWOOD';
  }

  findOpenPositionNear(point: WorldPoint, maxRadius = 7): WorldPoint {
    const startColumn = Math.max(0, Math.min(WORLD_COLUMNS - 1, Math.floor(point.x / WORLD_TILE_SIZE)));
    const startRow = Math.max(0, Math.min(WORLD_ROWS - 1, Math.floor(point.y / WORLD_TILE_SIZE)));
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
          if (Math.max(Math.abs(columnOffset), Math.abs(rowOffset)) !== radius) continue;
          const cell = this.getCell(startColumn + columnOffset, startRow + rowOffset);
          if (cell && !cell.blocked && !cell.water) return this.getCellCenter(cell.column, cell.row);
        }
      }
    }
    return this.getSpawnPoint();
  }

  findPath(start: WorldPoint, destination: WorldPoint): WorldPoint[] {
    const startCell = this.resolveOpenCell(start);
    const endCell = this.resolveOpenCell(destination);
    if (!startCell || !endCell) return [];

    const open = new Set<string>([cellKey(startCell.column, startCell.row)]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[cellKey(startCell.column, startCell.row), 0]]);
    const fScore = new Map<string, number>([[cellKey(startCell.column, startCell.row), this.heuristic(startCell, endCell)]]);

    while (open.size > 0) {
      const currentKey = [...open].reduce((best, key) => (fScore.get(key) ?? Infinity) < (fScore.get(best) ?? Infinity) ? key : best);
      const [column, row] = currentKey.split(',').map(Number);
      if (column === endCell.column && row === endCell.row) return this.reconstructPath(cameFrom, currentKey, destination, endCell);
      open.delete(currentKey);

      for (const neighbor of this.neighbors(column, row)) {
        const neighborKey = cellKey(neighbor.column, neighbor.row);
        const diagonal = neighbor.column !== column && neighbor.row !== row;
        const tentative = (gScore.get(currentKey) ?? Infinity) + (diagonal ? Math.SQRT2 : 1);
        if (tentative >= (gScore.get(neighborKey) ?? Infinity)) continue;
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentative);
        fScore.set(neighborKey, tentative + this.heuristic(neighbor, endCell));
        open.add(neighborKey);
      }
    }
    return [];
  }

  hasLineOfSight(start: WorldPoint, end: WorldPoint): boolean {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / (WORLD_TILE_SIZE / 5)));
    for (let step = 1; step < steps; step += 1) {
      const progress = step / steps;
      const cell = this.getCellAt({
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      });
      if (cell?.blocked) return false;
    }
    return true;
  }

  private generate(): WorldCell[] {
    const cells: WorldCell[] = [];
    for (let row = 0; row < WORLD_ROWS; row += 1) {
      for (let column = 0; column < WORLD_COLUMNS; column += 1) {
        const border = column === 0 || row === 0 || column === WORLD_COLUMNS - 1 || row === WORLD_ROWS - 1;
        const water = this.isWaterCell(column, row);
        const onPath = row === this.pathRow(column) || column === this.pathColumn(row);
        const noise = randomAt(this.seedNumber, column, row);
        let ground: GroundKind = noise < 0.43 ? 'forest' : noise < 0.76 ? 'meadow' : 'flowers';
        if (onPath) ground = 'path';
        if (water || this.isShoreCell(column, row)) ground = 'bank';
        const groundFrame = this.overlayFrame(ground, column, row);
        const safeFromSpawn = Math.hypot(column - this.spawnCell.column, row - this.spawnCell.row) > 1.4;
        const obstacle = border
          ? { kind: 'mountain' as const, frame: 13 + Math.floor(randomAt(this.seedNumber, column, row, 2) * 3), scale: 1.03 }
          : !water && !onPath && safeFromSpawn
            ? this.createObstacle(ground, column, row)
            : undefined;
        cells.push({
          column,
          row,
          ground,
          groundFrame,
          water,
          waterFrame: this.waterFrame(row),
          blocked: Boolean(obstacle),
          obstacle,
        });
      }
    }
    return cells;
  }

  private createObstacle(ground: GroundKind, column: number, row: number): ProceduralObstacle | undefined {
    const chance = ground === 'forest' ? 0.7 : ground === 'meadow' ? 0.28 : ground === 'flowers' ? 0.2 : 0.3;
    const roll = randomAt(this.seedNumber, column, row, 3);
    if (roll >= chance) return undefined;
    const kindRoll = randomAt(this.seedNumber, column, row, 4);
    const variation = randomAt(this.seedNumber, column, row, 5);
    if (kindRoll < 0.56) return { kind: 'tree', frame: Math.floor(variation * 7), scale: 0.96 + variation * 0.26 };
    if (kindRoll < 0.8) return { kind: 'rock', frame: 7 + Math.floor(variation * 4), scale: 0.84 + variation * 0.24 };
    if (kindRoll < 0.92) return { kind: 'log', frame: 11 + Math.floor(variation * 2), scale: 0.88 + variation * 0.2 };
    return { kind: 'mountain', frame: 13 + Math.floor(variation * 3), scale: 0.98 + variation * 0.24 };
  }

  private overlayFrame(kind: GroundKind, column: number, row: number): number {
    const variation = Math.floor(randomAt(this.seedNumber, column, row, 6) * 4);
    if (kind === 'forest') return variation;
    if (kind === 'flowers') return 4 + variation;
    if (kind === 'path') {
      if (row === this.pathRow(column)) {
        const previous = this.pathRow(Math.max(0, column - 1));
        const next = this.pathRow(Math.min(WORLD_COLUMNS - 1, column + 1));
        if (next > previous) return 11;
        if (next < previous) return 10;
        return 8;
      }
      return 9;
    }
    return -1;
  }

  private isWaterCell(column: number, row: number): boolean {
    return this.waterRuns.some((run) => column === run.column && row >= run.startRow && row <= run.endRow);
  }

  private isShoreCell(column: number, row: number): boolean {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if ((columnOffset !== 0 || rowOffset !== 0) && this.isWaterCell(column + columnOffset, row + rowOffset)) return true;
      }
    }
    return false;
  }

  private pathRow(column: number): number {
    return Math.round(WORLD_ROWS * 0.62 + Math.sin(column * 0.44) * 1.8);
  }

  private pathColumn(row: number): number {
    return Math.round(WORLD_COLUMNS * 0.38 + Math.sin(row * 0.37 + 1.4) * 1.35);
  }

  private waterFrame(_row: number): number {
    return 12;
  }

  private resolveOpenCell(point: WorldPoint): WorldCell | undefined {
    const direct = this.getCellAt(point);
    if (direct && !direct.blocked) return direct;
    const open = this.findOpenPositionNear(point);
    return this.getCellAt(open);
  }

  private neighbors(column: number, row: number): WorldCell[] {
    const result: WorldCell[] = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (columnOffset === 0 && rowOffset === 0) continue;
        const cell = this.getCell(column + columnOffset, row + rowOffset);
        if (!cell || cell.blocked) continue;
        if (columnOffset !== 0 && rowOffset !== 0) {
          if (this.getCell(column + columnOffset, row)?.blocked || this.getCell(column, row + rowOffset)?.blocked) continue;
        }
        result.push(cell);
      }
    }
    return result;
  }

  private heuristic(a: { column: number; row: number }, b: { column: number; row: number }): number {
    const dx = Math.abs(a.column - b.column);
    const dy = Math.abs(a.row - b.row);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  private reconstructPath(cameFrom: Map<string, string>, currentKey: string, destination: WorldPoint, endCell: WorldCell): WorldPoint[] {
    const keys = [currentKey];
    while (cameFrom.has(keys[0])) keys.unshift(cameFrom.get(keys[0])!);
    const points = keys.slice(1).map((key) => {
      const [column, row] = key.split(',').map(Number);
      return this.getCellCenter(column, row);
    });
    if (this.getCellAt(destination) === endCell) points.push({ x: destination.x, y: destination.y });
    return points.filter((point, index, all) => index === all.length - 1 || point.x !== all[index + 1].x || point.y !== all[index + 1].y);
  }
}
