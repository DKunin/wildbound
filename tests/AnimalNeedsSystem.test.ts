import { describe, expect, it } from 'vitest';
import { AnimalNeedsSystem } from '../src/game/systems/AnimalNeedsSystem';

describe('animal needs and goal selection', () => {
  it('prioritizes urgent water, food, and rest instead of wandering', () => {
    expect(new AnimalNeedsSystem('deer', { hunger: 20, thirst: 84, fatigue: 20 }).chooseGoal(12 * 60, 0.5)).toBe('water');
    expect(new AnimalNeedsSystem('deer', { hunger: 84, thirst: 20, fatigue: 20 }).chooseGoal(12 * 60, 0.5)).toBe('food');
    expect(new AnimalNeedsSystem('deer', { hunger: 20, thirst: 20, fatigue: 88 }).chooseGoal(18 * 60, 0.5)).toBe('shelter');
  });

  it('uses dawn and dusk as feeding periods and allows limited low-need exploration', () => {
    const needs = new AnimalNeedsSystem('deer', { hunger: 30, thirst: 15, fatigue: 12 });
    expect(needs.chooseGoal(18 * 60, 0.5)).toBe('food');
    const lowNeeds = new AnimalNeedsSystem('deer', { hunger: 10, thirst: 10, fatigue: 8 });
    expect(lowNeeds.chooseGoal(18 * 60, 0.05)).toBe('explore');
  });

  it('lets rabbits obtain part of their water while foraging', () => {
    const rabbit = new AnimalNeedsSystem('rabbit', { hunger: 70, thirst: 55, fatigue: 20 });
    const afterForaging = rabbit.update(0.25, 'foraging');
    expect(afterForaging.hunger).toBeLessThan(70);
    expect(afterForaging.thirst).toBeLessThan(55);
  });

  it('finishes a need only after the animal has fed, drunk, or rested enough', () => {
    const deer = new AnimalNeedsSystem('deer', { hunger: 80, thirst: 80, fatigue: 90 });
    expect(deer.isSatisfied('water')).toBe(false);
    for (let index = 0; index < 24; index += 1) deer.update(0.25, 'drinking');
    expect(deer.isSatisfied('water')).toBe(true);
    expect(deer.isSatisfied('food')).toBe(false);
    expect(deer.isSatisfied('shelter')).toBe(false);
  });
});
