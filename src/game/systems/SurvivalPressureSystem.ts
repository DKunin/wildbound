import type { PreySpecies } from '../entities/Prey';

export interface HuntLocation {
  x: number;
  y: number;
  simulationMinutes: number;
  species: PreySpecies;
}

export const LEAN_DAY_CYCLE = 3;
export const OVERHUNTED_RADIUS = 1_600;
export const OVERHUNTED_KILL_THRESHOLD = 2;
export const HUNT_PRESSURE_LIFETIME_MINUTES = 2 * 24 * 60;

export const getDayNumber = (simulationMinutes: number): number => Math.floor(Math.max(0, simulationMinutes) / 1_440) + 1;

export const isLeanDay = (simulationMinutes: number): boolean => getDayNumber(simulationMinutes) % LEAN_DAY_CYCLE === 0;

export const isMigrationWindow = (simulationMinutes: number): boolean => {
  const minute = ((simulationMinutes % 1_440) + 1_440) % 1_440;
  return (minute >= 5 * 60 && minute < 7 * 60) || (minute >= 18 * 60 && minute < 20 * 60);
};

export class RegionalHuntPressureSystem {
  private kills: HuntLocation[] = [];

  record(kill: HuntLocation): void {
    this.prune(kill.simulationMinutes);
    this.kills.push({ ...kill });
  }

  isOverhunted(point: { x: number; y: number }, simulationMinutes: number): boolean {
    this.prune(simulationMinutes);
    return this.kills.filter((kill) => Math.hypot(kill.x - point.x, kill.y - point.y) <= OVERHUNTED_RADIUS).length
      >= OVERHUNTED_KILL_THRESHOLD;
  }

  recent(simulationMinutes: number): HuntLocation[] {
    this.prune(simulationMinutes);
    return this.kills.map((kill) => ({ ...kill }));
  }

  restore(kills: readonly HuntLocation[], simulationMinutes: number): void {
    this.kills = kills
      .filter((kill) => Number.isFinite(kill.x) && Number.isFinite(kill.y) && Number.isFinite(kill.simulationMinutes)
        && (kill.species === 'rabbit' || kill.species === 'deer' || kill.species === 'elk' || kill.species === 'boar'))
      .map((kill) => ({ ...kill, simulationMinutes: Math.min(kill.simulationMinutes, simulationMinutes) }));
    this.prune(simulationMinutes);
  }

  private prune(simulationMinutes: number): void {
    const cutoff = simulationMinutes - HUNT_PRESSURE_LIFETIME_MINUTES;
    this.kills = this.kills.filter((kill) => kill.simulationMinutes > cutoff);
  }
}
