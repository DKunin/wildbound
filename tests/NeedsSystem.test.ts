import { describe, expect, it } from 'vitest';
import { NeedsSystem } from '../src/game/systems/NeedsSystem';

describe('NeedsSystem', () => {
  it('drains stamina faster while running and recovers it at rest', () => {
    const needs = new NeedsSystem();
    const afterRun = needs.update(2, { moving: true, running: true, resting: false });
    expect(afterRun.stamina).toBeCloseTo(54);

    const afterRest = needs.update(1, { moving: false, running: false, resting: true });
    expect(afterRest.stamina).toBeCloseTo(79);
  });

  it('reduces hunger and thirst through feeding and drinking', () => {
    const needs = new NeedsSystem();
    needs.update(10, { moving: true, running: false, resting: false });
    expect(needs.feed(20).hunger).toBeLessThan(20);
    expect(needs.drink(18).thirst).toBeLessThan(10);
  });

  it('records injury as the cause of death', () => {
    const needs = new NeedsSystem();
    const snapshot = needs.injure(100);
    expect(snapshot.alive).toBe(false);
    expect(snapshot.deathCause).toBe('Your injuries were too severe.');
  });

  it('never lets survival values leave the zero-to-one-hundred range', () => {
    const needs = new NeedsSystem();
    needs.feed(1_000);
    needs.drink(1_000);
    const snapshot = needs.update(10_000, { moving: true, running: true, resting: false });
    expect(snapshot.hunger).toBeGreaterThanOrEqual(0);
    expect(snapshot.thirst).toBeGreaterThanOrEqual(0);
    expect(snapshot.stamina).toBeGreaterThanOrEqual(0);
    expect(snapshot.health).toBeGreaterThanOrEqual(0);
    expect(snapshot.hunger).toBeLessThanOrEqual(100);
    expect(snapshot.thirst).toBeLessThanOrEqual(100);
  });

  it('restores a bounded persisted snapshot', () => {
    const needs = new NeedsSystem();
    const restored = needs.restore({ health: 81, hunger: 52, thirst: 44, stamina: 63, alive: true });
    expect(restored).toMatchObject({ health: 81, hunger: 52, thirst: 44, stamina: 63, alive: true });
  });
});
