import { describe, expect, it } from 'vitest';
import {
  ProceduralWorld,
  WORLD_COLUMNS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_TILE_SIZE,
  WORLD_WIDTH,
} from '../src/game/systems/ProceduralWorld';

describe('procedural territory', () => {
  it('is deterministic for a fixed seed and changes with another seed', () => {
    const first = new ProceduralWorld('pine');
    const second = new ProceduralWorld('pine');
    const other = new ProceduralWorld('spruce');
    expect(first.cells).toEqual(second.cells);
    expect(first.cells).not.toEqual(other.cells);
  });

  it('creates a larger world with water, routes, and solid obstacles', () => {
    const world = new ProceduralWorld();
    expect(WORLD_WIDTH).toBe(10_240);
    expect(WORLD_HEIGHT).toBe(10_240);
    const waterCells = world.cells.filter((cell) => cell.water);
    expect(waterCells.length).toBeGreaterThan(40);
    expect(world.getFlowingWaterAreas()).toHaveLength(waterCells.length);
    expect(world.getPuddleAreas()).toHaveLength(12);
    expect(world.getWaterAreas()).toHaveLength(waterCells.length + world.getPuddleAreas().length + world.getWetlandAreas().length);
    expect(world.getWaterPaths()).toHaveLength(3);
    expect(world.getWaterPaths().every((path) => path.length >= 5)).toBe(true);
    expect(waterCells.some((cell) => cell.column < 12 && cell.row < 15)).toBe(true);
    expect(waterCells.some((cell) => cell.column < 20 && cell.row > 22)).toBe(true);
    expect(world.getCell(world.spawnCell.column, world.spawnCell.row)?.water).toBe(false);
    expect(world.cells.some((cell) => cell.ground === 'path')).toBe(true);
    expect(new Set(world.cells.flatMap((cell) => cell.obstacle?.kind ?? [])).size).toBe(6);
    expect(new Set(world.cells.flatMap((cell) => cell.decorations.map((decoration) => decoration.kind))).size).toBeGreaterThanOrEqual(4);
    expect(new Set(world.cells.flatMap((cell) => cell.feature?.kind ?? [])).size).toBe(4);
    expect(world.cells.filter((cell) => cell.column >= 32 || cell.row >= 32).some((cell) => cell.feature)).toBe(true);
  });

  it('builds connected rivers with vertical, horizontal, and diagonal flow art', () => {
    const world = new ProceduralWorld();
    const waterCells = world.cells.filter((cell) => cell.water);
    const orientations = new Set(waterCells.map((cell) => {
      if (cell.waterFlow?.x && cell.waterFlow.y) return 'diagonal';
      if (cell.waterFlow?.x) return 'horizontal';
      return 'vertical';
    }));

    expect(orientations).toEqual(new Set(['vertical', 'horizontal', 'diagonal']));
    expect(waterCells.every((cell) => cell.waterFlow && (cell.waterFlow.x !== 0 || cell.waterFlow.y !== 0))).toBe(true);
    expect(waterCells.filter((cell) => cell.waterFlow?.x && !cell.waterFlow.y)
      .every((cell) => cell.waterFrame === 12 && cell.waterAngle === 90)).toBe(true);
    expect(waterCells.filter((cell) => cell.waterFlow?.x && cell.waterFlow.y)
      .every((cell) => cell.waterFrame === 12
        && Math.abs(cell.waterAngle) === 45
        && cell.waterDisplayWidth === WORLD_TILE_SIZE + 10
        && Math.abs(cell.waterDisplayHeight - (Math.hypot(WORLD_TILE_SIZE, WORLD_TILE_SIZE) + 10)) < 0.001)).toBe(true);

    for (const path of world.getWaterPaths()) {
      for (let index = 1; index < path.length; index += 1) {
        const columnStep = Math.abs(path[index].x - path[index - 1].x) / WORLD_TILE_SIZE;
        const rowStep = Math.abs(path[index].y - path[index - 1].y) / WORLD_TILE_SIZE;
        expect(Math.max(columnStep, rowStep)).toBe(1);
      }
    }
  });

  it('builds one connected trail network with reciprocal cardinal and diagonal links', () => {
    const world = new ProceduralWorld();
    const pathCells = world.cells.filter((cell) => cell.ground === 'path');
    const opposite = {
      north: 'south',
      northEast: 'southWest',
      east: 'west',
      southEast: 'northWest',
      south: 'north',
      southWest: 'northEast',
      west: 'east',
      northWest: 'southEast',
    } as const;
    const offsets = {
      north: [0, -1],
      northEast: [1, -1],
      east: [1, 0],
      southEast: [1, 1],
      south: [0, 1],
      southWest: [-1, 1],
      west: [-1, 0],
      northWest: [-1, -1],
    } as const;

    expect(pathCells.length).toBeGreaterThan(60);
    expect(pathCells.some((cell) => Object.values(cell.pathConnections ?? {}).filter(Boolean).length >= 3)).toBe(true);
    expect(pathCells.some((cell) => cell.pathConnections?.northEast || cell.pathConnections?.southEast
      || cell.pathConnections?.southWest || cell.pathConnections?.northWest)).toBe(true);
    expect(pathCells.some((cell) => {
      const active = Object.keys(offsets).filter((direction) => cell.pathConnections?.[direction as keyof typeof offsets]);
      return active.length === 2 && opposite[active[0] as keyof typeof opposite] !== active[1];
    })).toBe(true);
    expect(pathCells.some((cell) => {
      const connections = cell.pathConnections;
      return connections && ((connections.north || connections.south) && (connections.east || connections.west))
        && Object.values(connections).filter(Boolean).length === 2;
    })).toBe(true);
    for (const cell of pathCells) {
      expect(cell.groundFrame).toBe(-1);
      expect(cell.pathConnections).toBeDefined();
      expect(Object.values(cell.pathConnections ?? {}).some(Boolean)).toBe(true);
      for (const direction of Object.keys(offsets) as Array<keyof typeof offsets>) {
        if (!cell.pathConnections?.[direction]) continue;
        const [columnOffset, rowOffset] = offsets[direction];
        const neighbor = world.getCell(cell.column + columnOffset, cell.row + rowOffset);
        expect(neighbor?.ground).toBe('path');
        expect(neighbor?.pathConnections?.[opposite[direction]]).toBe(true);
      }
    }

    const byPosition = new Map(pathCells.map((cell) => [`${cell.column},${cell.row}`, cell]));
    const visited = new Set<string>();
    const pending = [pathCells[0]];
    while (pending.length > 0) {
      const cell = pending.pop()!;
      const key = `${cell.column},${cell.row}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const direction of Object.keys(offsets) as Array<keyof typeof offsets>) {
        if (!cell.pathConnections?.[direction]) continue;
        const [columnOffset, rowOffset] = offsets[direction];
        const neighbor = byPosition.get(`${cell.column + columnOffset},${cell.row + rowOffset}`);
        if (neighbor) pending.push(neighbor);
      }
    }
    expect(visited.size).toBe(pathCells.length);
  });

  it('does not place the same landmark variant twice within two cells', () => {
    const world = new ProceduralWorld();
    for (const cell of world.cells) {
      if (cell.column === 0 || cell.row === 0 || cell.column === WORLD_COLUMNS - 1 || cell.row === WORLD_ROWS - 1) continue;
      for (const other of world.cells) {
        if (other === cell || other.row < cell.row || (other.row === cell.row && other.column <= cell.column)) continue;
        if (other.column === 0 || other.row === 0 || other.column === WORLD_COLUMNS - 1 || other.row === WORLD_ROWS - 1) continue;
        if (Math.abs(other.column - cell.column) > 2 || Math.abs(other.row - cell.row) > 2) continue;
        if (cell.obstacle && other.obstacle && cell.obstacle.kind === other.obstacle.kind) {
          expect(`${cell.obstacle.frame}:${cell.obstacle.flipX}`).not.toBe(`${other.obstacle.frame}:${other.obstacle.flipX}`);
        }
        if (cell.feature && other.feature && cell.feature.kind === other.feature.kind) {
          expect(`${cell.feature.frame}:${cell.feature.flipX}`).not.toBe(`${other.feature.frame}:${other.feature.flipX}`);
        }
      }
    }
  });

  it('keeps still puddles drinkable but out of the flowing-water sound set', () => {
    const world = new ProceduralWorld();
    const puddles = world.getPuddleAreas();
    expect(world.getFlowingWaterAreas().every((area) => area.kind === 'flowing')).toBe(true);
    expect(puddles.every((area) => area.kind === 'still')).toBe(true);
    expect(puddles.every((area) => {
      const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      const cell = world.getCellAt(center);
      return cell !== undefined && !cell.blocked && !cell.water;
    })).toBe(true);
    expect(puddles.filter((area) => area.width < 120)).toHaveLength(4);
    expect(puddles.filter((area) => area.width >= 120 && area.width < 210)).toHaveLength(4);
    expect(puddles.filter((area) => area.width >= 210)).toHaveLength(4);
    expect(Math.max(...puddles.map((area) => area.width)) - Math.min(...puddles.map((area) => area.width))).toBeGreaterThan(120);
    expect(puddles.every((area) => {
      const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      const cell = world.getCellAt(center);
      if (!cell) return false;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          const neighbor = world.getCell(cell.column + columnOffset, cell.row + rowOffset);
          if (!neighbor || neighbor.blocked || neighbor.water) return false;
        }
      }
      return true;
    })).toBe(true);
  });

  it('routes around blocked terrain to an open destination', () => {
    const world = new ProceduralWorld();
    const start = world.getSpawnPoint();
    const destination = world.findOpenPositionNear({ x: WORLD_WIDTH - 700, y: 700 });
    const path = world.findPath(start, destination);
    expect(path.length).toBeGreaterThan(2);
    expect(path.every((point) => !world.getCellAt(point)?.blocked)).toBe(true);
  });

  it('relocates a legacy save position that is blocked in the expanded layout', () => {
    const world = new ProceduralWorld();
    const legacyPosition = { x: 3_456, y: 1_152 };
    const legacyCell = world.getCellAt(legacyPosition);
    expect(legacyCell?.blocked || legacyCell?.water).toBe(true);

    const restored = world.findOpenPositionNear(legacyPosition);
    const restoredCell = world.getCellAt(restored);
    expect(restoredCell).toBeDefined();
    expect(restoredCell?.blocked).toBe(false);
    expect(restoredCell?.water).toBe(false);
  });

  it('builds escape routes through open, dry cells and away from a nearby threat', () => {
    const world = new ProceduralWorld();
    const start = world.findOpenPositionNear({ x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 });
    const threat = world.findOpenPositionNear({ x: start.x - 300, y: start.y });
    const path = world.findEscapePath(start, threat);

    expect(path.length).toBeGreaterThan(0);
    expect(path.every((point) => {
      const pathCell = world.getCellAt(point);
      return pathCell !== undefined && !pathCell.blocked && !pathCell.water;
    })).toBe(true);
    expect(Math.hypot(path.at(-1)!.x - threat.x, path.at(-1)!.y - threat.y))
      .toBeGreaterThan(Math.hypot(start.x - threat.x, start.y - threat.y));
  });

  it('exposes open food, water-bank, shelter, and exploration habitat for every prey species', () => {
    const world = new ProceduralWorld();
    for (const species of ['rabbit', 'deer', 'elk', 'boar'] as const) {
      const habitat = world.getHabitatResources(species);
      for (const resources of [habitat.food, habitat.water, habitat.shelter, habitat.explore]) {
        expect(resources.length).toBeGreaterThan(0);
        expect(resources.every((point) => {
          const cell = world.getCellAt(point);
          return cell !== undefined && !cell.blocked && !cell.water;
        })).toBe(true);
      }
      expect(habitat.food.length).toBeGreaterThan(species === 'rabbit' ? 250 : species === 'boar' ? 200 : 450);
    }
  });

  it('blocks sight through solid terrain cells', () => {
    const world = new ProceduralWorld();
    const obstacle = world.cells.find((cell) => cell.blocked && cell.column > 1 && cell.column < 22);
    expect(obstacle).toBeDefined();
    if (!obstacle) return;

    const center = world.getCellCenter(obstacle.column, obstacle.row);
    expect(world.hasLineOfSight(
      { x: center.x - 300, y: center.y },
      { x: center.x + 300, y: center.y },
    )).toBe(false);
    expect(world.hasLineOfSight(center, center)).toBe(true);
  });
});
