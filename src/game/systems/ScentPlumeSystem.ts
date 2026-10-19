export interface ScentPoint {
  x: number;
  y: number;
}

export interface ScentPlumeProfile {
  calmRangeMultiplier: number;
  adverseRangeMultiplier: number;
  favorableRangeMultiplier: number;
  calmStrength: number;
  adverseStrength: number;
  favorableStrength: number;
  plumeWidth: number;
  plumeExponent: number;
}

export interface ScentPlumeInput {
  listener: ScentPoint;
  source: ScentPoint;
  windX: number;
  windY: number;
  windStrength: number;
  baseRange: number;
  sourceStrength?: number;
  profile?: ScentPlumeProfile;
}

export interface ScentPlumeReading {
  strength: number;
  range: number;
  alignment: number;
  plumeStrength: number;
  distanceRatio: number;
}

export const ANIMAL_AWARENESS_SCENT_PROFILE: ScentPlumeProfile = {
  calmRangeMultiplier: 0.9,
  adverseRangeMultiplier: 0.75,
  favorableRangeMultiplier: 1.5,
  calmStrength: 0.72,
  adverseStrength: 0.08,
  favorableStrength: 1,
  plumeWidth: 0.25,
  plumeExponent: 1.6,
};

export const PLAYER_SCENT_PROFILE: ScentPlumeProfile = {
  calmRangeMultiplier: 1,
  adverseRangeMultiplier: 0.3,
  favorableRangeMultiplier: 2.4,
  calmStrength: 0.68,
  adverseStrength: 0.06,
  favorableStrength: 1,
  plumeWidth: 0.25,
  plumeExponent: 1.6,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

export const getScentPlumeReading = ({
  listener,
  source,
  windX,
  windY,
  windStrength,
  baseRange,
  sourceStrength = 1,
  profile = PLAYER_SCENT_PROFILE,
}: ScentPlumeInput): ScentPlumeReading => {
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const distance = Math.hypot(dx, dy);
  const directionX = distance > 0 ? dx / distance : 0;
  const directionY = distance > 0 ? dy / distance : 0;
  const windLength = Math.hypot(windX, windY) || 1;
  const normalizedWindX = windX / windLength;
  const normalizedWindY = windY / windLength;
  const alignment = (-directionX) * normalizedWindX + (-directionY) * normalizedWindY;
  const normalizedWindStrength = clamp01(windStrength);
  const plumeAlignment = clamp01((alignment + profile.plumeWidth) / (1 + profile.plumeWidth));
  const plumeStrength = Math.pow(plumeAlignment, profile.plumeExponent);
  const directionalRangeMultiplier = lerp(
    profile.adverseRangeMultiplier,
    profile.favorableRangeMultiplier,
    plumeStrength,
  );
  const rangeMultiplier = lerp(
    profile.calmRangeMultiplier,
    directionalRangeMultiplier,
    normalizedWindStrength,
  );
  const normalizedSourceStrength = Math.max(0, sourceStrength);
  const range = Math.max(0, baseRange) * normalizedSourceStrength * rangeMultiplier;
  const directionalStrength = lerp(profile.adverseStrength, profile.favorableStrength, plumeStrength);
  const signalStrength = lerp(profile.calmStrength, directionalStrength, normalizedWindStrength);
  const distanceRatio = range > 0 ? distance / range : Number.POSITIVE_INFINITY;
  return {
    strength: range > 0 ? clamp01(1 - distanceRatio) * signalStrength : 0,
    range,
    alignment,
    plumeStrength,
    distanceRatio,
  };
};

export const getStableScentSourcePhase = (sourceId: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < sourceId.length; index += 1) {
    hash ^= sourceId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 4_294_967_295) * Math.PI * 2;
};

export const getScentIntermittency = (
  timeMs: number,
  phase: number,
  distanceRatio: number,
): number => {
  const farBlend = clamp01((distanceRatio - 0.52) / 0.4);
  if (farBlend === 0) return 1;
  const pulse = 0.12 + (0.5 + Math.sin(timeMs / 820 + phase) * 0.5) * 0.88;
  return lerp(1, pulse, farBlend);
};
