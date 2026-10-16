import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYER_DIRECTIONS } from '../src/game/systems/DirectionalSpriteSystem';
import { getPlayerAnimationKey, type PlayerAnimationState } from '../src/game/systems/PlayerAnimationSystem';
import {
  getPlayerWoundTextureSelection,
  getPreyMaxHealth,
  getPreyWoundLevel,
  getRuntimeWoundTextureKeys,
  getWoundCompositionPlan,
  getWoundManifestSheet,
  getWoundRenderSignature,
  getWoundTierTextureKey,
  parseWoundManifest,
  PLAYER_WOUND_RUNTIME_TEXTURE_KEY,
  stripWoundTextureSuffix,
  type WoundManifestSheet,
  type WoundedLevel,
} from '../src/game/systems/WoundTextureSystem';

const manifest = parseWoundManifest(JSON.parse(readFileSync(
  new URL('../public/assets/wounds-v1/manifest.json', import.meta.url),
  'utf8',
)) as unknown);

const PLAYER_STATES: readonly PlayerAnimationState[] = [
  'idle',
  'walking',
  'crouching',
  'sneaking',
  'running',
  'laying-down',
  'resting',
  'getting-up',
  'attacking',
  'eating',
  'drinking',
  'burying',
];

const createCompositionSheet = (): WoundManifestSheet => ({
  file: 'test-wounds.png',
  source: 'test.png',
  width: 200,
  sourceHeight: 100,
  frameWidth: 100,
  frameHeight: 100,
  columns: 2,
  rows: 1,
  placementsByLevel: [
    [{ x: 10, y: 20, width: 30, height: 40, mirror: false, clip: [0, 0, 100, 100] }],
    [{ x: 110, y: 22, width: 32, height: 38, mirror: true, clip: [100, 0, 100, 100] }],
    [{ x: 112, y: 24, width: 36, height: 42, mirror: false, clip: [100, 0, 100, 100] }],
  ],
});

describe('wound texture contract', () => {
  it('selects every generated wolf and prey manifest sheet by its original source', () => {
    expect(manifest.spritesheets).toHaveLength(88);
    expect(getWoundManifestSheet(manifest, 'wolf-south-motion.png')).toMatchObject({
      width: 1_385,
      sourceHeight: 1_136,
      frameWidth: 346,
      frameHeight: 284,
    });
    expect(getWoundManifestSheet(manifest, 'deer-kick.png')).toMatchObject({
      width: 724,
      sourceHeight: 1_448,
      frameWidth: 181,
      frameHeight: 181,
    });
    expect(getWoundManifestSheet(manifest, 'elk-atlas.png')).toMatchObject({
      frameWidth: 181,
      frameHeight: 181,
    });
    expect(getWoundManifestSheet(manifest, 'boar-actions.png')).toMatchObject({
      frameWidth: 181,
      frameHeight: 181,
    });
    expect(getWoundManifestSheet(manifest, 'boar-charge.png')).toMatchObject({
      columns: 4,
      rows: 8,
      frameWidth: 181,
      frameHeight: 181,
    });
    expect(() => getWoundManifestSheet(manifest, 'missing.png')).toThrow('Wound manifest is missing missing.png');
  });

  it('turns placements into clipped, base-alpha-masked decal operations', () => {
    expect(getWoundCompositionPlan(createCompositionSheet(), 2)).toEqual([{
      destination: [110, 22, 32, 38],
      clip: [100, 0, 100, 100],
      decalSource: [96, 0, 96, 96],
      baseAlphaSource: [110, 22, 32, 38],
      mirror: true,
    }]);
  });

  it('maps every wounded player state, direction, carry mode, and tier to one reusable texture input', () => {
    const manifestSources = new Set(manifest.spritesheets.map((sheet) => sheet.source));
    const uniqueBaseSheets = new Set<string>();
    const uniqueRenderSignatures = new Set<string>();
    for (const direction of PLAYER_DIRECTIONS) {
      for (const state of PLAYER_STATES) {
        for (const carrying of [false, true]) {
          const selection = getPlayerWoundTextureSelection(state, direction, carrying);
          expect(manifestSources.has(selection.manifestSource)).toBe(true);
          uniqueBaseSheets.add(selection.baseTextureKey);
          const sheet = getWoundManifestSheet(manifest, selection.manifestSource);
          for (const level of [1, 2, 3] as const) {
            uniqueRenderSignatures.add(getWoundRenderSignature(selection.baseTextureKey, sheet, level));
            const animationKey = getPlayerAnimationKey(state, direction, carrying, level);
            expect(stripWoundTextureSuffix(animationKey)).toBe(getPlayerAnimationKey(state, direction, carrying));
          }
        }
      }
    }
    expect(uniqueBaseSheets).toHaveLength(80);
    expect(uniqueRenderSignatures).toHaveLength(80 * 3);
    expect(getPlayerWoundTextureSelection('attacking', 'north', true)).toEqual({
      baseTextureKey: 'wolf-north-action',
      manifestSource: 'wolf-north-action.png',
    });
    expect(getPlayerWoundTextureSelection('burying', 'north', true)).toEqual({
      baseTextureKey: 'wolf-north-bury',
      manifestSource: 'wolf-north-bury.png',
    });
  });

  it('bounds registered wound canvases to one reusable wolf sheet and all prey wound tiers', () => {
    const keys = getRuntimeWoundTextureKeys();
    expect(keys).toHaveLength(25);
    expect(new Set(keys)).toHaveLength(25);
    expect(keys.filter((key) => key === PLAYER_WOUND_RUNTIME_TEXTURE_KEY)).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith('deer'))).toHaveLength(9);
    expect(keys.filter((key) => key.startsWith('elk'))).toHaveLength(6);
    expect(keys.filter((key) => key.startsWith('boar'))).toHaveLength(9);
    expect(keys.some((key) => key.includes('wounds-mask'))).toBe(false);
  });

  it('keeps healthy texture keys compatible and normalizes wounded keys for progress matching', () => {
    expect(getWoundTierTextureKey('deer-actions', 0)).toBe('deer-actions');
    expect(getWoundTierTextureKey('deer-actions', 3)).toBe('deer-actions-wound-3');
    expect(stripWoundTextureSuffix('player-north-carry-run-wound-2')).toBe('player-north-carry-run');
    expect(stripWoundTextureSuffix('player-north-carry-run')).toBe('player-north-carry-run');
  });

  it('uses a distinct redraw signature for every source or wound-level change', () => {
    const selection = getPlayerWoundTextureSelection('walking', 'east', false);
    const sheet = getWoundManifestSheet(manifest, selection.manifestSource);
    const signatures = ([1, 2, 3] as readonly WoundedLevel[]).map((level) => (
      getWoundRenderSignature(selection.baseTextureKey, sheet, level)
    ));
    expect(new Set(signatures)).toHaveLength(3);
    const carried = getPlayerWoundTextureSelection('walking', 'east', true);
    expect(getWoundRenderSignature(
      carried.baseTextureKey,
      getWoundManifestSheet(manifest, carried.manifestSource),
      1,
    )).not.toBe(signatures[0]);
  });

  it('advances woundable prey through every tier before death while rabbits remain healthy', () => {
    expect(getPreyMaxHealth('deer')).toBe(4);
    expect([4, 3, 2, 1].map((health) => getPreyWoundLevel('deer', health))).toEqual([0, 1, 2, 3]);
    expect(getPreyMaxHealth('rabbit')).toBe(1);
    expect(getPreyWoundLevel('rabbit', 1)).toBe(0);
    expect(getPreyMaxHealth('elk')).toBe(5);
    expect([5, 4, 3, 2, 1].map((health) => getPreyWoundLevel('elk', health))).toEqual([0, 1, 1, 2, 3]);
    expect(getPreyMaxHealth('boar')).toBe(5);
    expect([5, 4, 3, 2, 1].map((health) => getPreyWoundLevel('boar', health))).toEqual([0, 1, 1, 2, 3]);
  });
});
