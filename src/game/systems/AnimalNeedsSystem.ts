export type AnimalSpecies = 'rabbit' | 'deer';
export type AnimalGoal = 'food' | 'water' | 'shelter' | 'explore';
export type AnimalActivity = 'idle' | 'moving' | 'foraging' | 'drinking' | 'resting';

export interface AnimalNeedsSnapshot {
  hunger: number;
  thirst: number;
  fatigue: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

export class AnimalNeedsSystem {
  private hunger: number;
  private thirst: number;
  private fatigue: number;

  constructor(
    private readonly species: AnimalSpecies,
    initial: AnimalNeedsSnapshot = { hunger: 34, thirst: 28, fatigue: 24 },
  ) {
    this.hunger = clamp(initial.hunger);
    this.thirst = clamp(initial.thirst);
    this.fatigue = clamp(initial.fatigue);
  }

  update(deltaSeconds: number, activity: AnimalActivity): AnimalNeedsSnapshot {
    const elapsed = Math.max(0, Math.min(deltaSeconds, 0.25));
    const moving = activity === 'moving';
    this.hunger = clamp(this.hunger + elapsed * (moving ? 0.62 : 0.42));
    this.thirst = clamp(this.thirst + elapsed * (this.species === 'deer' ? (moving ? 0.78 : 0.56) : (moving ? 0.3 : 0.18)));
    this.fatigue = clamp(this.fatigue + elapsed * (moving ? 0.72 : 0.2));

    if (activity === 'foraging') {
      this.hunger = clamp(this.hunger - elapsed * 10);
      if (this.species === 'rabbit') this.thirst = clamp(this.thirst - elapsed * 1.8);
    } else if (activity === 'drinking') {
      this.thirst = clamp(this.thirst - elapsed * 13);
    } else if (activity === 'resting') {
      this.fatigue = clamp(this.fatigue - elapsed * 8.5);
    }
    return this.snapshot();
  }

  chooseGoal(simulationMinutes: number, explorationRoll: number): AnimalGoal {
    if (this.thirst >= (this.species === 'rabbit' ? 92 : 78)) return 'water';
    if (this.hunger >= 78) return 'food';
    if (this.fatigue >= 82) return 'shelter';

    const hour = (simulationMinutes / 60) % 24;
    const crepuscular = (hour >= 5 && hour < 9) || (hour >= 16 && hour < 21);
    const foodScore = this.hunger + (crepuscular ? 22 : 5);
    const waterScore = this.thirst * (this.species === 'rabbit' ? 0.48 : 1) + (crepuscular ? 5 : 0);
    const shelterScore = this.fatigue + (crepuscular ? -6 : 18);
    const strongest = Math.max(foodScore, waterScore, shelterScore);

    if (strongest < 42 && explorationRoll < 0.12) return 'explore';
    if (foodScore >= waterScore && foodScore >= shelterScore) return 'food';
    return waterScore >= shelterScore ? 'water' : 'shelter';
  }

  isSatisfied(goal: AnimalGoal): boolean {
    if (goal === 'food') return this.hunger <= 24;
    if (goal === 'water') return this.thirst <= 18;
    if (goal === 'shelter') return this.fatigue <= 17;
    return true;
  }

  snapshot(): AnimalNeedsSnapshot {
    return { hunger: this.hunger, thirst: this.thirst, fatigue: this.fatigue };
  }
}
