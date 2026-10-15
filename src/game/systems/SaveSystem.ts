import type { NeedsSnapshot } from './NeedsSystem';
import type { PreySpecies } from '../entities/Prey';

export interface SavedAnimal {
  species: PreySpecies;
  x: number;
  y: number;
}

export interface SavedPackWolf {
  name: 'Niva' | 'Torr';
  x: number;
  y: number;
  hunger: number;
}

export interface SaveData {
  version: 3;
  worldSeed: string;
  savedAt: number;
  simulationTime: number;
  player: { x: number; y: number };
  needs: NeedsSnapshot;
  prey: SavedAnimal[];
  pack: SavedPackWolf[];
  scentActive: boolean;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPosition = (value: unknown): value is { x: number; y: number } => {
  if (!value || typeof value !== 'object') return false;
  const position = value as { x?: unknown; y?: unknown };
  return isFiniteNumber(position.x) && isFiniteNumber(position.y);
};

export const isSaveData = (value: unknown): value is SaveData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SaveData>;
  return data.version === 3
    && typeof data.worldSeed === 'string'
    && data.worldSeed.length > 0
    && isFiniteNumber(data.savedAt)
    && isFiniteNumber(data.simulationTime)
    && isPosition(data.player)
    && Array.isArray(data.prey)
    && data.prey.every((animal) => (animal.species === 'rabbit' || animal.species === 'deer') && isPosition(animal))
    && Array.isArray(data.pack)
    && data.pack.every((wolf) => (wolf.name === 'Niva' || wolf.name === 'Torr') && isPosition(wolf) && isFiniteNumber(wolf.hunger))
    && typeof data.scentActive === 'boolean'
    && isFiniteNumber(data.needs?.health)
    && isFiniteNumber(data.needs.hunger)
    && isFiniteNumber(data.needs.thirst)
    && isFiniteNumber(data.needs.stamina)
    && typeof data.needs.alive === 'boolean';
};

export class SaveSystem {
  private readonly databaseName = 'wildbound';
  private readonly storeName = 'saves';
  private readonly key = 'pine-ridge-2026-autosave';

  async save(data: SaveData): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      localStorage.setItem(this.key, JSON.stringify(data));
      return;
    }
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).put(data, this.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save the game.'));
    });
    database.close();
  }

  async load(): Promise<SaveData | undefined> {
    if (typeof indexedDB === 'undefined') {
      const raw = localStorage.getItem(this.key);
      if (!raw) return undefined;
      const parsed: unknown = JSON.parse(raw);
      return isSaveData(parsed) ? parsed : undefined;
    }
    const database = await this.openDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(this.key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to load the game.'));
    });
    database.close();
    return isSaveData(value) ? value : undefined;
  }

  async clear(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      localStorage.removeItem(this.key);
      return;
    }
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).delete(this.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to clear the save.'));
    });
    database.close();
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) database.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open the save database.'));
    });
  }
}
