import { describe, expect, it } from 'vitest';
import { isSaveData, type SaveData } from '../src/game/systems/SaveSystem';

describe('procedural-world save validation', () => {
  const valid: SaveData = {
    version: 3,
    worldSeed: 'pine-ridge-2026',
    savedAt: 123,
    simulationTime: 1_122,
    player: { x: 600, y: 900 },
    needs: { health: 95, hunger: 42, thirst: 37, stamina: 80, alive: true },
    prey: [{ species: 'deer', x: 1_500, y: 600 }],
    pack: [{ name: 'Niva', x: 500, y: 800, hunger: 40 }],
    scentActive: true,
  };

  it('accepts a current Phase 2 snapshot', () => {
    expect(isSaveData(valid)).toBe(true);
  });

  it('rejects older or incomplete save records', () => {
    expect(isSaveData({ ...valid, version: 2 })).toBe(false);
    expect(isSaveData({ ...valid, worldSeed: '' })).toBe(false);
    expect(isSaveData({ ...valid, player: { x: 'wrong', y: 1 } })).toBe(false);
    expect(isSaveData({ ...valid, pack: undefined })).toBe(false);
    expect(isSaveData({ ...valid, prey: [{ species: 'bear', x: 10, y: 20 }] })).toBe(false);
    expect(isSaveData({ ...valid, pack: [{ name: 'Niva', x: 10, y: 20, hunger: Number.NaN }] })).toBe(false);
    expect(isSaveData({ ...valid, needs: { ...valid.needs, thirst: 'unknown' } })).toBe(false);
  });
});
