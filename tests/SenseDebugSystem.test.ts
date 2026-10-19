import { describe, expect, it } from 'vitest';
import { buildSenseDebugCues, getSenseDebugKinds } from '../src/game/systems/SenseDebugSystem';
import { SENSE_DIRECTIONS, type SenseKind } from '../src/game/systems/SenseHudSystem';

describe('senses interface debug fixture', () => {
  it('covers every source kind and fixed compass slot', () => {
    const kinds: SenseKind[] = ['rabbit', 'deer', 'elk', 'boar', 'pack', 'carcass', 'cache', 'territory', 'water'];
    const cues = buildSenseDebugCues();

    expect(getSenseDebugKinds()).toEqual(new Set(kinds));
    expect(new Set(cues.map(({ direction }) => direction))).toEqual(new Set(SENSE_DIRECTIONS));
    expect(cues.some(({ targeted }) => targeted)).toBe(true);
    expect(cues.some(({ count }) => count > 1)).toBe(true);
  });

  it('isolates scent, hearing, and marked states without changing the fixture', () => {
    const scentOnly = buildSenseDebugCues('scent', 0.5);
    const hearingOnly = buildSenseDebugCues('hearing');
    const markedOnly = buildSenseDebugCues('marked');

    expect(scentOnly.every(({ hearingStrength, strength, scentStrength }) => (
      hearingStrength === 0 && strength === scentStrength
    ))).toBe(true);
    expect(hearingOnly.every(({ scentStrength, strength, hearingStrength }) => (
      scentStrength === 0 && strength === hearingStrength
    ))).toBe(true);
    expect(markedOnly).toHaveLength(1);
    expect(markedOnly[0]).toMatchObject({ kind: 'deer', direction: 'NE', targeted: true });
    expect(buildSenseDebugCues()[0].strength).toBe(0.62);
  });

  it('clamps boosted clarity to the supported signal range', () => {
    const cues = buildSenseDebugCues('all', 2);
    expect(cues.every(({ strength, scentStrength, hearingStrength }) => (
      strength <= 1 && scentStrength <= 1 && hearingStrength <= 1
    ))).toBe(true);
  });
});
