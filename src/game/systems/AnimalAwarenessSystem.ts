export type AwarenessSense = 'sight' | 'sound' | 'scent';

export interface AwarenessPoint {
  x: number;
  y: number;
}

export interface AwarenessObserver extends AwarenessPoint {
  facingX: number;
  facingY: number;
  sightRange: number;
  fieldOfViewDegrees: number;
  hearingRange: number;
  scentRange: number;
}

export interface AwarenessThreat extends AwarenessPoint {
  visualSignature: number;
  soundSignature: number;
  scentSignature: number;
}

export interface AwarenessEnvironment {
  visibility: number;
  windX: number;
  windY: number;
  windStrength: number;
  hasLineOfSight: (observer: AwarenessPoint, threat: AwarenessPoint) => boolean;
}

export interface AwarenessReading {
  level: number;
  strongestSense: AwarenessSense;
  sight: number;
  sound: number;
  scent: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export class AnimalAwarenessSystem {
  evaluate(observer: AwarenessObserver, threat: AwarenessThreat, environment: AwarenessEnvironment): AwarenessReading {
    const dx = threat.x - observer.x;
    const dy = threat.y - observer.y;
    const distance = Math.hypot(dx, dy);
    const directionX = distance > 0 ? dx / distance : observer.facingX;
    const directionY = distance > 0 ? dy / distance : observer.facingY;

    const sight = this.sight(observer, threat, environment, distance, directionX, directionY);
    const sound = this.sound(observer, threat, distance);
    const scent = this.scent(observer, threat, environment, distance, directionX, directionY);
    const level = clamp01(1 - (1 - sight) * (1 - sound) * (1 - scent));
    const strongestSense: AwarenessSense = sight >= sound && sight >= scent
      ? 'sight'
      : sound >= scent ? 'sound' : 'scent';

    return { level, strongestSense, sight, sound, scent };
  }

  private sight(
    observer: AwarenessObserver,
    threat: AwarenessThreat,
    environment: AwarenessEnvironment,
    distance: number,
    directionX: number,
    directionY: number,
  ): number {
    const visibility = 0.5 + clamp01(environment.visibility) * 0.5;
    const range = observer.sightRange * visibility * Math.max(0, threat.visualSignature);
    if (range <= 0 || distance > range || !environment.hasLineOfSight(observer, threat)) return 0;

    const facingLength = Math.hypot(observer.facingX, observer.facingY) || 1;
    const facingX = observer.facingX / facingLength;
    const facingY = observer.facingY / facingLength;
    const alignment = facingX * directionX + facingY * directionY;
    const coneEdge = Math.cos((observer.fieldOfViewDegrees * Math.PI) / 360);
    if (alignment < coneEdge) return 0;

    const centrality = clamp01((alignment - coneEdge) / (1 - coneEdge));
    return clamp01((1 - distance / range) * (0.72 + centrality * 0.28));
  }

  private sound(observer: AwarenessObserver, threat: AwarenessThreat, distance: number): number {
    const range = observer.hearingRange * Math.max(0, threat.soundSignature);
    return range > 0 ? clamp01(1 - distance / range) : 0;
  }

  private scent(
    observer: AwarenessObserver,
    threat: AwarenessThreat,
    environment: AwarenessEnvironment,
    distance: number,
    directionX: number,
    directionY: number,
  ): number {
    const windLength = Math.hypot(environment.windX, environment.windY) || 1;
    const windX = environment.windX / windLength;
    const windY = environment.windY / windLength;
    const downwindAlignment = (-directionX) * windX + (-directionY) * windY;
    const windStrength = clamp01(environment.windStrength);
    const plumeAlignment = clamp01((downwindAlignment + 0.25) / 1.25);
    const plumeStrength = Math.pow(plumeAlignment, 1.6);
    const stillAirStrength = 0.72;
    const windDirectedStrength = 0.08 + plumeStrength * 0.92;
    const directionalStrength = stillAirStrength * (1 - windStrength) + windDirectedStrength * windStrength;
    const rangeMultiplier = 0.9 + windStrength * (-0.15 + plumeStrength * 0.75);
    const range = observer.scentRange
      * Math.max(0, threat.scentSignature)
      * rangeMultiplier;
    return range > 0 ? clamp01(1 - distance / range) * directionalStrength : 0;
  }
}
