export type ScentSpecies = 'rabbit' | 'deer' | 'elk' | 'boar' | 'pack' | 'carcass';

export const getAnimalScentSpecies = (
  species: 'rabbit' | 'deer' | 'elk' | 'boar',
  dead: boolean,
  hasEdibleMeat: boolean,
): ScentSpecies | undefined => dead ? (hasEdibleMeat ? 'carcass' : undefined) : species;
