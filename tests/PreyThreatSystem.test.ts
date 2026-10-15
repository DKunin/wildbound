import { describe, expect, it } from 'vitest';
import { PREY_ALERT_MEMORY_MS, PreyThreatSystem } from '../src/game/systems/PreyThreatSystem';

describe('prey threat response', () => {
  it('keeps fleeing when a nearby pursuing wolf stops moving', () => {
    const response = new PreyThreatSystem();

    expect(response.update(0, 0.75)).toBe('flee');
    expect(response.update(2_000, 0.3)).toBe('flee');
    expect(response.update(5_000, 0.2)).toBe('flee');
  });

  it('releases flee only after reaching a safe distance and completing the escape window', () => {
    const response = new PreyThreatSystem();

    expect(response.update(0, 0.75)).toBe('flee');
    expect(response.update(500, 0.25)).toBe('flee');
    expect(response.update(2_999, 0)).toBe('flee');
    expect(response.update(3_001, 0)).toBe('alert');
    expect(response.update(5_501, 0)).toBe('roam');
  });

  it('remembers a non-dangerous sensory alert for several seconds', () => {
    const response = new PreyThreatSystem();
    expect(response.update(1, 0.35)).toBe('alert');
    expect(response.update(PREY_ALERT_MEMORY_MS, 0)).toBe('alert');
    expect(response.update(PREY_ALERT_MEMORY_MS + 2, 0)).toBe('roam');
  });

  it('turns a distant direct sighting into a remembered alert even below the generic threshold', () => {
    const response = new PreyThreatSystem();
    expect(response.update(100, 0.04, true)).toBe('alert');
    expect(response.update(4_500, 0)).toBe('alert');
    expect(response.update(5_101, 0)).toBe('roam');
  });
});
