import { describe, expect, it } from 'vitest';
import { PLAYER_DIRECTIONS } from '../src/game/systems/DirectionalSpriteSystem';
import { WOUND_LEVELS } from '../src/game/systems/HuntBalanceSystem';
import {
  ensurePreyAnimationReady,
  getPreyAnimationFrames,
  getPreyAnimationKey,
  getPreyAnimationSpeedScale,
  getPreyAnimationTextureKey,
  getPreyDeathWoundLevel,
  hasPreyRetaliationAnimation,
  PREY_ANIMATION_SETTINGS,
  PREY_RETALIATION_DURATION_MS,
  shouldPreservePreyGaitProgress,
  type PreyAnimationReadinessAdapter,
} from '../src/game/systems/PreyAnimationSystem';
import preyAnimationContract from '../src/game/data/prey-animation-contract.json';

const DIRECTION_COLUMNS = {
  east: 0,
  northeast: 1,
  north: 2,
  northwest: 3,
  west: 4,
  southwest: 5,
  south: 6,
  southeast: 7,
} as const;

describe('prey animation atlas mapping', () => {
  it('maps every state in all eight hand-drawn directions', () => {
    const allFrames = new Set<number>();
    for (const direction of PLAYER_DIRECTIONS) {
      expect(getPreyAnimationFrames(direction, 'idle')).toHaveLength(2);
      expect(getPreyAnimationFrames(direction, 'walk')).toHaveLength(2);
      expect(getPreyAnimationFrames(direction, 'flee')).toHaveLength(4);
      expect(getPreyAnimationFrames(direction, 'resting')).toEqual([0, 1, 2, 3]
        .map((row) => row * 8 + DIRECTION_COLUMNS[direction]));
      expect(getPreyAnimationFrames(direction, 'foraging')).toEqual([4, 5, 6, 7]
        .map((row) => row * 8 + DIRECTION_COLUMNS[direction]));
      expect(getPreyAnimationFrames(direction, 'drinking')).toEqual([8, 9, 10, 11]
        .map((row) => row * 8 + DIRECTION_COLUMNS[direction]));
      expect(getPreyAnimationFrames(direction, 'retaliating')).toHaveLength(4);
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
    for (const species of ['rabbit', 'deer', 'elk', 'boar'] as const) {
      expect(getPreyAnimationTextureKey(species, 'idle')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'walk')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'flee')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'dead')).toBe(species);
      expect(getPreyAnimationTextureKey(species, 'foraging')).toBe(`${species}-actions`);
      expect(getPreyAnimationTextureKey(species, 'drinking')).toBe(`${species}-actions`);
      expect(getPreyAnimationTextureKey(species, 'resting')).toBe(`${species}-actions`);
    }
    expect(getPreyAnimationTextureKey('deer', 'retaliating')).toBe('deer-kick');
    expect(getPreyAnimationTextureKey('boar', 'retaliating')).toBe('boar-charge');
    expect(getPreyAnimationTextureKey('elk', 'foraging')).toBe('elk-actions');
  });

  it('uses contract timing and availability for every prey state', () => {
    for (const [state, settings] of Object.entries(preyAnimationContract.states)) {
      expect(PREY_ANIMATION_SETTINGS[state as keyof typeof PREY_ANIMATION_SETTINGS]).toEqual({
        frameRate: settings.frameRate,
        repeat: settings.repeat,
      });
    }
    expect(hasPreyRetaliationAnimation('rabbit')).toBe(false);
    expect(hasPreyRetaliationAnimation('deer')).toBe(true);
    expect(hasPreyRetaliationAnimation('elk')).toBe(false);
    expect(hasPreyRetaliationAnimation('boar')).toBe(true);
  });

  it('maps every deer direction and state to all wound-tier animation and texture keys', () => {
    const states = ['idle', 'walk', 'flee', 'foraging', 'drinking', 'resting', 'retaliating', 'dead'] as const;
    for (const direction of PLAYER_DIRECTIONS) {
      for (const state of states) {
        for (const woundLevel of WOUND_LEVELS) {
          const woundSuffix = woundLevel === 0 ? '' : `-wound-${woundLevel}`;
          const texture = state === 'retaliating'
            ? 'deer-kick'
            : state === 'foraging' || state === 'drinking' || state === 'resting'
              ? 'deer-actions'
              : 'deer';
          expect(getPreyAnimationKey('deer', direction, state, woundLevel))
            .toBe(`deer-${direction}-${state}${woundSuffix}`);
          expect(getPreyAnimationTextureKey('deer', state, woundLevel))
            .toBe(`${texture}${woundSuffix}`);
        }
      }
    }
  });

  it('keeps rabbits on healthy animation and texture keys for every requested wound tier', () => {
    const states = ['idle', 'walk', 'flee', 'foraging', 'drinking', 'resting', 'retaliating', 'dead'] as const;
    for (const direction of PLAYER_DIRECTIONS) {
      for (const state of states) {
        const texture = state === 'foraging' || state === 'drinking' || state === 'resting' ? 'rabbit-actions' : 'rabbit';
        for (const woundLevel of WOUND_LEVELS) {
          expect(getPreyAnimationKey('rabbit', direction, state, woundLevel)).toBe(`rabbit-${direction}-${state}`);
          expect(getPreyAnimationTextureKey('rabbit', state, woundLevel)).toBe(texture);
        }
      }
    }
  });

  it('maps elk and boar to their generated wound-tier atlases', () => {
    for (const species of ['elk', 'boar'] as const) {
      const states = species === 'boar'
        ? ['idle', 'walk', 'flee', 'foraging', 'drinking', 'resting', 'retaliating', 'dead'] as const
        : ['idle', 'walk', 'flee', 'foraging', 'drinking', 'resting', 'dead'] as const;
      for (const direction of PLAYER_DIRECTIONS) {
        for (const state of states) {
          const texture = state === 'foraging' || state === 'drinking' || state === 'resting'
            ? `${species}-actions`
            : state === 'retaliating' ? 'boar-charge' : species;
          for (const woundLevel of WOUND_LEVELS) {
            const woundSuffix = woundLevel === 0 ? '' : `-wound-${woundLevel}`;
            expect(getPreyAnimationKey(species, direction, state, woundLevel))
              .toBe(`${species}-${direction}-${state}${woundSuffix}`);
            expect(getPreyAnimationTextureKey(species, state, woundLevel)).toBe(`${texture}${woundSuffix}`);
          }
        }
      }
    }
  });

  it('keeps terminal wounds visible on every multi-hit prey carcass', () => {
    expect(getPreyDeathWoundLevel('rabbit')).toBe(0);
    expect(getPreyDeathWoundLevel('deer')).toBe(3);
    expect(getPreyDeathWoundLevel('elk')).toBe(3);
    expect(getPreyDeathWoundLevel('boar')).toBe(3);
  });

  it('materializes wounded prey textures lazily before registering animations and reuses them', () => {
    const textures = new Set([
      'rabbit', 'rabbit-actions',
      'deer', 'deer-actions', 'deer-kick',
      'elk', 'elk-actions',
      'boar', 'boar-actions', 'boar-charge',
    ]);
    const animations = new Set<string>();
    const events: string[] = [];
    const adapter: PreyAnimationReadinessAdapter = {
      textureExists: (textureKey) => textures.has(textureKey),
      materializeWoundTexture: ({ baseTextureKey, targetTextureKey, level }) => {
        expect(textures.has(baseTextureKey)).toBe(true);
        events.push(`texture:${targetTextureKey}:${level}`);
        textures.add(targetTextureKey);
      },
      animationExists: (animationKey) => animations.has(animationKey),
      registerAnimation: ({ key, textureKey }) => {
        expect(textures.has(textureKey)).toBe(true);
        events.push(`animation:${key}`);
        animations.add(key);
      },
    };

    expect(ensurePreyAnimationReady(adapter, 'deer', 'north', 'idle', 0)).toBe(true);
    expect(events).toEqual(['animation:deer-north-idle']);
    expect([...textures].some((textureKey) => textureKey.includes('-wound-'))).toBe(false);
    events.length = 0;

    expect(ensurePreyAnimationReady(adapter, 'deer', 'north', 'foraging', 2)).toBe(true);
    expect(events).toEqual([
      'texture:deer-actions-wound-2:2',
      'animation:deer-north-foraging-wound-2',
    ]);

    expect(ensurePreyAnimationReady(adapter, 'deer', 'north', 'foraging', 2)).toBe(false);
    expect(events).toHaveLength(2);

    expect(ensurePreyAnimationReady(adapter, 'deer', 'north', 'drinking', 2)).toBe(true);
    expect(events.slice(2)).toEqual(['animation:deer-north-drinking-wound-2']);
    expect(textures.has('deer-wound-2')).toBe(false);
    expect(textures.has('deer-kick-wound-2')).toBe(false);

    expect(ensurePreyAnimationReady(adapter, 'boar', 'east', 'retaliating', 3)).toBe(true);
    expect(events.slice(-2)).toEqual([
      'texture:boar-charge-wound-3:3',
      'animation:boar-east-retaliating-wound-3',
    ]);
  });

  it('requires synchronous wound materialization before animation registration', () => {
    const events: string[] = [];
    const adapter: PreyAnimationReadinessAdapter = {
      textureExists: (textureKey) => textureKey === 'deer',
      materializeWoundTexture: ({ targetTextureKey }) => events.push(`texture:${targetTextureKey}`),
      animationExists: () => false,
      registerAnimation: ({ key }) => events.push(`animation:${key}`),
    };

    expect(() => ensurePreyAnimationReady(adapter, 'deer', 'south', 'dead', 3))
      .toThrow('Prey animation texture deer-wound-3 is not ready');
    expect(events).toEqual(['texture:deer-wound-3']);
  });

  it('maps deer retaliation to four unique frames for every direction', () => {
    const frames = PLAYER_DIRECTIONS.flatMap((direction) => getPreyAnimationFrames(direction, 'retaliating'));
    expect([...frames].sort((left, right) => left - right)).toEqual(Array.from({ length: 32 }, (_value, index) => index));
  });

  it('maps the dedicated boar counter-charge to four exact directional poses', () => {
    for (const direction of PLAYER_DIRECTIONS) {
      const frames = getPreyAnimationFrames(direction, 'retaliating', 'boar');
      expect(frames).toEqual([0, 1, 2, 3]
        .map((phase) => DIRECTION_COLUMNS[direction] * 4 + phase));
    }
  });

  it('scales locomotion cadence with actual movement speed without freezing injured animals', () => {
    expect(getPreyAnimationSpeedScale('flee', 205, 205)).toBe(1);
    expect(getPreyAnimationSpeedScale('flee', 123, 205)).toBeCloseTo(0.6);
    expect(getPreyAnimationSpeedScale('flee', 20, 205)).toBe(0.52);
    expect(getPreyAnimationSpeedScale('walk', 28, 28)).toBe(1);
    expect(getPreyAnimationSpeedScale('walk', 14, 28)).toBe(0.64);
    expect(getPreyAnimationSpeedScale('idle', 0, 28)).toBe(1);
  });

  it('preserves gait phase across walk, flee, and directional animation changes', () => {
    expect(shouldPreservePreyGaitProgress('walk', 'walk')).toBe(true);
    expect(shouldPreservePreyGaitProgress('walk', 'flee')).toBe(true);
    expect(shouldPreservePreyGaitProgress('flee', 'walk')).toBe(true);
    expect(shouldPreservePreyGaitProgress('flee', 'flee')).toBe(true);
    expect(shouldPreservePreyGaitProgress('idle', 'walk')).toBe(false);
    expect(shouldPreservePreyGaitProgress(undefined, 'flee')).toBe(false);
  });

  it('fits the four-frame retaliation cycle exactly into 800ms', () => {
    expect(PREY_RETALIATION_DURATION_MS).toBe(800);
  });
});
