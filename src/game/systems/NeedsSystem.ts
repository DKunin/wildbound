export interface NeedActivity {
  moving: boolean;
  running: boolean;
  resting: boolean;
}

export type DeathCause = 'Thirst took you.' | 'Starvation took you.' | 'Your injuries were too severe.';

export interface NeedsSnapshot {
  health: number;
  hunger: number;
  thirst: number;
  stamina: number;
  alive: boolean;
  deathCause?: DeathCause;
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));

export class NeedsSystem {
  private health = 100;
  private hunger = 32;
  private thirst = 25;
  private stamina = 100;
  private deathCause?: DeathCause;

  update(deltaSeconds: number, activity: NeedActivity): NeedsSnapshot {
    if (!this.isAlive()) return this.snapshot();

    const exertion = activity.running ? 1.85 : activity.moving ? 1.2 : 1;
    this.hunger = clamp(this.hunger + deltaSeconds * 0.1 * exertion);
    this.thirst = clamp(this.thirst + deltaSeconds * 0.16 * exertion);

    if (activity.running && this.stamina > 0) {
      this.stamina = clamp(this.stamina - deltaSeconds * 23);
    } else {
      const recovery = activity.resting ? 25 : activity.moving ? 5 : 14;
      this.stamina = clamp(this.stamina + deltaSeconds * recovery);
    }

    if (activity.resting && this.hunger < 82 && this.thirst < 82) {
      this.health = clamp(this.health + deltaSeconds * 0.65);
    }

    if (this.hunger > 88) this.health = clamp(this.health - deltaSeconds * (this.hunger - 86) * 0.055);
    if (this.thirst > 88) this.health = clamp(this.health - deltaSeconds * (this.thirst - 86) * 0.085);

    if (this.health <= 0) {
      if (this.thirst >= this.hunger && this.thirst > 88) this.deathCause = 'Thirst took you.';
      else if (this.hunger > 88) this.deathCause = 'Starvation took you.';
      else this.deathCause = 'Your injuries were too severe.';
    }

    return this.snapshot();
  }

  feed(amount: number): NeedsSnapshot {
    this.hunger = clamp(this.hunger - amount);
    this.health = clamp(this.health + amount * 0.08);
    return this.snapshot();
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
    this.stamina = clamp(snapshot.stamina);
    this.deathCause = snapshot.deathCause;
    return this.snapshot();
  }

  canRun(): boolean {
    return this.stamina > 5 && this.isAlive();
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  snapshot(): NeedsSnapshot {
    return {
      health: this.health,
      hunger: this.hunger,
      thirst: this.thirst,
      stamina: this.stamina,
      alive: this.isAlive(),
      deathCause: this.deathCause,
    };
  }
}
