import { EnduranceSystem } from './EnduranceSystem';
import { advanceSimulationTime } from './WorldTimeSystem';

export type AnimalSpecies = 'rabbit' | 'deer' | 'elk' | 'boar';
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
  elk: {
    sprintDrainPerSecond: 6.2,
    recoveryDebtPerSecond: 0.55,
    minimumSprintSpeedFactor: 0.46,
    depletedSprintSpeedFactor: 0.72,
    strainSpeedRetentionPerPoint: 0.9962,
  },
  boar: {
    sprintDrainPerSecond: 8.8,
    recoveryDebtPerSecond: 0.7,
    minimumSprintSpeedFactor: 0.5,
    depletedSprintSpeedFactor: 0.7,
    strainSpeedRetentionPerPoint: 0.996,
  },
} as const;

const NEED_RATES = {
  rabbit: { hungerIdle: 0.11, hungerMoving: 0.18, thirstIdle: 0.06, thirstMoving: 0.1 },
  deer: { hungerIdle: 0.12, hungerMoving: 0.2, thirstIdle: 0.16, thirstMoving: 0.24 },
  elk: { hungerIdle: 0.14, hungerMoving: 0.23, thirstIdle: 0.18, thirstMoving: 0.27 },
  boar: { hungerIdle: 0.15, hungerMoving: 0.24, thirstIdle: 0.18, thirstMoving: 0.28 },
} as const;

type RestWindow = readonly [startMinutes: number, endMinutes: number];

const REST_WINDOWS: Record<AnimalSpecies, readonly RestWindow[]> = {
  rabbit: [[8 * 60 + 30, 16 * 60 + 30]],
  deer: [[2 * 60 + 30, 4 * 60 + 30], [10 * 60, 15 * 60]],
  elk: [[10 * 60 + 30, 15 * 60 + 30]],
  boar: [[8 * 60 + 30, 17 * 60]],
};

const MINUTES_PER_DAY = 24 * 60;
const normalizeDayMinutes = (minutes: number): number => (
  ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
);

const isInsideRestWindow = (minutes: number, [start, end]: RestWindow): boolean => (
  start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
);

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
    private readonly circadianOffsetMinutes = 0,
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
      const exhaustionDamage = (exhaustion - 0.88) * (this.species === 'rabbit' ? 0.8 : 0.65);
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

  advanceTimeFollowingSchedule(
    deltaSeconds: number,
    startSimulationMinutes: number,
    initialActivity: AnimalActivity,
  ): AnimalNeedsSnapshot {
    let remaining = Math.max(0, deltaSeconds);
    let elapsed = 0;
    while (remaining > 0 && this.isAlive()) {
      const step = Math.min(remaining, 0.25);
      const simulationMinutes = advanceSimulationTime(startSimulationMinutes, elapsed);
      const activity = elapsed < 5
        ? initialActivity
        : this.shouldRest(simulationMinutes)
          ? 'resting'
          : 'idle';
      this.update(step, activity);
      remaining -= step;
      elapsed += step;
    }
    return this.snapshot();
  }

  chooseGoal(simulationMinutes: number, explorationRoll: number): AnimalGoal {
    const urgentGoal = this.getUrgentGoal();
    if (urgentGoal) return urgentGoal;
    if (this.shouldRest(simulationMinutes)) return 'shelter';
    const endurance = this.endurance.snapshot();
    if (this.fatigue >= 82 || endurance.stamina < 42 || endurance.recoveryDebt > 72) return 'shelter';

    const hour = (simulationMinutes / 60) % 24;
    const crepuscular = (hour >= 5 && hour < 9) || (hour >= 16 && hour < 21);
    const boarActive = this.species === 'boar' && (hour >= 17 || hour < 7);
    const feedingPeriod = crepuscular || boarActive;
    const foodScore = this.hunger + (feedingPeriod ? 22 : 5);
    const waterScore = this.thirst * (this.species === 'rabbit' ? 0.48 : this.species === 'boar' ? 1.12 : 1)
      + (feedingPeriod ? 5 : 0);
    const shelterScore = this.fatigue + (feedingPeriod ? -6 : 18);
    const strongest = Math.max(foodScore, waterScore, shelterScore);

    if (strongest < 42 && explorationRoll < 0.12) return 'explore';
    if (foodScore >= waterScore && foodScore >= shelterScore) return 'food';
    return waterScore >= shelterScore ? 'water' : 'shelter';
  }

  isSatisfied(goal: AnimalGoal, simulationMinutes?: number): boolean {
    if (goal === 'food') return this.hunger <= 24;
    if (goal === 'water') return this.thirst <= 18;
    if (goal === 'shelter') {
      if (simulationMinutes !== undefined) {
        if (this.getUrgentGoal()) return true;
        if (this.shouldRest(simulationMinutes)) return false;
      }
      const endurance = this.endurance.snapshot();
      return this.fatigue <= 17 && endurance.stamina >= 92 && endurance.recoveryDebt <= 12;
    }
    return true;
  }

  shouldRest(simulationMinutes: number): boolean {
    if (this.getUrgentGoal()) return false;
    const localMinutes = normalizeDayMinutes(simulationMinutes - this.circadianOffsetMinutes);
    return REST_WINDOWS[this.species].some((window) => isInsideRestWindow(localMinutes, window));
  }

  private getUrgentGoal(): 'food' | 'water' | undefined {
    if (this.thirst >= (this.species === 'rabbit' ? 74 : 58)) return 'water';
    if (this.hunger >= 60) return 'food';
    return undefined;
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
