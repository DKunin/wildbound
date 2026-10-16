import type { PlayerDirection } from './DirectionalSpriteSystem';
import { getWoundTextureSuffix, type WoundLevel } from './HuntBalanceSystem';
import type { PreySpecies } from '../entities/Prey';
import preyAnimationContract from '../data/prey-animation-contract.json';

export type PreyAnimationState = keyof typeof preyAnimationContract.states;
export interface PreyAnimationSettings {
  frameRate: number;
  repeat: number;
}

export interface PreyAnimationDefinition {
  key: string;
  textureKey: string;
  frames: readonly { key: string; frame: number }[];
  frameRate: number;
  repeat: number;
}

export interface PreyWoundTextureRequest {
  baseTextureKey: string;
  targetTextureKey: string;
  level: Exclude<WoundLevel, 0>;
}

export interface PreyAnimationReadinessAdapter {
  textureExists(textureKey: string): boolean;
  materializeWoundTexture(request: PreyWoundTextureRequest): void;
  animationExists(animationKey: string): boolean;
  registerAnimation(definition: PreyAnimationDefinition): void;
}

export type PreyAnimationEnsurer = (
  species: PreySpecies,
  direction: PlayerDirection,
  state: PreyAnimationState,
  woundLevel: WoundLevel,
) => void;

export const PREY_ANIMATION_SETTINGS = Object.freeze(Object.fromEntries(
  Object.entries(preyAnimationContract.states).map(([state, settings]) => [
    state,
    { frameRate: settings.frameRate, repeat: settings.repeat },
  ]),
)) as Readonly<Record<PreyAnimationState, Readonly<PreyAnimationSettings>>>;
export const PREY_RETALIATION_DURATION_MS = Math.round(
  preyAnimationContract.states.retaliating.rows.length
    / preyAnimationContract.states.retaliating.frameRate
    * 1_000,
);

export const getPreyDeathWoundLevel = (species: PreySpecies): WoundLevel => (
  species === 'rabbit' ? 0 : 3
);

const DIRECTION_COLUMNS = Object.fromEntries(
  preyAnimationContract.directions.map((direction, index) => [direction, index]),
) as Record<PlayerDirection, number>;

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
  const sheet = preyAnimationContract.states[state].sheet;
  const retaliationAsset = preyAnimationContract.species[species].retaliationAsset;
  const baseTexture = sheet === 'retaliation' && retaliationAsset
    ? retaliationAsset
    : sheet === 'actions' ? `${species}-actions` : species;
  return `${baseTexture}${getWoundTextureSuffix(getSpeciesWoundLevel(species, woundLevel))}`;
};

export const hasPreyRetaliationAnimation = (species: PreySpecies): boolean => (
  preyAnimationContract.species[species].retaliationAsset !== null
);

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
  const settings = preyAnimationContract.states[state];
  if (settings.layout === 'directionRows') {
    if (!hasPreyRetaliationAnimation(species)) return [];
    return settings.rows.map((phase) => column * settings.rows.length + phase);
  }
  return settings.rows.map((row) => row * preyAnimationContract.directions.length + column);
};

export const getPreyAnimationDefinition = (
  species: PreySpecies,
  direction: PlayerDirection,
  state: PreyAnimationState,
  woundLevel: WoundLevel = 0,
): PreyAnimationDefinition => {
  const textureKey = getPreyAnimationTextureKey(species, state, woundLevel);
  const settings = PREY_ANIMATION_SETTINGS[state];
  return {
    key: getPreyAnimationKey(species, direction, state, woundLevel),
    textureKey,
    frames: getPreyAnimationFrames(direction, state, species).map((frame) => ({ key: textureKey, frame })),
    frameRate: settings.frameRate,
    repeat: settings.repeat,
  };
};

export const ensurePreyAnimationReady = (
  adapter: PreyAnimationReadinessAdapter,
  species: PreySpecies,
  direction: PlayerDirection,
  state: PreyAnimationState,
  woundLevel: WoundLevel = 0,
): boolean => {
  if (state === 'retaliating' && !hasPreyRetaliationAnimation(species)) {
    throw new Error(`${species} does not have a retaliation animation`);
  }
  const normalizedWoundLevel = getSpeciesWoundLevel(species, woundLevel);
  const definition = getPreyAnimationDefinition(species, direction, state, normalizedWoundLevel);
  if (normalizedWoundLevel !== 0 && !adapter.textureExists(definition.textureKey)) {
    adapter.materializeWoundTexture({
      baseTextureKey: getPreyAnimationTextureKey(species, state, 0),
      targetTextureKey: definition.textureKey,
      level: normalizedWoundLevel,
    });
  }
  if (!adapter.textureExists(definition.textureKey)) {
    throw new Error(`Prey animation texture ${definition.textureKey} is not ready`);
  }
  if (adapter.animationExists(definition.key)) return false;
  adapter.registerAnimation(definition);
  if (!adapter.animationExists(definition.key)) {
    throw new Error(`Prey animation ${definition.key} was not registered`);
  }
  return true;
};
