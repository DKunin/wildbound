import { findEscapePath as buildEscapePath } from './PreyEscapeSystem';

export const WORLD_SEED = 'pine-ridge-expanded-2026';
export const WORLD_TILE_SIZE = 256;
export const WORLD_COLUMNS = 40;
export const WORLD_ROWS = 40;
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

export interface WaterFlow {
  x: number;
  y: number;
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
export type TerrainFeatureKind = 'graniteScree' | 'wetland' | 'berryThicket' | 'windfall';

export interface ProceduralObstacle {
  kind: ObstacleKind;
  frame: number;
  scale: number;
  flipX: boolean;
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

export interface ProceduralTerrainFeature {
  kind: TerrainFeatureKind;
  frame: number;
  scale: number;
  blocked: boolean;
  flipX: boolean;
}

export interface PathConnections {
  north: boolean;
  northEast: boolean;
  east: boolean;
  southEast: boolean;
  south: boolean;
  southWest: boolean;
  west: boolean;
  northWest: boolean;
}

export interface WorldCell {
  column: number;
  row: number;
  ground: GroundKind;
  groundFrame: number;
  water: boolean;
  waterFrame: number;
  waterAngle: number;
  waterFlipX: boolean;
  waterDisplayWidth: number;
  waterDisplayHeight: number;
  waterFlow?: WaterFlow;
  blocked: boolean;
  pathConnections?: PathConnections;
  obstacle?: ProceduralObstacle;
  feature?: ProceduralTerrainFeature;
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

interface WaterPathCell {
  column: number;
  row: number;
}

type PathDirection = keyof PathConnections;

const PATH_OFFSETS: Record<PathDirection, readonly [number, number]> = {
  north: [0, -1],
  northEast: [1, -1],
  east: [1, 0],
  southEast: [1, 1],
  south: [0, 1],
  southWest: [-1, 1],
  west: [-1, 0],
  northWest: [-1, -1],
};

const OPPOSITE_PATH_DIRECTION: Record<PathDirection, PathDirection> = {
  north: 'south',
  northEast: 'southWest',
  east: 'west',
  southEast: 'northWest',
  south: 'north',
  southWest: 'northEast',
  west: 'east',
  northWest: 'southEast',
};

const emptyPathConnections = (): PathConnections => ({
  north: false,
  northEast: false,
  east: false,
  southEast: false,
  south: false,
  southWest: false,
  west: false,
  northWest: false,
});

export class ProceduralWorld {
  readonly cells: WorldCell[];
  readonly spawnCell = { column: 12, row: 20 };
  private readonly seedNumber: number;
  private readonly pathCells: ReadonlySet<string>;
  private readonly pathConnectionsByCell: ReadonlyMap<string, PathConnections>;
  private readonly waterPaths: ReadonlyArray<ReadonlyArray<WaterPathCell>>;
  private readonly waterFlowByCell: ReadonlyMap<string, WaterFlow>;
  private readonly flowingWaterAreas: ReadonlyArray<WaterArea>;
  private readonly puddleAreas: ReadonlyArray<WaterArea>;
  private readonly wetlandAreas: ReadonlyArray<WaterArea>;
  private readonly waterAreas: ReadonlyArray<WaterArea>;

  constructor(readonly seed = WORLD_SEED) {
    this.seedNumber = hashSeed(seed);
    this.waterPaths = this.buildWaterPaths();
    this.waterFlowByCell = this.buildWaterFlowMap();
    this.pathConnectionsByCell = this.buildPathConnections();
    this.pathCells = new Set(this.pathConnectionsByCell.keys());
    this.cells = this.generate();
    this.flowingWaterAreas = this.cells
      .filter((cell) => cell.water)
      .map((cell) => this.flowingWaterArea(cell));
    this.puddleAreas = this.generatePuddles();
    this.wetlandAreas = this.cells
      .filter((cell) => cell.feature?.kind === 'wetland')
      .map((cell) => ({
        x: (cell.column + 0.5) * WORLD_TILE_SIZE - 72,
        y: (cell.row + 0.5) * WORLD_TILE_SIZE - 48,
        width: 144,
        height: 96,
        kind: 'still' as const,
      }));
    this.waterAreas = [...this.flowingWaterAreas, ...this.puddleAreas, ...this.wetlandAreas];
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
    return this.waterPaths.map((path) => path.map((cell) => this.getCellCenter(cell.column, cell.row)));
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

  getWetlandAreas(): readonly WaterArea[] {
    return this.wetlandAreas;
  }

  getHabitatResources(species: 'rabbit' | 'deer' | 'elk' | 'boar'): HabitatResources {
    const open = this.cells.filter((cell) => !cell.blocked && !cell.water);
    const points = (cells: readonly WorldCell[]): WorldPoint[] => cells.map((cell) => this.getCellCenter(cell.column, cell.row));
    const food = open.filter((cell) => species === 'rabbit'
      ? cell.ground === 'flowers' || cell.ground === 'meadow'
      : species === 'elk'
        ? cell.ground === 'flowers' || cell.ground === 'meadow' || cell.feature?.kind === 'berryThicket'
        : species === 'boar'
          ? cell.ground === 'forest' || cell.ground === 'bank' || cell.feature?.kind === 'berryThicket'
        : cell.ground === 'flowers' || cell.ground === 'meadow' || cell.ground === 'forest');
    const shelter = open.filter((cell) => species === 'rabbit'
      ? cell.ground === 'forest' || cell.ground === 'bank'
      : species === 'boar'
        ? cell.ground === 'forest' || cell.ground === 'bank'
        : cell.ground === 'forest');
    const water = [
      ...points(open.filter((cell) => cell.ground === 'bank')),
      ...this.puddleAreas.map((area) => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 })),
      ...this.wetlandAreas.map((area) => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 })),
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
    if (cell.feature?.kind === 'graniteScree') return 'RAVEN RIDGE';
    if (cell.feature?.kind === 'wetland') return 'REEDMERE';
    if (cell.feature?.kind === 'berryThicket') return 'BERRY HOLLOW';
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
        const waterFlow = this.waterFlowByCell.get(cellKey(column, row));
        const waterStyle = this.waterStyle(waterFlow);
        const onPath = this.pathCells.has(cellKey(column, row));
        const pathConnections = onPath ? this.pathConnections(column, row) : undefined;
        const visiblePath = pathConnections && Object.values(pathConnections).some(Boolean);
        const noise = randomAt(this.seedNumber, column, row);
        let ground: GroundKind = noise < 0.43 ? 'forest' : noise < 0.76 ? 'meadow' : 'flowers';
        if (visiblePath) ground = 'path';
        if (water || this.isShoreCell(column, row)) ground = 'bank';
        const groundFrame = this.overlayFrame(ground, column, row);
        const safeFromSpawn = Math.hypot(column - this.spawnCell.column, row - this.spawnCell.row) > 1.4;
        const featureCandidate = !border && !water && !onPath && safeFromSpawn
          ? this.createTerrainFeature(ground, column, row)
          : undefined;
        const feature = this.avoidNearbyFeatureRepeat(featureCandidate, cells, column, row);
        const obstacle = border
          ? {
              kind: 'cliff' as const,
              frame: 13 + Math.floor(randomAt(this.seedNumber, column, row, 2) * 3),
              scale: 1.03,
              flipX: randomAt(this.seedNumber, column, row, 7) > 0.5,
            }
          : !feature && !water && !onPath && safeFromSpawn
            ? this.avoidNearbyObstacleRepeat(this.createObstacle(ground, column, row), cells, column, row)
            : undefined;
        const blocked = Boolean(obstacle || feature?.blocked);
        const decorations = this.createDecorations(ground, column, row, blocked || Boolean(feature), water, onPath);
        cells.push({
          column,
          row,
          ground,
          groundFrame,
          water,
          waterFrame: waterStyle.frame,
          waterAngle: waterStyle.angle,
          waterFlipX: waterStyle.flipX,
          waterDisplayWidth: waterStyle.displayWidth,
          waterDisplayHeight: waterStyle.displayHeight,
          waterFlow,
          blocked,
          pathConnections: ground === 'path' ? pathConnections : undefined,
          obstacle,
          feature,
          decorations,
        });
      }
    }
    return cells;
  }

  private createTerrainFeature(ground: GroundKind, column: number, row: number): ProceduralTerrainFeature | undefined {
    const expandedTerritory = column >= 32 || row >= 32;
    const roll = randomAt(this.seedNumber, column, row, 50);
    if (roll > (expandedTerritory ? 0.28 : 0.065)) return undefined;
    const variation = Math.floor(randomAt(this.seedNumber, column, row, 51) * 4);
    if (this.isShoreCell(column, row) || (row >= 32 && ground !== 'forest')) {
      return { kind: 'wetland', frame: 4 + variation, scale: 0.78 + variation * 0.025, blocked: false, flipX: randomAt(this.seedNumber, column, row, 52) > 0.5 };
    }
    if (row < WORLD_ROWS * 0.28 || (column >= 32 && row < WORLD_ROWS * 0.62)) {
      return { kind: 'graniteScree', frame: variation, scale: 0.8 + variation * 0.03, blocked: true, flipX: randomAt(this.seedNumber, column, row, 52) > 0.5 };
    }
    if (ground === 'forest') {
      return { kind: 'windfall', frame: 12 + variation, scale: 0.78 + variation * 0.03, blocked: true, flipX: randomAt(this.seedNumber, column, row, 52) > 0.5 };
    }
    return { kind: 'berryThicket', frame: 8 + variation, scale: 0.76 + variation * 0.035, blocked: false, flipX: randomAt(this.seedNumber, column, row, 52) > 0.5 };
  }

  private createObstacle(ground: GroundKind, column: number, row: number): ProceduralObstacle | undefined {
    const chance = ground === 'forest' ? 0.52 : ground === 'meadow' ? 0.18 : ground === 'flowers' ? 0.12 : 0.1;
    const roll = randomAt(this.seedNumber, column, row, 3);
    if (roll >= chance) return undefined;
    const kindRoll = randomAt(this.seedNumber, column, row, 4);
    const variation = randomAt(this.seedNumber, column, row, 5);
    const flipX = randomAt(this.seedNumber, column, row, 7) > 0.5;
    if (kindRoll < 0.38) return { kind: 'pine', frame: Math.floor(variation * 5), scale: 0.92 + variation * 0.3, flipX };
    if (kindRoll < 0.55) return { kind: 'birch', frame: 5 + Math.floor(variation * 2), scale: 0.92 + variation * 0.25, flipX };
    if (kindRoll < 0.69) return { kind: 'boulder', frame: 7, scale: 0.82 + variation * 0.24, flipX };
    if (kindRoll < 0.84) return { kind: 'rockFormation', frame: 8 + Math.floor(variation * 3), scale: 0.82 + variation * 0.22, flipX };
    if (kindRoll < 0.94) return { kind: 'fallenLog', frame: 11 + Math.floor(variation * 2), scale: 0.86 + variation * 0.2, flipX };
    return { kind: 'cliff', frame: 13 + Math.floor(variation * 3), scale: 0.94 + variation * 0.2, flipX };
  }

  private avoidNearbyObstacleRepeat(
    candidate: ProceduralObstacle | undefined,
    cells: readonly WorldCell[],
    column: number,
    row: number,
  ): ProceduralObstacle | undefined {
    if (!candidate) return undefined;
    const ranges: Record<ObstacleKind, readonly [number, number]> = {
      pine: [0, 5],
      birch: [5, 2],
      boulder: [7, 1],
      rockFormation: [8, 3],
      fallenLog: [11, 2],
      cliff: [13, 3],
    };
    const [firstFrame, frameCount] = ranges[candidate.kind];
    return this.findUnusedNearbyVariant(candidate, cells, column, row, firstFrame, frameCount, (cell) => cell.obstacle);
  }

  private avoidNearbyFeatureRepeat(
    candidate: ProceduralTerrainFeature | undefined,
    cells: readonly WorldCell[],
    column: number,
    row: number,
  ): ProceduralTerrainFeature | undefined {
    if (!candidate) return undefined;
    const firstFrame = candidate.frame - (candidate.frame % 4);
    return this.findUnusedNearbyVariant(candidate, cells, column, row, firstFrame, 4, (cell) => cell.feature);
  }

  private findUnusedNearbyVariant<T extends { kind: string; frame: number; flipX: boolean }>(
    candidate: T,
    cells: readonly WorldCell[],
    column: number,
    row: number,
    firstFrame: number,
    frameCount: number,
    pick: (cell: WorldCell) => T | undefined,
  ): T | undefined {
    const nearby = cells
      .filter((cell) => Math.abs(cell.column - column) <= 2 && Math.abs(cell.row - row) <= 2)
      .map(pick)
      .filter((item): item is T => item?.kind === candidate.kind);
    for (let offset = 0; offset < frameCount * 2; offset += 1) {
      const frame = firstFrame + ((candidate.frame - firstFrame + Math.floor(offset / 2)) % frameCount);
      const flipX = offset % 2 === 0 ? candidate.flipX : !candidate.flipX;
      if (!nearby.some((item) => item.frame === frame && item.flipX === flipX)) return { ...candidate, frame, flipX };
    }
    return undefined;
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
    if (kind === 'path') return -1;
    return -1;
  }

  private buildPathConnections(): ReadonlyMap<string, PathConnections> {
    const graph = new Map<string, PathConnections>();
    const routes = [
      this.rasterizePath([
        { column: 0, row: 24 },
        { column: 6, row: 24 },
        { column: 10, row: 22 },
        { column: 17, row: 22 },
        { column: 20, row: 23 },
        { column: 22, row: 23 },
      ]),
      this.rasterizePath([
        { column: 17, row: 22 },
        { column: 17, row: 17 },
        { column: 20, row: 14 },
        { column: 20, row: 7 },
        { column: 23, row: 4 },
        { column: 23, row: 0 },
      ]),
      this.rasterizePath([
        { column: 6, row: 24 },
        { column: 3, row: 21 },
        { column: 3, row: 16 },
        { column: 8, row: 16 },
        { column: 12, row: 20 },
        { column: 10, row: 22 },
      ]),
      this.rasterizePath([
        { column: 20, row: 23 },
        { column: 22, row: 21 },
        { column: 22, row: 14 },
        { column: 20, row: 14 },
      ]),
      this.rasterizePath([
        { column: 17, row: 22 },
        { column: 17, row: 26 },
        { column: 20, row: 26 },
      ]),
    ];

    for (const route of routes) {
      for (const cell of route) {
        if (!graph.has(cellKey(cell.column, cell.row))) graph.set(cellKey(cell.column, cell.row), emptyPathConnections());
      }
      for (let index = 1; index < route.length; index += 1) {
        const previous = route[index - 1];
        const current = route[index];
        const direction = this.pathDirection(current.column - previous.column, current.row - previous.row);
        graph.get(cellKey(previous.column, previous.row))![direction] = true;
        graph.get(cellKey(current.column, current.row))![OPPOSITE_PATH_DIRECTION[direction]] = true;
      }
    }
    return graph;
  }

  private rasterizePath(waypoints: readonly WaterPathCell[]): WaterPathCell[] {
    const path: WaterPathCell[] = [];
    for (let index = 1; index < waypoints.length; index += 1) {
      const start = waypoints[index - 1];
      const end = waypoints[index];
      const steps = Math.max(Math.abs(end.column - start.column), Math.abs(end.row - start.row));
      for (let step = 0; step <= steps; step += 1) {
        const cell = {
          column: Math.round(start.column + ((end.column - start.column) * step) / steps),
          row: Math.round(start.row + ((end.row - start.row) * step) / steps),
        };
        const previous = path.at(-1);
        if (!previous || previous.column !== cell.column || previous.row !== cell.row) path.push(cell);
      }
    }
    return path;
  }

  private pathDirection(columnOffset: number, rowOffset: number): PathDirection {
    const direction = (Object.entries(PATH_OFFSETS) as Array<[PathDirection, readonly [number, number]]>)
      .find(([, offset]) => offset[0] === columnOffset && offset[1] === rowOffset)?.[0];
    if (!direction) throw new Error(`Unsupported path step: ${columnOffset},${rowOffset}`);
    return direction;
  }

  private pathConnections(column: number, row: number): PathConnections {
    const stored = this.pathConnectionsByCell.get(cellKey(column, row)) ?? emptyPathConnections();
    const visible = emptyPathConnections();
    for (const [direction, [columnOffset, rowOffset]] of Object.entries(PATH_OFFSETS) as Array<[PathDirection, readonly [number, number]]>) {
      visible[direction] = stored[direction]
        && !this.isWaterCell(column + columnOffset, row + rowOffset)
        && !this.isShoreCell(column + columnOffset, row + rowOffset);
    }
    return visible;
  }

  private isWaterCell(column: number, row: number): boolean {
    return this.waterFlowByCell.has(cellKey(column, row));
  }

  private isShoreCell(column: number, row: number): boolean {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if ((columnOffset !== 0 || rowOffset !== 0) && this.isWaterCell(column + columnOffset, row + rowOffset)) return true;
      }
    }
    return false;
  }

  private buildWaterPaths(): ReadonlyArray<ReadonlyArray<WaterPathCell>> {
    const mainColumn = Math.round(WORLD_COLUMNS * 0.73);
    const northernRow = 5 + Math.floor(randomAt(this.seedNumber, 0, 0, 20) * 3);
    const southernColumn = Math.round(WORLD_COLUMNS * 0.44)
      + Math.floor(randomAt(this.seedNumber, 0, 0, 22) * 3) - 1;
    return [
      this.rasterizeWaterPath([
        { column: mainColumn, row: 0 },
        { column: mainColumn, row: 8 },
        { column: mainColumn + 5, row: 13 },
        { column: mainColumn + 5, row: 20 },
        { column: mainColumn - 1, row: 20 },
        { column: mainColumn - 5, row: 24 },
        { column: mainColumn - 5, row: WORLD_ROWS - 1 },
      ]),
      this.rasterizeWaterPath([
        { column: 0, row: northernRow },
        { column: 8, row: northernRow },
        { column: 14, row: northernRow + 6 },
        { column: 14, row: northernRow + 10 },
      ]),
      this.rasterizeWaterPath([
        { column: southernColumn, row: WORLD_ROWS - 1 },
        { column: southernColumn, row: 33 },
        { column: southernColumn - 5, row: 28 },
        { column: 6, row: 28 },
      ]),
    ];
  }

  private rasterizeWaterPath(waypoints: readonly WaterPathCell[]): WaterPathCell[] {
    const path: WaterPathCell[] = [];
    for (let index = 1; index < waypoints.length; index += 1) {
      const start = waypoints[index - 1];
      const end = waypoints[index];
      const steps = Math.max(Math.abs(end.column - start.column), Math.abs(end.row - start.row));
      for (let step = 0; step <= steps; step += 1) {
        const cell = {
          column: Math.round(start.column + ((end.column - start.column) * step) / steps),
          row: Math.round(start.row + ((end.row - start.row) * step) / steps),
        };
        const previous = path.at(-1);
        if (!previous || previous.column !== cell.column || previous.row !== cell.row) path.push(cell);
      }
    }
    return path;
  }

  private buildWaterFlowMap(): ReadonlyMap<string, WaterFlow> {
    const flows = new Map<string, WaterFlow>();
    for (const path of this.waterPaths) {
      for (let index = 0; index < path.length; index += 1) {
        const previous = path[Math.max(0, index - 1)];
        const next = path[Math.min(path.length - 1, index + 1)];
        flows.set(cellKey(path[index].column, path[index].row), {
          x: Math.sign(next.column - previous.column),
          y: Math.sign(next.row - previous.row),
        });
      }
    }
    return flows;
  }

  private waterStyle(flow: WaterFlow | undefined): {
    frame: number;
    angle: number;
    flipX: boolean;
    displayWidth: number;
    displayHeight: number;
  } {
    const displayWidth = WORLD_TILE_SIZE + 10;
    if (!flow) return { frame: 12, angle: 0, flipX: false, displayWidth, displayHeight: displayWidth };
    if (flow.x !== 0 && flow.y !== 0) {
      return {
        frame: 12,
        angle: flow.x * flow.y > 0 ? -45 : 45,
        flipX: false,
        displayWidth,
        displayHeight: WORLD_TILE_SIZE * Math.SQRT2 + 10,
      };
    }
    return {
      frame: 12,
      angle: flow.x !== 0 ? 90 : 0,
      flipX: false,
      displayWidth,
      displayHeight: displayWidth,
    };
  }

  private flowingWaterArea(cell: WorldCell): WaterArea {
    const center = this.getCellCenter(cell.column, cell.row);
    if (cell.waterFlow?.x && !cell.waterFlow.y) {
      return { x: cell.column * WORLD_TILE_SIZE, y: center.y, width: WORLD_TILE_SIZE, height: 0, kind: 'flowing' };
    }
    if (cell.waterFlow?.y && !cell.waterFlow.x) {
      return { x: center.x, y: cell.row * WORLD_TILE_SIZE, width: 0, height: WORLD_TILE_SIZE, kind: 'flowing' };
    }
    return { x: center.x, y: center.y, width: 0, height: 0, kind: 'flowing' };
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
