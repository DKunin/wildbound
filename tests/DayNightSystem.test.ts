import { describe, expect, it } from 'vitest';
import { DayNightSystem } from '../src/game/systems/DayNightSystem';

describe('DayNightSystem', () => {
  const system = new DayNightSystem();

  it('moves through the four daily phases', () => {
    expect(system.getState(6 * 60).phase).toBe('DAWN');
    expect(system.getState(12 * 60).phase).toBe('DAY');
    expect(system.getState(19 * 60).phase).toBe('DUSK');
    expect(system.getState(23 * 60).phase).toBe('NIGHT');
  });

  it('reduces visibility and increases the overlay at night', () => {
    const day = system.getState(12 * 60);
    const night = system.getState(23 * 60);
    expect(night.visibility).toBeLessThan(day.visibility);
    expect(night.overlayOpacity).toBeGreaterThan(day.overlayOpacity);
  });

  it('uses a restrained blue night grade', () => {
    const night = system.getState(23 * 60);
    const [red, green, blue] = night.overlay.match(/[0-9a-f]{2}/gi)!.map((value) => Number.parseInt(value, 16));
    expect(blue).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(red);
    expect(night.overlayOpacity).toBeGreaterThanOrEqual(0.12);
    expect(night.overlayOpacity).toBeLessThanOrEqual(0.2);
  });

  it('wraps cleanly across multiple simulation days', () => {
    expect(system.getState(24 * 60 + 19 * 60).phase).toBe('DUSK');
  });
});
