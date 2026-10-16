export interface ScentParticleMotion {
  x: number;
  y: number;
  windX: number;
  windY: number;
  ageProgress: number;
  timeMs: number;
  phase: number;
}

export interface ScentParticleAppearance {
  fillAlpha: number;
  radius: number;
  ringAlpha: number;
  ringRadius: number;
  ringWidth: number;
}

export const SCENT_DRIFT_DISTANCE = 52;
export const SCENT_WOBBLE_DISTANCE = 9;

const TAU = Math.PI * 2;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

export const getScentParticleAppearance = (strength: number, targeted: boolean): ScentParticleAppearance => {
  const normalized = clamp01(strength);
  return {
    fillAlpha: clamp(normalized * (targeted ? 1.05 : 0.92), targeted ? 0.19 : 0.16, targeted ? 0.72 : 0.68),
    radius: 4.25 + normalized * 5.25 + (targeted ? 0.35 : 0),
    ringAlpha: clamp(normalized * (targeted ? 0.46 : 0.4), targeted ? 0.1 : 0.07, targeted ? 0.38 : 0.32),
    ringRadius: 10 + normalized * 10.5,
    ringWidth: targeted ? 2 : 1.75,
  };
};

export const getStableScentPhase = (
  x: number,
  y: number,
  createdAt: number,
  salt = 0,
): number => {
  const hash = Math.sin(x * 12.9898 + y * 78.233 + createdAt * 0.001 + salt * 37.719) * 43_758.5453;
  return (hash - Math.floor(hash)) * TAU;
};

export const getScentParticlePosition = ({
  x,
  y,
  windX,
  windY,
  ageProgress,
  timeMs,
  phase,
}: ScentParticleMotion): { x: number; y: number } => {
  const drift = clamp01(ageProgress) * SCENT_DRIFT_DISTANCE;
  const wobble = Math.sin(phase + timeMs / 700) * SCENT_WOBBLE_DISTANCE;
  return {
    x: x + windX * drift - windY * wobble,
    y: y + windY * drift + windX * wobble,
  };
};

export const getStablePulse = (
  timeMs: number,
  phase: number,
  periodScale: number,
  base: number,
  amplitude: number,
): number => base + Math.sin(timeMs / periodScale + phase) * amplitude;
