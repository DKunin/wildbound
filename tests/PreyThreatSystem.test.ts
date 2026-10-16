import { describe, expect, it } from 'vitest';
import { PREY_ALERT_MEMORY_MS, PREY_FLEE_MEMORY_MS, PreyThreatSystem } from '../src/game/systems/PreyThreatSystem';

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
    expect(response.update(500 + PREY_FLEE_MEMORY_MS - 1, 0)).toBe('flee');
    expect(response.update(500 + PREY_FLEE_MEMORY_MS + 1, 0)).toBe('roam');
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

  it('does not stop to look back while an ungulate can still see the pursuing wolf', () => {
    const response = new PreyThreatSystem();
    expect(response.update(0, 0.75, true)).toBe('flee');
    expect(response.update(12_000, 0.01, true)).toBe('flee');
    expect(response.update(12_000 + PREY_FLEE_MEMORY_MS - 1, 0, false)).toBe('flee');
    expect(response.update(12_000 + PREY_FLEE_MEMORY_MS + 1, 0, false)).toBe('roam');
  });

  it('keeps opening distance even after the pursuer drops below sensory thresholds', () => {
    const response = new PreyThreatSystem();
    expect(response.update(0, 0.75, true, 180, 1_600)).toBe('flee');
    expect(response.update(20_000, 0, false, 1_200, 1_600)).toBe('flee');
    expect(response.update(20_001, 0, false, 1_800, 1_600)).toBe('flee');
    expect(response.update(20_000 + PREY_FLEE_MEMORY_MS + 1, 0, false, 1_800, 1_600)).toBe('roam');
  });
});
