import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSaveData, normalizeSaveData, SaveSystem, type SaveData } from '../src/game/systems/SaveSystem';

const installLocalStorage = (savedValue: string | null = null) => {
  const storage = {
    getItem: vi.fn(() => savedValue),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  } as unknown as Storage;
  vi.stubGlobal('localStorage', storage);
  return storage;
};

const installIndexedDb = () => {
  const deleteRecord = vi.fn();
  const close = vi.fn();
  const transaction = {
    error: null,
    oncomplete: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    objectStore: vi.fn(() => ({
      delete: (key: IDBValidKey) => {
        deleteRecord(key);
        queueMicrotask(() => transaction.oncomplete?.({} as Event));
      },
    })),
  };
  const database = {
    close,
    transaction: vi.fn(() => transaction),
  } as unknown as IDBDatabase;
  const open = vi.fn(() => {
    const request = {
      result: database,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
    };
    queueMicrotask(() => request.onsuccess?.({} as Event));
    return request as unknown as IDBOpenDBRequest;
  });
  vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);
  return { close, deleteRecord, open };
};

afterEach(() => vi.unstubAllGlobals());

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
    expect(isSaveData({
      ...valid,
      difficulty: 'survival',
      prey: [{ species: 'deer', x: 1_500, y: 600, health: 2 }],
      huntPressure: [{ species: 'deer', x: 1_480, y: 620, simulationMinutes: 1_100 }],
    })).toBe(true);
    expect(isSaveData({ ...valid, prey: [{ species: 'elk', x: 2_400, y: 700, health: 4 }] })).toBe(true);
    expect(isSaveData({ ...valid, prey: [{ species: 'boar', x: 1_900, y: 1_100, health: 4 }] })).toBe(true);
    expect(isSaveData({ ...valid, huntPressure: [{ species: 'boar', x: 10, y: 20, simulationMinutes: 100 }] })).toBe(true);
  });

  it('normalizes legacy version-four saves to the original Explorer balance', async () => {
    expect(normalizeSaveData(valid)?.difficulty).toBe('explorer');
    expect(normalizeSaveData({ ...valid, difficulty: 'survival' })?.difficulty).toBe('survival');

    vi.stubGlobal('indexedDB', undefined);
    installLocalStorage(JSON.stringify(valid));
    await expect(new SaveSystem().load()).resolves.toMatchObject({ difficulty: 'explorer' });
  });

  it('persists exposed carrion plus buried and carried meat caches', () => {
    expect(isSaveData({
      ...valid,
      prey: [
        { species: 'deer', x: 410, y: 720, carcass: { meat: 65, state: 'exposed' } },
        { species: 'rabbit', x: 610, y: 890, carcass: { meat: 21, state: 'carried' } },
        { species: 'deer', x: 1_200, y: 700, carcass: { meat: 84, state: 'buried' } },
        { species: 'elk', x: 1_800, y: 900, carcass: { meat: 95, state: 'exposed' } },
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
    expect(isSaveData({ ...valid, difficulty: 'nightmare' })).toBe(false);
    expect(isSaveData({ ...valid, prey: [{ species: 'deer', x: 10, y: 20, health: 0 }] })).toBe(false);
    expect(isSaveData({ ...valid, huntPressure: [{ species: 'bear', x: 10, y: 20, simulationMinutes: 100 }] })).toBe(false);
  });

  it('clears the local-storage fallback when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const storage = installLocalStorage();

    await new SaveSystem().clear();

    expect(storage.removeItem).toHaveBeenCalledWith('pine-ridge-expanded-2026-autosave');
  });

  it('clears both IndexedDB and a stale local-storage fallback', async () => {
    const storage = installLocalStorage();
    const database = installIndexedDb();

    await new SaveSystem().clear();

    expect(storage.removeItem).toHaveBeenCalledWith('pine-ridge-expanded-2026-autosave');
    expect(database.open).toHaveBeenCalledWith('wildbound', 1);
    expect(database.deleteRecord).toHaveBeenCalledWith('pine-ridge-expanded-2026-autosave');
    expect(database.close).toHaveBeenCalledOnce();
  });
});
