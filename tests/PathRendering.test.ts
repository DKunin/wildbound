import { describe, expect, it } from 'vitest';
import { getPathRenderPieces } from '../src/game/systems/PathRendering';
import type { PathConnections } from '../src/game/systems/ProceduralWorld';

const connections = (active: readonly (keyof PathConnections)[]): PathConnections => ({
  north: active.includes('north'),
  northEast: active.includes('northEast'),
  east: active.includes('east'),
  southEast: active.includes('southEast'),
  south: active.includes('south'),
  southWest: active.includes('southWest'),
  west: active.includes('west'),
  northWest: active.includes('northWest'),
});

describe('path rendering', () => {
  it('uses complete atlas tiles for straight cardinal and diagonal roads', () => {
    expect(getPathRenderPieces(connections(['west', 'east']))).toEqual([
      { frame: 8, cropX: 0, cropY: 0, cropWidth: 313, cropHeight: 313 },
    ]);
    expect(getPathRenderPieces(connections(['north', 'south']))[0].frame).toBe(9);
    expect(getPathRenderPieces(connections(['northEast', 'southWest']))[0].frame).toBe(10);
    expect(getPathRenderPieces(connections(['northWest', 'southEast']))[0].frame).toBe(11);
  });

  it('joins diagonal and cardinal arms through one shared center for bends and junctions', () => {
    const bend = getPathRenderPieces(connections(['west', 'northEast']));
    expect(bend.map((piece) => piece.frame)).toEqual([8, 10, 8]);
    expect(bend.at(-1)).toMatchObject({ cropX: 70, cropY: 70, cropWidth: 173, cropHeight: 173 });

    const junction = getPathRenderPieces(connections(['north', 'east', 'southWest']));
    expect(junction.map((piece) => piece.frame)).toEqual([8, 9, 10, 8]);
    expect(junction).toHaveLength(4);
  });
});
