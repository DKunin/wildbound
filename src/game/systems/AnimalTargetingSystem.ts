import type { PreySpecies } from '../entities/Prey';

export interface AnimalTargetCandidate {
  x: number;
  y: number;
  active: boolean;
  species: PreySpecies;
  isDead(): boolean;
}

const CLICK_RADIUS: Record<PreySpecies, number> = {
  rabbit: 48,
  deer: 78,
  elk: 92,
  boar: 86,
};

export const ANIMAL_TARGET_LOST_TIMEOUT_MS = 8_000;

export type AnimalTargetTrackingState = 'tracking' | 'searching' | 'lost';

export class AnimalTargetTracker {
  private lostSince?: number;

  update(time: number, detectable: boolean): AnimalTargetTrackingState {
    if (detectable) {
      this.lostSince = undefined;
      return 'tracking';
    }
    this.lostSince ??= time;
    return time - this.lostSince >= ANIMAL_TARGET_LOST_TIMEOUT_MS ? 'lost' : 'searching';
  }

  reset(): void {
    this.lostSince = undefined;
  }
}

export const isAnimalTargetAlive = <Target extends AnimalTargetCandidate>(animal: Target | undefined): animal is Target =>
  Boolean(animal?.active && !animal.isDead());

export const findClickedAnimal = <Target extends AnimalTargetCandidate>(
  point: { x: number; y: number },
  candidates: readonly Target[],
): Target | undefined => {
  let nearest: { animal: Target; distance: number } | undefined;
  for (const animal of candidates) {
    if (!isAnimalTargetAlive(animal)) continue;
    const distance = Math.hypot(animal.x - point.x, animal.y - point.y);
    if (distance > CLICK_RADIUS[animal.species]) continue;
    if (!nearest || distance < nearest.distance) nearest = { animal, distance };
  }
  return nearest?.animal;
};
