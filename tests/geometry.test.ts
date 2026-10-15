import { describe, expect, it } from 'vitest';
import { distanceToArea, distanceToAreas, distanceToPath, distanceToSegment } from '../src/game/systems/geometry';

describe('water path geometry', () => {
  it('measures distance to the nearest point on a segment', () => {
    expect(distanceToSegment({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
    expect(distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('selects the nearest section of a path', () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distanceToPath({ x: 7, y: 6 }, path)).toBe(3);
  });

  it('treats an empty path as unreachable', () => {
    expect(distanceToPath({ x: 0, y: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('water area geometry', () => {
  const area = { x: 10, y: 20, width: 30, height: 40 };

  it('returns zero inside water and distance from its nearest edge outside', () => {
    expect(distanceToArea({ x: 25, y: 35 }, area)).toBe(0);
    expect(distanceToArea({ x: 5, y: 35 }, area)).toBe(5);
    expect(distanceToArea({ x: 46, y: 68 }, area)).toBe(10);
  });

  it('uses the nearest of multiple water areas', () => {
    expect(distanceToAreas({ x: 105, y: 110 }, [area, { x: 100, y: 100, width: 20, height: 20 }])).toBe(0);
    expect(distanceToAreas({ x: 0, y: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
