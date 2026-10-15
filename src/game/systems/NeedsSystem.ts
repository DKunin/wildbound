import { EnduranceSystem } from './EnduranceSystem';

export interface NeedActivity {
  moving: boolean;
  running: boolean;
  resting: boolean;
}

export type DeathCause = 'Thirst took you.' | 'Starvation took you.' | 'Exhaustion took you.' | 'Your injuries were too severe.';

export interface NeedsSnapshot {
  health: number;
  hunger: number;
  thirst: number;
  stamina: number;
  recoveryDebt?: number;
  alive: boolean;
  deathCause?: DeathCause;
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
export const SATIATED_HUNGER = 18;
export const HUNGER_EATING_THRESHOLD = 26;

export class NeedsSystem {
  private health = 100;
  private hunger = 32;
  private thirst = 25;
  private readonly endurance = new EnduranceSystem();
  private deathCause?: DeathCause;

  update(deltaSeconds: number, activity: NeedActivity): NeedsSnapshot {
    if (!this.isAlive()) return this.snapshot();

    this.endurance.update(deltaSeconds, activity.running
      ? 'sprinting'
      : activity.resting
        ? 'resting'
        : activity.moving
          ? 'moving'
          : 'idle');
    const exhaustion = this.endurance.getExhaustionLoad();
    const exertion = activity.running ? 1.85 : activity.moving ? 1.2 : 1;
    this.hunger = clamp(this.hunger + deltaSeconds * 0.1 * exertion * (1 + exhaustion * 0.8));
    this.thirst = clamp(this.thirst + deltaSeconds * 0.16 * exertion * (1 + exhaustion * 1.25));

    if (activity.resting && this.hunger < 82 && this.thirst < 82) {
      this.health = clamp(this.health + deltaSeconds * 0.65);
    }

    if (this.hunger > 88) this.health = clamp(this.health - deltaSeconds * (this.hunger - 86) * 0.055);
    if (this.thirst > 88) this.health = clamp(this.health - deltaSeconds * (this.thirst - 86) * 0.085);
    if (!activity.resting && exhaustion > 0.72) {
      this.health = clamp(this.health - deltaSeconds * (exhaustion - 0.72) * 2.1);
    }

    if (this.health <= 0) {
      if (this.thirst >= this.hunger && this.thirst > 88) this.deathCause = 'Thirst took you.';
      else if (this.hunger > 88) this.deathCause = 'Starvation took you.';
      else if (exhaustion > 0.72) this.deathCause = 'Exhaustion took you.';
      else this.deathCause = 'Your injuries were too severe.';
    }

    return this.snapshot();
  }

  feed(amount: number): NeedsSnapshot {
    const foodNeeded = this.getFoodNeed();
    const nourishment = Math.min(Math.max(0, amount), foodNeeded);
    this.hunger = clamp(this.hunger - nourishment);
    this.health = clamp(this.health + nourishment * 0.08);
    return this.snapshot();
  }

  canEat(): boolean {
    return this.hunger >= HUNGER_EATING_THRESHOLD;
  }

  getFoodNeed(): number {
    return this.canEat() ? Math.max(0, this.hunger - SATIATED_HUNGER) : 0;
  }

  drink(amount: number): NeedsSnapshot {
    this.thirst = clamp(this.thirst - amount);
    return this.snapshot();
  }

  injure(amount: number): NeedsSnapshot {
    this.health = clamp(this.health - amount);
    if (this.health <= 0) this.deathCause = 'Your injuries were too severe.';
    return this.snapshot();
  }

  restore(snapshot: NeedsSnapshot): NeedsSnapshot {
    this.health = clamp(snapshot.health);
    this.hunger = clamp(snapshot.hunger);
    this.thirst = clamp(snapshot.thirst);
    this.endurance.restore({ stamina: snapshot.stamina, recoveryDebt: snapshot.recoveryDebt });
    this.deathCause = snapshot.deathCause;
    return this.snapshot();
  }

  canRun(): boolean {
    return this.endurance.canSprint() && this.isAlive();
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  snapshot(): NeedsSnapshot {
    const endurance = this.endurance.snapshot();
    return {
      health: this.health,
      hunger: this.hunger,
      thirst: this.thirst,
      stamina: endurance.stamina,
      recoveryDebt: endurance.recoveryDebt,
      alive: this.isAlive(),
      deathCause: this.deathCause,
    };
  }
}
