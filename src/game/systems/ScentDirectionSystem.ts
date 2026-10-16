export interface ScentDirection {
  arrow: string;
  label: 'HERE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';
}

export const SCENT_TRAIL_LIFETIME_MS = 22_000;
export const SCENT_RENDER_RADIUS = 720;
export const SCENT_TRAIL_MIN_STRENGTH = 0.05;
export const CACHED_MEAT_SCENT_RADIUS = 2_400;

const DIRECTIONS: readonly ScentDirection[] = [
  { arrow: '→', label: 'E' },
  { arrow: '↘', label: 'SE' },
  { arrow: '↓', label: 'S' },
  { arrow: '↙', label: 'SW' },
  { arrow: '←', label: 'W' },
  { arrow: '↖', label: 'NW' },
  { arrow: '↑', label: 'N' },
  { arrow: '↗', label: 'NE' },
];

export const getScentDirection = (x: number, y: number): ScentDirection => {
  if (Math.hypot(x, y) < 8) return { arrow: '•', label: 'HERE' };
  const angle = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
  return DIRECTIONS[Math.round(angle / (Math.PI / 4)) % DIRECTIONS.length];
};

export const getScentTrailStrength = (ageMs: number, distance: number): number => {
  const ageStrength = 1 - Math.max(0, ageMs) / SCENT_TRAIL_LIFETIME_MS;
  const distanceStrength = 1 - Math.max(0, distance) / (SCENT_RENDER_RADIUS + 140);
  return Math.max(0, ageStrength * distanceStrength);
};

export const isScentTrailTrackable = (ageMs: number, distance: number): boolean => (
  distance <= SCENT_RENDER_RADIUS
  && getScentTrailStrength(ageMs, distance) > SCENT_TRAIL_MIN_STRENGTH
);

export const getCachedMeatScentStrength = (distance: number): number => (
  Math.max(0, 1 - Math.max(0, distance) / CACHED_MEAT_SCENT_RADIUS)
);
