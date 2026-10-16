import type { PreySpecies } from '../entities/Prey';
import { BALANCE_PROFILES, type BalanceProfile } from './BalanceConfig';

export interface PopulationCounts {
  rabbit: number;
  deer: number;
  elk: number;
  boar: number;
}

export interface PopulationContext {
  biomass?: PopulationCounts;
  lean?: boolean;
  migrationOpen?: boolean;
}

export class PopulationSystem {
  private readonly nextSpawn = new Map<PreySpecies, number>();

  constructor(private readonly profile: BalanceProfile = BALANCE_PROFILES.explorer) {}

  update(time: number, living: PopulationCounts, context: PopulationContext = {}): PreySpecies[] {
    const result: PreySpecies[] = [];
    const desired = this.getDesired(context.lean);
    const biomass = context.biomass ?? living;
    for (const species of ['rabbit', 'deer', 'elk', 'boar'] as const) {
      if (living[species] >= desired[species] || biomass[species] >= desired[species]) {
        this.nextSpawn.delete(species);
        continue;
      }
      const scheduled = this.nextSpawn.get(species);
      if (scheduled === undefined) {
        this.nextSpawn.set(species, time + this.profile.population.respawnDelayMs[species]);
      } else if (time >= scheduled && context.migrationOpen !== false) {
        result.push(species);
        this.nextSpawn.set(species, time + this.profile.population.respawnDelayMs[species]);
      }
    }
    return result;
  }

  getDesired(lean = false): PopulationCounts {
    const scale = lean ? this.profile.population.leanScale : 1;
    return {
      rabbit: Math.max(1, Math.round(this.profile.population.desired.rabbit * scale)),
      deer: Math.max(1, Math.round(this.profile.population.desired.deer * scale)),
      elk: Math.max(1, Math.round(this.profile.population.desired.elk * scale)),
      boar: Math.max(1, Math.round(this.profile.population.desired.boar * scale)),
    };
  }
}
