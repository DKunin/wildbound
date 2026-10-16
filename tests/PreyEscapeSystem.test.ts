import { describe, expect, it } from 'vitest';
import { constrainEscapeHeading, findEscapePath, type EscapeGrid } from '../src/game/systems/PreyEscapeSystem';

const grid = (columns: number, rows: number, blocked: readonly string[] = []): EscapeGrid => {
  const blockedCells = new Set(blocked);
  return {
    columns,
    rows,
    tileSize: 1,
    isPassable: (column, row) => column >= 0 && row >= 0 && column < columns && row < rows
      && !blockedCells.has(`${column},${row}`),
  };
};

const cell = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });

describe('prey escape routing', () => {
  it('routes around a wall instead of continuing to push directly away from the predator', () => {
    const wall = Array.from({ length: 7 }, (_, index) => `4,${index + 1}`);
    const route = findEscapePath(cell(3, 4), cell(2, 4), grid(9, 9, wall), 8);

    expect(route.length).toBeGreaterThan(4);
    expect(route.every((point) => !wall.includes(`${Math.floor(point.x)},${Math.floor(point.y)}`))).toBe(true);
    expect(route.at(-1)!.x).toBeGreaterThan(4);
  });

  it('turns along the boundary instead of choosing a dead corner as its destination', () => {
    const route = findEscapePath(cell(1, 1), cell(3, 3), grid(9, 9), 7);
    const destination = route.at(-1)!;
    const destinationColumn = Math.floor(destination.x);
    const destinationRow = Math.floor(destination.y);

    expect(route.length).toBeGreaterThan(0);
    expect((destinationColumn === 0 || destinationColumn === 8)
      && (destinationRow === 0 || destinationRow === 8)).toBe(false);
  });

  it('never cuts diagonally through the closed corner of two obstacles', () => {
    const blocked = ['2,1', '1,2'];
    const route = findEscapePath(cell(1, 1), cell(0, 0), grid(6, 6, blocked), 6);

    expect(route[0]).not.toEqual(cell(2, 2));
    expect(route.every((point) => !blocked.includes(`${Math.floor(point.x)},${Math.floor(point.y)}`))).toBe(true);
  });

  it('uses individual lateral preferences to fan escape routes out', () => {
    const start = cell(5, 5);
    const threat = cell(2, 5);
    const clockwise = findEscapePath(start, threat, grid(14, 14), 6, { lateralBias: 1 });
    const counterClockwise = findEscapePath(start, threat, grid(14, 14), 6, { lateralBias: -1 });

    expect(clockwise.at(-1)!.y).toBeGreaterThan(start.y);
    expect(counterClockwise.at(-1)!.y).toBeLessThan(start.y);
    expect(clockwise.at(-1)!.x).toBeGreaterThan(start.x);
    expect(counterClockwise.at(-1)!.x).toBeGreaterThan(start.x);
  });

  it('constrains a route waypoint to the half-plane away from the predator', () => {
    const start = { x: 10, y: 10 };
    const threat = { x: 5, y: 10 };
    const away = { x: 1, y: 0 };

    for (const preferred of [
      { x: -1, y: 0 },
      { x: -1, y: 0.4 },
      { x: 0, y: -1 },
      { x: 0, y: 0 },
    ]) {
      const heading = constrainEscapeHeading(start, threat, preferred);
      expect(Math.hypot(heading.x, heading.y)).toBeCloseTo(1);
      expect(heading.x * away.x + heading.y * away.y).toBeGreaterThanOrEqual(0.2 - Number.EPSILON);
    }
  });
});
