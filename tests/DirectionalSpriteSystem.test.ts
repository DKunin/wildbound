import { describe, expect, it } from 'vitest';
import { resolveDirectionalFacing, resolvePlayerFacing } from '../src/game/systems/DirectionalSpriteSystem';

describe('continuous animal facing', () => {
  it('selects all eight compass directions', () => {
    const vectors = [
      [1, 0, 'E'], [1, 1, 'SE'], [0, 1, 'S'], [-1, 1, 'SW'],
      [-1, 0, 'W'], [-1, -1, 'NW'], [0, -1, 'N'], [1, -1, 'NE'],
    ] as const;
    for (const [x, y, compass] of vectors) expect(resolveDirectionalFacing(x, y).compass).toBe(compass);
  });

  it('uses a base animation with at most a 45 degree visual turn', () => {
    for (let degrees = 0; degrees < 360; degrees += 5) {
      const radians = degrees * Math.PI / 180;
      expect(Math.abs(resolveDirectionalFacing(Math.cos(radians), Math.sin(radians)).rotation)).toBeLessThanOrEqual(Math.PI / 4 + 0.0001);
    }
  });

  it('maps the player to eight hand-drawn directions without rotating the artwork', () => {
    const vectors = [
      [1, 0, 'east'], [1, 1, 'southeast'], [0, 1, 'south'], [-1, 1, 'southwest'],
      [-1, 0, 'west'], [-1, -1, 'northwest'], [0, -1, 'north'], [1, -1, 'northeast'],
    ] as const;
    for (const [x, y, direction] of vectors) {
      expect(resolvePlayerFacing(x, y)).toMatchObject({ animationDirection: direction, rotation: 0 });
    }
  });
});
