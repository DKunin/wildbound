import { describe, expect, it } from 'vitest';
import { PLAYER_DIRECTIONS } from '../src/game/systems/DirectionalSpriteSystem';
import { getPreyAnimationFrames, getPreyAnimationKey, getPreyAnimationTextureKey } from '../src/game/systems/PreyAnimationSystem';

describe('prey animation atlas mapping', () => {
  it('maps every state in all eight hand-drawn directions', () => {
    const allFrames = new Set<number>();
    for (const direction of PLAYER_DIRECTIONS) {
      expect(getPreyAnimationFrames(direction, 'idle')).toHaveLength(2);
      expect(getPreyAnimationFrames(direction, 'walk')).toHaveLength(2);
      expect(getPreyAnimationFrames(direction, 'flee')).toHaveLength(4);
      expect(getPreyAnimationFrames(direction, 'foraging')).toHaveLength(3);
      expect(getPreyAnimationFrames(direction, 'drinking')).toHaveLength(3);
      expect(getPreyAnimationFrames(direction, 'resting')).toHaveLength(1);
      expect(getPreyAnimationFrames(direction, 'dead')).toHaveLength(1);
      for (const state of ['idle', 'walk', 'flee', 'dead'] as const) {
        for (const frame of getPreyAnimationFrames(direction, state)) {
          expect(frame).toBeGreaterThanOrEqual(0);
          expect(frame).toBeLessThan(48);
          allFrames.add(frame);
        }
      }
    }
    expect(allFrames).toEqual(new Set(Array.from({ length: 48 }, (_value, index) => index)));
  });

  it('uses species, direction and state in animation keys', () => {
    expect(getPreyAnimationKey('rabbit', 'north', 'idle')).toBe('rabbit-north-idle');
    expect(getPreyAnimationKey('deer', 'southwest', 'dead')).toBe('deer-southwest-dead');
  });

  it('uses dedicated action artwork for eating, drinking and resting', () => {
    for (const species of ['rabbit', 'deer'] as const) {
      expect(getPreyAnimationTextureKey(species, 'idle')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'walk')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'flee')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'dead')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'foraging')).toBe(`${species}-actions`);
      expect(getPreyAnimationTextureKey(species, 'drinking')).toBe(`${species}-actions`);
      expect(getPreyAnimationTextureKey(species, 'resting')).toBe(`${species}-actions`);
    }
  });
});
