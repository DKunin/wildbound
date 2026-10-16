import { describe, expect, it } from 'vitest';
import { isSaveData, type SaveData } from '../src/game/systems/SaveSystem';

describe('procedural-world save validation', () => {
  const valid: SaveData = {
    version: 4,
    worldSeed: 'pine-ridge-expanded-2026',
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
    expect(isSaveData({ ...valid, territoryMarks: [{ x: 410, y: 720, createdAt: 1_100, ownerId: 'player', color: 0x78d98b }] })).toBe(true);
  });

  it('persists exposed carrion plus buried and carried meat caches', () => {
    expect(isSaveData({
      ...valid,
      prey: [
        { species: 'deer', x: 410, y: 720, carcass: { meat: 65, state: 'exposed' } },
        { species: 'rabbit', x: 610, y: 890, carcass: { meat: 21, state: 'carried' } },
        { species: 'deer', x: 1_200, y: 700, carcass: { meat: 84, state: 'buried' } },
      ],
    })).toBe(true);
  });

  it('rejects older or incomplete save records', () => {
    expect(isSaveData({ ...valid, version: 3 })).toBe(false);
    expect(isSaveData({ ...valid, worldSeed: '' })).toBe(false);
    expect(isSaveData({ ...valid, player: { x: 'wrong', y: 1 } })).toBe(false);
    expect(isSaveData({ ...valid, pack: undefined })).toBe(false);
    expect(isSaveData({ ...valid, prey: [{ species: 'bear', x: 10, y: 20 }] })).toBe(false);
    expect(isSaveData({ ...valid, prey: [{ species: 'deer', x: 10, y: 20, carcass: { meat: 0, state: 'buried' } }] })).toBe(false);
    expect(isSaveData({ ...valid, prey: [{ species: 'deer', x: 10, y: 20, carcass: { meat: 10, state: 'hidden' } }] })).toBe(false);
    expect(isSaveData({ ...valid, pack: [{ name: 'Niva', x: 10, y: 20, hunger: Number.NaN }] })).toBe(false);
    expect(isSaveData({ ...valid, needs: { ...valid.needs, thirst: 'unknown' } })).toBe(false);
    expect(isSaveData({ ...valid, needs: { ...valid.needs, recoveryDebt: Number.NaN } })).toBe(false);
    expect(isSaveData({ ...valid, pack: [{ ...valid.pack[0], stamina: 'tired' }] })).toBe(false);
    expect(isSaveData({ ...valid, territoryMarks: [{ x: 10, y: 20, createdAt: Number.NaN }] })).toBe(false);
    expect(isSaveData({ ...valid, territoryMarks: [{ x: 10, y: 20, createdAt: 100, color: 0x1000000 }] })).toBe(false);
  });
});
