import type { PlayerDirection } from './DirectionalSpriteSystem';

export type PreyAnimationState = 'idle' | 'walk' | 'flee' | 'foraging' | 'drinking' | 'resting' | 'dead';

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

export const getPreyAnimationKey = (species: 'rabbit' | 'deer', direction: PlayerDirection, state: PreyAnimationState): string =>
  `${species}-${direction}-${state}`;

export const getPreyAnimationTextureKey = (species: 'rabbit' | 'deer', state: PreyAnimationState): string => (
  state === 'foraging' || state === 'drinking' || state === 'resting' ? `${species}-actions` : species
);

export const getPreyAnimationFrames = (direction: PlayerDirection, state: PreyAnimationState): number[] => {
  const column = DIRECTION_COLUMNS[direction];
  if (state === 'idle') return [column, 8 + column];
  if (state === 'walk') return [16 + column, 24 + column];
  if (state === 'flee') return [16 + column, 24 + column, 32 + column, 24 + column];
  if (state === 'resting') return [column];
  if (state === 'foraging') return [8 + column, 16 + column, 8 + column];
  if (state === 'drinking') return [16 + column, 8 + column, 16 + column];
  return [40 + column];
};
