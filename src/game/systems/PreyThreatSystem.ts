export type PreyThreatState = 'roam' | 'alert' | 'flee';

export const PREY_ALERT_MEMORY_MS = 5_000;
export const PREY_FLEE_MEMORY_MS = 12_000;

export class PreyThreatSystem {
  private fleeing = false;
  private fleeUntil = 0;
  private alertUntil = 0;

  constructor(
    private readonly fleeMemoryMs = PREY_FLEE_MEMORY_MS,
    private readonly alertMemoryMs = PREY_ALERT_MEMORY_MS,
  ) {}

  update(
    time: number,
    awarenessLevel: number,
    directlySeen = false,
    threatDistance = Number.POSITIVE_INFINITY,
    minimumEscapeDistance = 0,
  ): PreyThreatState {
    const startsFleeing = awarenessLevel >= 0.6;
    const threatStillUnsafe = awarenessLevel >= 0.06
      || directlySeen
      || (this.fleeing && threatDistance < minimumEscapeDistance);
    if (awarenessLevel >= 0.22 || directlySeen) this.alertUntil = time + this.alertMemoryMs;

    if (startsFleeing || (this.fleeing && threatStillUnsafe)) {
      this.fleeing = true;
      this.fleeUntil = time + this.fleeMemoryMs;
    } else if (this.fleeing && time >= this.fleeUntil) {
      this.fleeing = false;
    }

    if (this.fleeing) return 'flee';
    return time < this.alertUntil ? 'alert' : 'roam';
  }

  triggerFlee(time: number): void {
    this.fleeing = true;
    this.fleeUntil = time + this.fleeMemoryMs;
    this.alertUntil = time + this.alertMemoryMs;
  }
}
