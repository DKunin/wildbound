import { metersToWorldUnits } from './WorldScaleSystem';

/** Typical direct-scent detection before species and wind modifiers. */
export const LIVE_ANIMAL_SCENT_RANGE_METERS = 115;
/** Larger, exposed carrion produces a stronger and longer-lived odour source. */
export const CARRION_SCENT_RANGE_METERS = 160;

export const LIVE_ANIMAL_SCENT_RANGE = metersToWorldUnits(LIVE_ANIMAL_SCENT_RANGE_METERS);
export const CARRION_SCENT_RANGE = metersToWorldUnits(CARRION_SCENT_RANGE_METERS);
