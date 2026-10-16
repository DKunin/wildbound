import type { PlayerDirection } from './DirectionalSpriteSystem';
import { getWoundTextureSuffix, type WoundLevel } from './HuntBalanceSystem';
import type { PreySpecies } from '../entities/Prey';

export type PreyAnimationState = 'idle' | 'walk' | 'flee' | 'foraging' | 'drinking' | 'resting' | 'retaliating' | 'dead';
export const PREY_RETALIATION_DURATION_MS = 800;

export const getPreyDeathWoundLevel = (species: PreySpecies): WoundLevel => (
  species === 'rabbit' ? 0 : 3
);

const DIRECTION_COLUMNS: Record<PlayerDirection, number> = {
  east: 0,
  northeast: 1,
  north: 2,
  northwest: 3,
  west: 4,
  southwest: 5,
  south: 6,
  southeast: 7,
};

const getSpeciesWoundLevel = (species: PreySpecies, woundLevel: WoundLevel): WoundLevel => (
  species === 'rabbit' ? 0 : woundLevel
);

export const getPreyAnimationKey = (
  species: PreySpecies,
  direction: PlayerDirection,
  state: PreyAnimationState,
  woundLevel: WoundLevel = 0,
): string => `${species}-${direction}-${state}${getWoundTextureSuffix(getSpeciesWoundLevel(species, woundLevel))}`;

export const getPreyAnimationTextureKey = (
  species: PreySpecies,
  state: PreyAnimationState,
  woundLevel: WoundLevel = 0,
): string => {
  const baseTexture = state === 'retaliating' && species === 'deer'
    ? 'deer-kick'
    : state === 'foraging' || state === 'drinking' || state === 'resting' ? `${species}-actions` : species;
  return `${baseTexture}${getWoundTextureSuffix(getSpeciesWoundLevel(species, woundLevel))}`;
};

export const getPreyAnimationSpeedScale = (
  state: PreyAnimationState,
  actualSpeed: number,
  fullSpeed: number,
): number => {
  if (state !== 'walk' && state !== 'flee') return 1;
  const minimum = state === 'flee' ? 0.52 : 0.64;
  return Math.max(minimum, Math.min(1, fullSpeed > 0 ? actualSpeed / fullSpeed : 1));
};

export const shouldPreservePreyGaitProgress = (
  previous: PreyAnimationState | undefined,
  next: PreyAnimationState,
): boolean => (previous === 'walk' || previous === 'flee') && (next === 'walk' || next === 'flee');

export const getPreyAnimationFrames = (
  direction: PlayerDirection,
  state: PreyAnimationState,
  species: PreySpecies = 'deer',
): number[] => {
  const column = DIRECTION_COLUMNS[direction];
  if (state === 'retaliating') return species === 'deer'
    ? [0, 1, 2, 3].map((phase) => column * 4 + phase)
    : [16 + column, 24 + column, 32 + column, 24 + column];
  if (state === 'idle') return [column, 8 + column];
  if (state === 'walk') return [16 + column, 24 + column];
  if (state === 'flee') return [16 + column, 24 + column, 32 + column, 24 + column];
  if (state === 'resting') return [column];
  if (state === 'foraging') return [8 + column];
  if (state === 'drinking') return [16 + column];
  return [40 + column];
};
