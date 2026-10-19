import { SENSE_DIRECTIONS, type SenseHudCue, type SenseKind } from './SenseHudSystem';

export const SENSE_DEBUG_FILTERS = ['all', 'scent', 'hearing', 'marked'] as const;

export type SenseDebugFilter = typeof SENSE_DEBUG_FILTERS[number];

const DEBUG_CUES: readonly SenseHudCue[] = [
  { id: 'debug-rabbit', direction: 'N', kind: 'rabbit', strength: 0.34, scentStrength: 0.34, hearingStrength: 0, targeted: false, count: 1 },
  { id: 'debug-deer-group', direction: 'N', kind: 'deer', strength: 0.62, scentStrength: 0, hearingStrength: 0.62, targeted: false, count: 3 },
  { id: 'debug-marked-deer', direction: 'NE', kind: 'deer', strength: 0.92, scentStrength: 0.8, hearingStrength: 0.92, targeted: true, count: 1 },
  { id: 'debug-elk', direction: 'E', kind: 'elk', strength: 0.78, scentStrength: 0, hearingStrength: 0.78, targeted: false, count: 2 },
  { id: 'debug-boar', direction: 'SE', kind: 'boar', strength: 0.67, scentStrength: 0.52, hearingStrength: 0.67, targeted: false, count: 1 },
  { id: 'debug-water', direction: 'S', kind: 'water', strength: 0.84, scentStrength: 0.38, hearingStrength: 0.84, targeted: false, count: 1 },
  { id: 'debug-cache', direction: 'SW', kind: 'cache', strength: 0.58, scentStrength: 0.58, hearingStrength: 0, targeted: false, count: 1 },
  { id: 'debug-territory', direction: 'W', kind: 'territory', strength: 0.72, scentStrength: 0.72, hearingStrength: 0, targeted: false, count: 1 },
  { id: 'debug-pack', direction: 'W', kind: 'pack', strength: 0.64, scentStrength: 0.3, hearingStrength: 0.64, targeted: false, count: 1 },
  { id: 'debug-carcass', direction: 'NW', kind: 'carcass', strength: 0.46, scentStrength: 0.46, hearingStrength: 0, targeted: false, count: 1 },
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const buildSenseDebugCues = (
  filter: SenseDebugFilter = 'all',
  clarity = 1,
): SenseHudCue[] => DEBUG_CUES.flatMap((fixture) => {
  if (filter === 'marked' && !fixture.targeted) return [];

  const scentStrength = filter === 'hearing' ? 0 : clamp01(fixture.scentStrength * clarity);
  const hearingStrength = filter === 'scent' ? 0 : clamp01(fixture.hearingStrength * clarity);
  if (filter !== 'all' && filter !== 'marked' && Math.max(scentStrength, hearingStrength) === 0) return [];

  return [{
    ...fixture,
    scentStrength,
    hearingStrength,
    strength: Math.max(scentStrength, hearingStrength),
  }];
}).sort((left, right) => (
  SENSE_DIRECTIONS.indexOf(left.direction) - SENSE_DIRECTIONS.indexOf(right.direction)
  || right.strength - left.strength
));

export const getSenseDebugKinds = (): ReadonlySet<SenseKind> => new Set(DEBUG_CUES.map(({ kind }) => kind));
