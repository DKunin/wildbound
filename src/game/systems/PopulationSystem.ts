import type { PreySpecies } from '../entities/Prey';

export interface PopulationCounts {
  rabbit: number;
  deer: number;
}

export class PopulationSystem {
  private readonly desired: PopulationCounts = { rabbit: 20, deer: 22 };
  private readonly nextSpawn = new Map<PreySpecies, number>();

  update(time: number, living: PopulationCounts): PreySpecies[] {
    const result: PreySpecies[] = [];
    for (const species of ['rabbit', 'deer'] as const) {
      if (living[species] >= this.desired[species]) {
        this.nextSpawn.delete(species);
        continue;
      }
      const scheduled = this.nextSpawn.get(species);
      if (scheduled === undefined) {
        this.nextSpawn.set(species, time + (species === 'rabbit' ? 18_000 : 32_000));
      } else if (time >= scheduled) {
        result.push(species);
        this.nextSpawn.set(species, time + (species === 'rabbit' ? 12_000 : 24_000));
      }
    }
    return result;
  }

  getDesired(): PopulationCounts {
    return { ...this.desired };
  }
}
