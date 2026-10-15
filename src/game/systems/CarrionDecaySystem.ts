export type CarrionStorageState = 'exposed' | 'carried' | 'buried';

export const EXPOSED_CARRION_LIFETIME_SECONDS = 12 * 60;
export const BURIED_CARRION_LIFETIME_SECONDS = 3 * 60 * 60;

export const decayCarrionMeat = (
  meat: number,
  originalMeat: number,
  elapsedSeconds: number,
  state: CarrionStorageState,
): number => {
  if (meat <= 0 || originalMeat <= 0 || elapsedSeconds <= 0) return Math.max(0, meat);
  const lifetime = state === 'buried'
    ? BURIED_CARRION_LIFETIME_SECONDS
    : EXPOSED_CARRION_LIFETIME_SECONDS;
  return Math.max(0, meat - (originalMeat / lifetime) * elapsedSeconds);
};
