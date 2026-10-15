import { describe, expect, it } from 'vitest';
import { WindSystem } from '../src/game/systems/WindSystem';

describe('WindSystem', () => {
  it('returns a normalized direction and bounded strength', () => {
    const wind = new WindSystem().getState(1_122);
    expect(Math.hypot(wind.x, wind.y)).toBeCloseTo(1, 5);
    expect(wind.strength).toBeGreaterThanOrEqual(0.12);
    expect(wind.strength).toBeLessThanOrEqual(0.94);
    expect(wind.arrow.length).toBeGreaterThan(0);
  });

  it('changes over simulation time', () => {
    const system = new WindSystem();
    expect(system.getState(100)).not.toEqual(system.getState(240));
  });
});
