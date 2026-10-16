import { describe, expect, it } from 'vitest';
import { NeedsSystem } from '../src/game/systems/NeedsSystem';

describe('NeedsSystem', () => {
  it('drains stamina while running and carries exertion into recovery', () => {
    const needs = new NeedsSystem();
    const afterRun = needs.update(2, { moving: true, running: true, resting: false });
    expect(afterRun.stamina).toBeCloseTo(54);
    expect(afterRun.recoveryDebt).toBeCloseTo(16);

    const afterRest = needs.update(1, { moving: false, running: false, resting: true });
    expect(afterRest.stamina).toBeGreaterThan(75);
    expect(afterRest.stamina).toBeLessThan(79);
    expect(afterRest.recoveryDebt).toBeCloseTo(7);
  });

  it('reduces hunger and thirst through feeding and drinking', () => {
    const needs = new NeedsSystem();
    needs.update(10, { moving: true, running: false, resting: false });
    expect(needs.feed(20).hunger).toBeLessThan(20);
    expect(needs.drink(18).thirst).toBeLessThan(10);
  });

  it('skips a bounded rest through the normal recovery rules until health is full', () => {
    const needs = new NeedsSystem();
    needs.restore({ health: 50, hunger: 20, thirst: 20, stamina: 20, recoveryDebt: 60, alive: true });

    const result = needs.restUntilHealed();

    expect(result.fullyRecovered).toBe(true);
    expect(result.snapshot.health).toBe(100);
    expect(result.snapshot.hunger).toBeGreaterThan(20);
    expect(result.snapshot.thirst).toBeGreaterThan(20);
    expect(result.snapshot.stamina).toBe(100);
    expect(result.snapshot.recoveryDebt).toBe(0);
    expect(result.elapsedSeconds).toBeGreaterThan(76);
    expect(result.elapsedSeconds).toBeLessThan(78);
  });

  it('does not skip recovery when hunger already prevents healing', () => {
    const needs = new NeedsSystem();
    needs.restore({ health: 50, hunger: 82, thirst: 20, stamina: 50, alive: true });

    expect(needs.canRecoverWhileResting()).toBe(false);
    expect(needs.restUntilHealed()).toMatchObject({ elapsedSeconds: 0, fullyRecovered: false });
  });

  it('stops eating when the wolf is satiated', () => {
    const needs = new NeedsSystem();
    expect(needs.canEat()).toBe(true);
    expect(needs.getFoodNeed()).toBe(14);

    const full = needs.feed(1_000);
    expect(full.hunger).toBe(18);
    expect(needs.canEat()).toBe(false);
    expect(needs.getFoodNeed()).toBe(0);
    expect(needs.feed(10).hunger).toBe(18);

    needs.restore({ health: 100, hunger: 25.9, thirst: 20, stamina: 100, alive: true });
    expect(needs.canEat()).toBe(false);
    expect(needs.feed(10).hunger).toBe(25.9);
    needs.restore({ health: 100, hunger: 26, thirst: 20, stamina: 100, alive: true });
    expect(needs.canEat()).toBe(true);
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

  it('restores older saves without endurance debt', () => {
    const needs = new NeedsSystem();
    expect(needs.restore({ health: 90, hunger: 30, thirst: 20, stamina: 40, alive: true }).recoveryDebt).toBe(0);
  });

  it('makes accumulated exhaustion worsen wolf hunger, thirst, and health', () => {
    const fresh = new NeedsSystem();
    const exhausted = new NeedsSystem();
    fresh.restore({ health: 100, hunger: 20, thirst: 20, stamina: 100, recoveryDebt: 0, alive: true });
    exhausted.restore({ health: 100, hunger: 20, thirst: 20, stamina: 0, recoveryDebt: 100, alive: true });

    const freshResult = fresh.update(1, { moving: true, running: false, resting: false });
    const exhaustedResult = exhausted.update(1, { moving: true, running: false, resting: false });

    expect(exhaustedResult.hunger).toBeGreaterThan(freshResult.hunger);
    expect(exhaustedResult.thirst).toBeGreaterThan(freshResult.thirst);
    expect(exhaustedResult.health).toBeLessThan(freshResult.health);
  });

  it('can identify lethal accumulated exhaustion', () => {
    const needs = new NeedsSystem();
    needs.restore({ health: 0.1, hunger: 20, thirst: 20, stamina: 0, recoveryDebt: 100, alive: true });

    const result = needs.update(1, { moving: true, running: false, resting: false });

    expect(result.alive).toBe(false);
    expect(result.deathCause).toBe('Exhaustion took you.');
  });
});
