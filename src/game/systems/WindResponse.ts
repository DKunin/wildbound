/** Shared response for gameplay audio, foliage animation, and the sound testground. */
export const windResponse = (strength: number) => {
  const power = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  return {
    power,
    volume: 0.34 * power ** 1.4,
    rate: 0.7 + power * 0.65,
    gustVolume: power * 0.3,
    gustInterval: 42 - power * 30,
    foliageVolume: 0.025 + power * 0.32,
    foliageRate: 0.8 + power * 0.45,
    motionSpeed: 0.35 + power * 1.25,
    motionAmplitude: power / 0.53,
  };
};

/** Integrate speed instead of multiplying absolute time: changing wind must not jump phase. */
export class WindMotionClock {
  time = 0;
  advance(delta: number, strength: number): number {
    this.time += Math.max(0, Math.min(delta, 250)) * windResponse(strength).motionSpeed;
    return this.time;
  }
}
