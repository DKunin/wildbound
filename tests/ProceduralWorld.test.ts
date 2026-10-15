import { describe, expect, it } from 'vitest';
import { ProceduralWorld, WORLD_HEIGHT, WORLD_WIDTH } from '../src/game/systems/ProceduralWorld';

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
    expect(WORLD_WIDTH).toBe(6_144);
    expect(WORLD_HEIGHT).toBe(6_144);
    const waterCells = world.cells.filter((cell) => cell.water);
    expect(waterCells.length).toBeGreaterThan(30);
    expect(world.getWaterAreas()).toHaveLength(waterCells.length);
    expect(world.getWaterPaths()).toHaveLength(3);
    expect(world.getWaterPaths().every((path) => path.length >= 5)).toBe(true);
    expect(waterCells.some((cell) => cell.column < 9 && cell.row < 10)).toBe(true);
    expect(waterCells.some((cell) => cell.column < 15 && cell.row > 17)).toBe(true);
    expect(world.getCell(world.spawnCell.column, world.spawnCell.row)?.water).toBe(false);
    expect(world.cells.some((cell) => cell.ground === 'path')).toBe(true);
    expect(world.cells.some((cell) => cell.obstacle?.kind === 'tree')).toBe(true);
    expect(world.cells.some((cell) => cell.obstacle?.kind === 'mountain')).toBe(true);
  });

  it('routes around blocked terrain to an open destination', () => {
    const world = new ProceduralWorld();
    const start = world.getSpawnPoint();
    const destination = world.findOpenPositionNear({ x: WORLD_WIDTH - 700, y: 700 });
    const path = world.findPath(start, destination);
    expect(path.length).toBeGreaterThan(2);
    expect(path.every((point) => !world.getCellAt(point)?.blocked)).toBe(true);
  });

  it('exposes open food, water-bank, shelter, and exploration habitat for both prey species', () => {
    const world = new ProceduralWorld();
    for (const species of ['rabbit', 'deer'] as const) {
      const habitat = world.getHabitatResources(species);
      for (const resources of [habitat.food, habitat.water, habitat.shelter, habitat.explore]) {
        expect(resources.length).toBeGreaterThan(0);
        expect(resources.every((point) => {
          const cell = world.getCellAt(point);
          return cell !== undefined && !cell.blocked && !cell.water;
        })).toBe(true);
      }
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
