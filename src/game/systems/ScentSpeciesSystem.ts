export type ScentSpecies = 'rabbit' | 'deer' | 'pack' | 'carcass';

export const getAnimalScentSpecies = (
  species: 'rabbit' | 'deer',
  dead: boolean,
  hasEdibleMeat: boolean,
): ScentSpecies | undefined => dead ? (hasEdibleMeat ? 'carcass' : undefined) : species;
