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
    expect(WORLD_WIDTH).toBe(8_192);
    expect(WORLD_HEIGHT).toBe(8_192);
    const waterCells = world.cells.filter((cell) => cell.water);
    expect(waterCells.length).toBeGreaterThan(40);
    expect(world.getFlowingWaterAreas()).toHaveLength(waterCells.length);
    expect(world.getPuddleAreas()).toHaveLength(12);
    expect(world.getWaterAreas()).toHaveLength(waterCells.length + world.getPuddleAreas().length);
    expect(world.getWaterPaths()).toHaveLength(3);
    expect(world.getWaterPaths().every((path) => path.length >= 5)).toBe(true);
    expect(waterCells.some((cell) => cell.column < 12 && cell.row < 15)).toBe(true);
    expect(waterCells.some((cell) => cell.column < 20 && cell.row > 22)).toBe(true);
    expect(world.getCell(world.spawnCell.column, world.spawnCell.row)?.water).toBe(false);
    expect(world.cells.some((cell) => cell.ground === 'path')).toBe(true);
    expect(new Set(world.cells.flatMap((cell) => cell.obstacle?.kind ?? [])).size).toBe(6);
    expect(new Set(world.cells.flatMap((cell) => cell.decorations.map((decoration) => decoration.kind))).size).toBeGreaterThanOrEqual(4);
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
