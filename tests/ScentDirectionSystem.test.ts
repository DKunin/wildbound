import { describe, expect, it } from 'vitest';
import {
  getScentDirection,
  getScentTrailStrength,
  SCENT_TRAIL_LIFETIME_MS,
  SCENT_RENDER_RADIUS,
} from '../src/game/systems/ScentDirectionSystem';

describe('scent direction indicator', () => {
  it('maps screen-space vectors to the eight HUD directions', () => {
    expect(getScentDirection(100, 0)).toEqual({ arrow: '→', label: 'E' });
    expect(getScentDirection(80, -80)).toEqual({ arrow: '↗', label: 'NE' });
    expect(getScentDirection(0, -100)).toEqual({ arrow: '↑', label: 'N' });
    expect(getScentDirection(-80, 80)).toEqual({ arrow: '↙', label: 'SW' });
    expect(getScentDirection(0, 100)).toEqual({ arrow: '↓', label: 'S' });
    expect(getScentDirection(2, 3)).toEqual({ arrow: '•', label: 'HERE' });
  });

  it('keeps a nearby trail readable beyond the former sixteen-second lifetime', () => {
    expect(SCENT_TRAIL_LIFETIME_MS).toBe(22_000);
    expect(SCENT_RENDER_RADIUS).toBe(720);
    expect(getScentTrailStrength(18_000, 80)).toBeGreaterThan(0.05);
    expect(getScentTrailStrength(SCENT_TRAIL_LIFETIME_MS, 80)).toBe(0);
  });
});
