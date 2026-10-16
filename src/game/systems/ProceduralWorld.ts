import { findEscapePath as buildEscapePath } from './PreyEscapeSystem';

export const WORLD_SEED = 'pine-ridge-expanded-2026';
export const WORLD_TILE_SIZE = 256;
export const WORLD_COLUMNS = 32;
export const WORLD_ROWS = 32;
export const WORLD_WIDTH = WORLD_COLUMNS * WORLD_TILE_SIZE;
export const WORLD_HEIGHT = WORLD_ROWS * WORLD_TILE_SIZE;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WaterArea extends WorldPoint {
  width: number;
  height: number;
  kind: 'flowing' | 'still';
}

export interface HabitatResources {
  food: readonly WorldPoint[];
  water: readonly WorldPoint[];
  shelter: readonly WorldPoint[];
  explore: readonly WorldPoint[];
}

export type GroundKind = 'meadow' | 'forest' | 'path' | 'flowers' | 'bank';
export type ObstacleKind = 'pine' | 'birch' | 'boulder' | 'rockFormation' | 'fallenLog' | 'cliff';
export type DecorationKind = 'sapling' | 'brush' | 'stones' | 'wildflowers' | 'fallenBranch';

export interface ProceduralObstacle {
  kind: ObstacleKind;
  frame: number;
  scale: number;
}

export interface ProceduralDecoration {
  kind: DecorationKind;
  atlas: 'obstacle' | 'terrain';
  frame: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  flipX: boolean;
  alpha: number;
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
  decorations: ProceduralDecoration[];
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
  readonly spawnCell = { column: 12, row: 20 };
  private readonly seedNumber: number;
  private readonly waterRuns: ReadonlyArray<{ column: number; startRow: number; endRow: number }>;
  private readonly flowingWaterAreas: ReadonlyArray<WaterArea>;
  private readonly puddleAreas: ReadonlyArray<WaterArea>;
  private readonly waterAreas: ReadonlyArray<WaterArea>;

  constructor(readonly seed = WORLD_SEED) {
    this.seedNumber = hashSeed(seed);
    this.waterRuns = [
      { column: Math.round(WORLD_COLUMNS * 0.73), startRow: 0, endRow: WORLD_ROWS - 1 },
      {
        column: Math.round(WORLD_COLUMNS * 0.2) + Math.floor(randomAt(this.seedNumber, 0, 0, 20) * 3) - 1,
        startRow: 1,
        endRow: Math.round(WORLD_ROWS * 0.37) + Math.floor(randomAt(this.seedNumber, 0, 0, 21) * 3),
      },
      {
        column: Math.round(WORLD_COLUMNS * 0.44) + Math.floor(randomAt(this.seedNumber, 0, 0, 22) * 3) - 1,
        startRow: Math.round(WORLD_ROWS * 0.73) + Math.floor(randomAt(this.seedNumber, 0, 0, 23) * 2),
        endRow: WORLD_ROWS - 1,
      },
    ];
    this.cells = this.generate();
    this.flowingWaterAreas = this.cells
      .filter((cell) => cell.water)
      .map((cell) => ({
        x: (cell.column + 0.5) * WORLD_TILE_SIZE,
        y: cell.row * WORLD_TILE_SIZE,
        width: 0,
        height: WORLD_TILE_SIZE,
        kind: 'flowing',
      }));
    this.puddleAreas = this.generatePuddles();
    this.waterAreas = [...this.flowingWaterAreas, ...this.puddleAreas];
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

  getFlowingWaterAreas(): readonly WaterArea[] {
    return this.flowingWaterAreas;
  }

  getPuddleAreas(): readonly WaterArea[] {
    return this.puddleAreas;
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
    const water = [
      ...points(open.filter((cell) => cell.ground === 'bank')),
      ...this.puddleAreas.map((area) => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 })),
    ];
    return {
      food: points(food),
      water,
      shelter: points(shelter),
      explore: points(open.filter((cell) => cell.ground === 'path' || cell.ground === 'meadow')),
    };
  }

  getTerritoryName(point: WorldPoint): string {
    const cell = this.getCellAt(point);
    if (!cell) return 'WILDERNESS EDGE';
    if (Math.hypot(cell.column - this.spawnCell.column, cell.row - this.spawnCell.row) < 4.5) return 'PINE RIDGE';
    if (this.puddleAreas.some((area) => point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height)) return 'MIRROR POOLS';
    if (cell.water || cell.ground === 'bank') return 'STONE RUN';
    if (cell.row < WORLD_ROWS * 0.25) return 'PINE RIDGE';
    if (cell.column < WORLD_COLUMNS * 0.34) return 'BIRCH HOLLOW';
    if (cell.ground === 'flowers' || cell.row > WORLD_ROWS * 0.72) return 'ELK MEADOW';
    if (cell.column > WORLD_COLUMNS * 0.77) return 'CEDAR BASIN';
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

  findEscapePath(start: WorldPoint, threat: WorldPoint, lateralBias = 0): WorldPoint[] {
    return buildEscapePath(start, threat, {
      columns: WORLD_COLUMNS,
      rows: WORLD_ROWS,
      tileSize: WORLD_TILE_SIZE,
      isPassable: (column, row) => {
        const cell = this.getCell(column, row);
        return cell !== undefined && !cell.blocked && !cell.water;
      },
    }, 8, { lateralBias });
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
          ? { kind: 'cliff' as const, frame: 13 + Math.floor(randomAt(this.seedNumber, column, row, 2) * 3), scale: 1.03 }
          : !water && !onPath && safeFromSpawn
            ? this.createObstacle(ground, column, row)
            : undefined;
        const decorations = this.createDecorations(ground, column, row, Boolean(obstacle), water, onPath);
        cells.push({
          column,
          row,
          ground,
          groundFrame,
          water,
          waterFrame: this.waterFrame(row),
          blocked: Boolean(obstacle),
          obstacle,
          decorations,
        });
      }
    }
    return cells;
  }

  private createObstacle(ground: GroundKind, column: number, row: number): ProceduralObstacle | undefined {
    const chance = ground === 'forest' ? 0.52 : ground === 'meadow' ? 0.18 : ground === 'flowers' ? 0.12 : 0.1;
    const roll = randomAt(this.seedNumber, column, row, 3);
    if (roll >= chance) return undefined;
    const kindRoll = randomAt(this.seedNumber, column, row, 4);
    const variation = randomAt(this.seedNumber, column, row, 5);
    if (kindRoll < 0.38) return { kind: 'pine', frame: Math.floor(variation * 5), scale: 0.92 + variation * 0.3 };
    if (kindRoll < 0.55) return { kind: 'birch', frame: 5 + Math.floor(variation * 2), scale: 0.92 + variation * 0.25 };
    if (kindRoll < 0.69) return { kind: 'boulder', frame: 7, scale: 0.82 + variation * 0.24 };
    if (kindRoll < 0.84) return { kind: 'rockFormation', frame: 8 + Math.floor(variation * 3), scale: 0.82 + variation * 0.22 };
    if (kindRoll < 0.94) return { kind: 'fallenLog', frame: 11 + Math.floor(variation * 2), scale: 0.86 + variation * 0.2 };
    return { kind: 'cliff', frame: 13 + Math.floor(variation * 3), scale: 0.94 + variation * 0.2 };
  }

  private createDecorations(ground: GroundKind, column: number, row: number, blocked: boolean, water: boolean, onPath: boolean): ProceduralDecoration[] {
    if (blocked || water || onPath || randomAt(this.seedNumber, column, row, 30) > 0.48) return [];
    const roll = randomAt(this.seedNumber, column, row, 31);
    const variation = randomAt(this.seedNumber, column, row, 32);
    const common = {
      offsetX: Math.round((randomAt(this.seedNumber, column, row, 33) - 0.5) * 130),
      offsetY: Math.round((randomAt(this.seedNumber, column, row, 34) - 0.5) * 120),
      flipX: randomAt(this.seedNumber, column, row, 35) > 0.5,
    };
    if (roll < 0.22 && ground === 'forest') return [{ ...common, kind: 'sapling', atlas: 'obstacle', frame: Math.floor(variation * 7), scale: 0.3 + variation * 0.16, alpha: 0.94 }];
    if (roll < 0.44) return [{ ...common, kind: 'brush', atlas: 'terrain', frame: Math.floor(variation * 4), scale: 0.28 + variation * 0.2, alpha: 0.82 }];
    if (roll < 0.64) return [{ ...common, kind: 'stones', atlas: 'obstacle', frame: 7 + Math.floor(variation * 4), scale: 0.24 + variation * 0.14, alpha: 0.92 }];
    if (roll < 0.84 || ground === 'flowers') return [{ ...common, kind: 'wildflowers', atlas: 'terrain', frame: 4 + Math.floor(variation * 4), scale: 0.26 + variation * 0.18, alpha: 0.9 }];
    return [{ ...common, kind: 'fallenBranch', atlas: 'obstacle', frame: 11 + Math.floor(variation * 2), scale: 0.25 + variation * 0.14, alpha: 0.92 }];
  }

  private generatePuddles(): WaterArea[] {
    const candidates = this.cells
      .filter((cell) => !cell.blocked && !cell.water && cell.ground !== 'path' && cell.decorations.length === 0
        && Math.hypot(cell.column - this.spawnCell.column, cell.row - this.spawnCell.row) > 3.2
        && this.hasPuddleClearance(cell))
      .sort((a, b) => randomAt(this.seedNumber, a.column, a.row, 40) - randomAt(this.seedNumber, b.column, b.row, 40))
      .slice(0, 12);
    const sizes = [
      { minWidth: 82, widthRange: 30, minHeight: 52, heightRange: 20 },
      { minWidth: 142, widthRange: 48, minHeight: 82, heightRange: 34 },
      { minWidth: 218, widthRange: 54, minHeight: 132, heightRange: 42 },
    ] as const;
    return candidates.map((cell, index) => {
      const size = sizes[index % sizes.length];
      const width = size.minWidth + Math.round(randomAt(this.seedNumber, cell.column, cell.row, 41) * size.widthRange);
      const height = size.minHeight + Math.round(randomAt(this.seedNumber, cell.column, cell.row, 42) * size.heightRange);
      const center = this.getCellCenter(cell.column, cell.row);
      const jitterX = Math.round((randomAt(this.seedNumber, cell.column, cell.row, 43) - 0.5) * 28);
      const jitterY = Math.round((randomAt(this.seedNumber, cell.column, cell.row, 44) - 0.5) * 28);
      return { x: center.x + jitterX - width / 2, y: center.y + jitterY - height / 2, width, height, kind: 'still' as const };
    });
  }

  private hasPuddleClearance(cell: WorldCell): boolean {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const neighbor = this.getCell(cell.column + columnOffset, cell.row + rowOffset);
        if (!neighbor || neighbor.blocked || neighbor.water) return false;
      }
    }
    return true;
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
