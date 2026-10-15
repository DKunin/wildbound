import { describe, expect, it } from 'vitest';
import { findEscapePath, type EscapeGrid } from '../src/game/systems/PreyEscapeSystem';

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
});
