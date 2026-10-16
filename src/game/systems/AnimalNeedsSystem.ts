import { EnduranceSystem } from './EnduranceSystem';

export type AnimalSpecies = 'rabbit' | 'deer';
export type AnimalGoal = 'food' | 'water' | 'shelter' | 'explore';
export type AnimalActivity = 'idle' | 'moving' | 'fleeing' | 'foraging' | 'drinking' | 'resting';
export type AnimalDeathCause = 'starvation' | 'thirst' | 'exhaustion';

export interface AnimalNeedsSnapshot {
  hunger: number;
  thirst: number;
  fatigue: number;
  stamina: number;
  recoveryDebt: number;
  health: number;
  alive: boolean;
  deathCause?: AnimalDeathCause;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const ENDURANCE_BY_SPECIES = {
  rabbit: {
    sprintDrainPerSecond: 11,
    recoveryDebtPerSecond: 3.8,
    minimumSprintSpeedFactor: 0.55,
    depletedSprintSpeedFactor: 0.7,
  },
  deer: {
    sprintDrainPerSecond: 7.5,
    recoveryDebtPerSecond: 0.45,
    minimumSprintSpeedFactor: 0.48,
    depletedSprintSpeedFactor: 0.78,
    strainSpeedRetentionPerPoint: 0.99645,
  },
} as const;

const NEED_RATES = {
  rabbit: { hungerIdle: 0.11, hungerMoving: 0.18, thirstIdle: 0.06, thirstMoving: 0.1 },
  deer: { hungerIdle: 0.12, hungerMoving: 0.2, thirstIdle: 0.16, thirstMoving: 0.24 },
} as const;

export class AnimalNeedsSystem {
  private hunger: number;
  private thirst: number;
  private fatigue: number;
  private health: number;
  private deathCause?: AnimalDeathCause;
  private readonly endurance: EnduranceSystem;

  constructor(
    private readonly species: AnimalSpecies,
    initial: Partial<AnimalNeedsSnapshot> = {},
  ) {
    this.hunger = clamp(initial.hunger ?? 34);
    this.thirst = clamp(initial.thirst ?? 28);
    this.fatigue = clamp(initial.fatigue ?? 24);
    this.health = clamp(initial.health ?? 100);
    this.deathCause = initial.deathCause;
    this.endurance = new EnduranceSystem(initial, ENDURANCE_BY_SPECIES[species]);
  }

  update(deltaSeconds: number, activity: AnimalActivity): AnimalNeedsSnapshot {
    if (!this.isAlive()) return this.snapshot();
    const elapsed = Math.max(0, Math.min(deltaSeconds, 0.25));
    const fleeing = activity === 'fleeing';
    const moving = activity === 'moving' || fleeing;
    this.endurance.update(elapsed, fleeing
      ? 'sprinting'
      : activity === 'resting'
        ? 'resting'
        : moving
          ? 'moving'
          : 'idle');
    const exhaustion = this.endurance.getExhaustionLoad();
    const hungerStrain = 1 + exhaustion * 0.8;
    const thirstStrain = 1 + exhaustion * 1.25;
    const rates = NEED_RATES[this.species];
    this.hunger = clamp(this.hunger + elapsed * (moving ? rates.hungerMoving : rates.hungerIdle) * hungerStrain);
    this.thirst = clamp(this.thirst + elapsed * (moving ? rates.thirstMoving : rates.thirstIdle) * thirstStrain);
    this.fatigue = clamp(this.fatigue + elapsed * (fleeing ? 1.8 : moving ? 0.72 : 0.2));

    if (activity === 'foraging') {
      this.hunger = clamp(this.hunger - elapsed * 12);
      if (this.species === 'rabbit') this.thirst = clamp(this.thirst - elapsed * 2.2);
    } else if (activity === 'drinking') {
      this.thirst = clamp(this.thirst - elapsed * 16);
    } else if (activity === 'resting') {
      this.fatigue = clamp(this.fatigue - elapsed * 8.5);
    }

    if (this.hunger > 97) this.health = clamp(this.health - elapsed * (this.hunger - 96) * 0.018);
    if (this.thirst > 97) this.health = clamp(this.health - elapsed * (this.thirst - 96) * 0.028);
    if (activity !== 'resting' && exhaustion > 0.88) {
      const exhaustionDamage = (exhaustion - 0.88) * (this.species === 'deer' ? 0.65 : 0.8);
      this.health = clamp(this.health - elapsed * exhaustionDamage);
    } else if (activity === 'resting' && this.hunger < 88 && this.thirst < 88) {
      this.health = clamp(this.health + elapsed * 0.32);
    }

    if (this.health <= 0) {
      if (this.thirst >= this.hunger && this.thirst > 97) this.deathCause = 'thirst';
      else if (this.hunger > 97) this.deathCause = 'starvation';
      else this.deathCause = 'exhaustion';
    }
    return this.snapshot();
  }

  advanceTime(deltaSeconds: number, activity: AnimalActivity): AnimalNeedsSnapshot {
    let remaining = Math.max(0, deltaSeconds);
    while (remaining > 0 && this.isAlive()) {
      const step = Math.min(remaining, 0.25);
      this.update(step, activity);
      remaining -= step;
    }
    return this.snapshot();
  }

  chooseGoal(simulationMinutes: number, explorationRoll: number): AnimalGoal {
    if (this.thirst >= (this.species === 'rabbit' ? 74 : 58)) return 'water';
    if (this.hunger >= 60) return 'food';
    const endurance = this.endurance.snapshot();
    if (this.fatigue >= 82 || endurance.stamina < 42 || endurance.recoveryDebt > 72) return 'shelter';

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
    if (goal === 'shelter') {
      const endurance = this.endurance.snapshot();
      return this.fatigue <= 17 && endurance.stamina >= 92 && endurance.recoveryDebt <= 12;
    }
    return true;
  }

  getSprintSpeedFactor(): number {
    return this.endurance.getSprintSpeedFactor();
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  getDeathCause(): AnimalDeathCause | undefined {
    return this.deathCause;
  }

  snapshot(): AnimalNeedsSnapshot {
    const endurance = this.endurance.snapshot();
    return {
      hunger: this.hunger,
      thirst: this.thirst,
      fatigue: this.fatigue,
      stamina: endurance.stamina,
      recoveryDebt: endurance.recoveryDebt,
      health: this.health,
      alive: this.isAlive(),
      deathCause: this.deathCause,
    };
  }
}
