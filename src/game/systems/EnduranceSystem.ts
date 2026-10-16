export type EnduranceActivity = 'sprinting' | 'moving' | 'idle' | 'resting';

export interface EnduranceSnapshot {
  stamina: number;
  recoveryDebt: number;
}

export interface EnduranceProfile {
  sprintDrainPerSecond: number;
  recoveryDebtPerSecond: number;
  minimumSprintSpeedFactor: number;
  depletedSprintSpeedFactor: number;
  strainSpeedRetentionPerPoint: number;
}

const DEFAULT_PROFILE: EnduranceProfile = {
  sprintDrainPerSecond: 23,
  recoveryDebtPerSecond: 8,
  minimumSprintSpeedFactor: 0.34,
  depletedSprintSpeedFactor: 0.34,
  strainSpeedRetentionPerPoint: 0.9985,
};

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

export class EnduranceSystem {
  private stamina: number;
  private recoveryDebt: number;
  private readonly profile: EnduranceProfile;

  constructor(initial: Partial<EnduranceSnapshot> = {}, profile: Partial<EnduranceProfile> = {}) {
    this.stamina = clamp(initial.stamina ?? 100);
    this.recoveryDebt = clamp(initial.recoveryDebt ?? 0);
    this.profile = { ...DEFAULT_PROFILE, ...profile };
  }

  update(deltaSeconds: number, activity: EnduranceActivity): EnduranceSnapshot {
    const elapsed = Math.max(0, deltaSeconds);
    if (activity === 'sprinting') {
      this.stamina = clamp(this.stamina - elapsed * this.profile.sprintDrainPerSecond);
      this.recoveryDebt = clamp(this.recoveryDebt + elapsed * this.profile.recoveryDebtPerSecond);
      return this.snapshot();
    }

    const debtDecay = activity === 'resting' ? 9 : activity === 'idle' ? 1.35 : 0.4;
    this.recoveryDebt = clamp(this.recoveryDebt - elapsed * debtDecay);
    const baseRecovery = activity === 'resting' ? 25 : activity === 'idle' ? 14 : 5;
    const recoveryMultiplier = 0.18 + (1 - this.recoveryDebt / 100) * 0.82;
    this.stamina = clamp(this.stamina + elapsed * baseRecovery * recoveryMultiplier);

    if (activity === 'resting' && this.stamina >= 99.9) {
      this.recoveryDebt = clamp(this.recoveryDebt - elapsed * 12);
    }
    return this.snapshot();
  }

  restore(snapshot: Partial<EnduranceSnapshot>): EnduranceSnapshot {
    this.stamina = clamp(snapshot.stamina ?? 100);
    this.recoveryDebt = clamp(snapshot.recoveryDebt ?? 0);
    return this.snapshot();
  }

  canSpend(amount: number): boolean {
    return this.stamina >= Math.max(0, amount);
  }

  spend(amount: number): EnduranceSnapshot {
    this.stamina = clamp(this.stamina - Math.max(0, amount));
    this.recoveryDebt = clamp(this.recoveryDebt + Math.max(0, amount) * 0.45);
    return this.snapshot();
  }

  limitStamina(maximum: number): EnduranceSnapshot {
    this.stamina = Math.min(this.stamina, clamp(maximum));
    return this.snapshot();
  }

  canSprint(): boolean {
    return this.stamina > 5;
  }

  getSprintSpeedFactor(): number {
    const availablePower = Math.sqrt(this.stamina / 100);
    const minimum = this.profile.minimumSprintSpeedFactor;
    const depleted = Math.max(minimum, this.profile.depletedSprintSpeedFactor);
    const availableSpeed = depleted + availablePower * (1 - depleted);
    const accumulatedStrain = this.profile.strainSpeedRetentionPerPoint ** this.recoveryDebt;
    return Math.max(minimum, Math.min(1, availableSpeed * accumulatedStrain));
  }

  getExhaustionLoad(): number {
    const staminaDeficit = 1 - this.stamina / 100;
    const accumulatedStrain = this.recoveryDebt / 100;
    return Math.max(0, Math.min(1, staminaDeficit * 0.45 + accumulatedStrain * 0.55));
  }

  snapshot(): EnduranceSnapshot {
    return { stamina: this.stamina, recoveryDebt: this.recoveryDebt };
  }
}
