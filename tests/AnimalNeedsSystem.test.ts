import { describe, expect, it } from 'vitest';
import { AnimalNeedsSystem } from '../src/game/systems/AnimalNeedsSystem';
import { WOLF_TRAVEL_SPEED } from '../src/game/systems/WolfStealthSystem';

describe('animal needs and goal selection', () => {
  it('advances needs across a long skipped interval instead of capping at one frame', () => {
    const deer = new AnimalNeedsSystem('deer', { hunger: 20, thirst: 20, fatigue: 20 });
    const result = deer.advanceTime(60, 'moving');

    expect(result.hunger).toBeGreaterThan(30);
    expect(result.thirst).toBeGreaterThan(30);
    expect(result.fatigue).toBeGreaterThan(50);
  });

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

  it.each([
    ['rabbit', 12 * 60, 18 * 60],
    ['deer', 12 * 60, 18 * 60],
    ['elk', 12 * 60, 18 * 60],
    ['boar', 12 * 60, 18 * 60],
  ] as const)('gives %s a scheduled bedding period outside its active dusk window', (species, restTime, activeTime) => {
    const needs = new AnimalNeedsSystem(species, { hunger: 12, thirst: 12, fatigue: 8 });

    expect(needs.shouldRest(restTime)).toBe(true);
    expect(needs.chooseGoal(restTime, 0.5)).toBe('shelter');
    expect(needs.shouldRest(activeTime)).toBe(false);
  });

  it('beds boar by day and sends them to forage after dusk', () => {
    const boar = new AnimalNeedsSystem('boar', { hunger: 30, thirst: 15, fatigue: 12 });
    expect(boar.shouldRest(12 * 60)).toBe(true);
    expect(boar.shouldRest(20 * 60)).toBe(false);
    expect(boar.chooseGoal(20 * 60, 0.5)).toBe('food');
  });

  it('staggers individual rest windows instead of synchronizing every animal', () => {
    const earlyRabbit = new AnimalNeedsSystem('rabbit', { hunger: 12, thirst: 12, fatigue: 8 }, -30);
    const lateRabbit = new AnimalNeedsSystem('rabbit', { hunger: 12, thirst: 12, fatigue: 8 }, 30);

    expect(earlyRabbit.shouldRest(8 * 60 + 15)).toBe(true);
    expect(lateRabbit.shouldRest(8 * 60 + 15)).toBe(false);
  });

  it('lets urgent hunger or thirst wake an animal during its rest window', () => {
    const hungryRabbit = new AnimalNeedsSystem('rabbit', { hunger: 62, thirst: 12, fatigue: 80 });
    const thirstyDeer = new AnimalNeedsSystem('deer', { hunger: 12, thirst: 60, fatigue: 80 });

    expect(hungryRabbit.shouldRest(12 * 60)).toBe(false);
    expect(hungryRabbit.chooseGoal(12 * 60, 0.5)).toBe('food');
    expect(hungryRabbit.isSatisfied('shelter', 12 * 60)).toBe(true);
    expect(thirstyDeer.shouldRest(12 * 60)).toBe(false);
    expect(thirstyDeer.chooseGoal(12 * 60, 0.5)).toBe('water');
    expect(thirstyDeer.isSatisfied('shelter', 12 * 60)).toBe(true);
  });

  it('continues scheduled rest after fatigue recovers, then wakes outside the window', () => {
    const deer = new AnimalNeedsSystem('deer', { hunger: 12, thirst: 12, fatigue: 18, stamina: 100 });
    deer.advanceTime(2, 'resting');

    expect(deer.isSatisfied('shelter', 12 * 60)).toBe(false);
    expect(deer.isSatisfied('shelter', 18 * 60)).toBe(true);
  });

  it('applies scheduled rest while the wolf skips time', () => {
    const rabbit = new AnimalNeedsSystem('rabbit', { hunger: 12, thirst: 12, fatigue: 78, stamina: 50 });
    const result = rabbit.advanceTimeFollowingSchedule(120, 12 * 60, 'moving');

    expect(result.fatigue).toBeLessThan(20);
    expect(result.stamina).toBeGreaterThan(90);
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

  it('geometrically slows a fleeing deer while keeping its physical speed above a travelling wolf', () => {
    const deer = new AnimalNeedsSystem('deer', { hunger: 20, thirst: 20, fatigue: 10 });
    const freshSpeed = deer.getSprintSpeedFactor();
    const sampledSpeeds: number[] = [];

    for (let index = 1; index <= 180 * 4; index += 1) {
      deer.update(0.25, 'fleeing');
      const elapsedSeconds = index * 0.25;
      const speed = 205 * deer.getSprintSpeedFactor();
      if (elapsedSeconds % 60 === 0) sampledSpeeds.push(speed);
    }

    const exhausted = deer.snapshot();
    expect(exhausted.stamina).toBe(0);
    expect(exhausted.recoveryDebt).toBeGreaterThan(75);
    expect(sampledSpeeds[1] / sampledSpeeds[0]).toBeCloseTo(sampledSpeeds[2] / sampledSpeeds[1], 2);
    expect(sampledSpeeds[2]).toBeGreaterThan(WOLF_TRAVEL_SPEED);
    expect(deer.getSprintSpeedFactor()).toBeLessThan(freshSpeed);
  });

  it('lets prey outlast one continuous wolf sprint before exhaustion', () => {
    const deer = new AnimalNeedsSystem('deer', { hunger: 20, thirst: 20, fatigue: 10 });
    const rabbit = new AnimalNeedsSystem('rabbit', { hunger: 20, thirst: 20, fatigue: 10 });
    for (let index = 0; index < 20; index += 1) {
      deer.update(0.25, 'fleeing');
      rabbit.update(0.25, 'fleeing');
    }

    expect(deer.snapshot().stamina).toBeGreaterThan(60);
    expect(rabbit.snapshot().stamina).toBeGreaterThan(40);
  });

  it('slows an elk after a sustained pursuit instead of granting unlimited sprint speed', () => {
    const elk = new AnimalNeedsSystem('elk', { hunger: 20, thirst: 20, fatigue: 10 });
    const freshSpeed = 190 * elk.getSprintSpeedFactor();
    for (let index = 0; index < 180 * 4; index += 1) elk.update(0.25, 'fleeing');

    const exhausted = elk.snapshot();
    expect(exhausted.stamina).toBe(0);
    expect(exhausted.recoveryDebt).toBeGreaterThan(85);
    expect(190 * elk.getSprintSpeedFactor()).toBeLessThan(freshSpeed * 0.6);
  });

  it('gives deer a longer escape reserve than rabbits', () => {
    const deer = new AnimalNeedsSystem('deer', { hunger: 20, thirst: 20, fatigue: 10 });
    const rabbit = new AnimalNeedsSystem('rabbit', { hunger: 20, thirst: 20, fatigue: 10 });
    for (let index = 0; index < 16; index += 1) {
      deer.update(0.25, 'fleeing');
      rabbit.update(0.25, 'fleeing');
    }

    expect(deer.snapshot().stamina).toBeGreaterThan(rabbit.snapshot().stamina);
    expect(deer.snapshot().recoveryDebt).toBeLessThan(rabbit.snapshot().recoveryDebt);
  });

  it('turns accumulated exhaustion into extra hunger, thirst, and health strain', () => {
    const fresh = new AnimalNeedsSystem('deer', { hunger: 20, thirst: 20, fatigue: 10, health: 100 });
    const exhausted = new AnimalNeedsSystem('deer', {
      hunger: 20,
      thirst: 20,
      fatigue: 10,
      health: 100,
      stamina: 0,
      recoveryDebt: 100,
    });

    const freshResult = fresh.update(0.25, 'moving');
    const exhaustedResult = exhausted.update(0.25, 'moving');

    expect(exhaustedResult.hunger).toBeGreaterThan(freshResult.hunger);
    expect(exhaustedResult.thirst).toBeGreaterThan(freshResult.thirst);
    expect(exhaustedResult.health).toBeLessThan(freshResult.health);
  });

  it.each([
    ['rabbit', 74],
    ['deer', 58],
  ] as const)('keeps a normally feeding, drinking, and resting %s healthy over a long cycle', (species, waterThreshold) => {
    const animal = new AnimalNeedsSystem(species, { hunger: 45, thirst: 42, fatigue: 30, health: 100 });
    let activity: 'moving' | 'foraging' | 'drinking' | 'resting' = 'moving';
    let travelRemaining = 0;

    for (let step = 0; step < 30 * 60 * 4; step += 1) {
      const snapshot = animal.snapshot();
      if (activity === 'moving' && travelRemaining <= 0) {
        if (snapshot.thirst >= waterThreshold) { activity = 'drinking'; travelRemaining = 35; }
        else if (snapshot.hunger >= 60) { activity = 'foraging'; travelRemaining = 35; }
        else if (snapshot.fatigue >= 70 || snapshot.stamina < 55) { activity = 'resting'; travelRemaining = 35; }
      }
      if (travelRemaining > 0) {
        travelRemaining -= 0.25;
        animal.update(0.25, 'moving');
        continue;
      }
      const result = animal.update(0.25, activity);
      if ((activity === 'drinking' && result.thirst <= 18)
        || (activity === 'foraging' && result.hunger <= 24)
        || (activity === 'resting' && result.fatigue <= 17 && result.stamina >= 92 && result.recoveryDebt <= 12)) {
        activity = 'moving';
      }
    }

    const result = animal.snapshot();
    expect(result.alive).toBe(true);
    expect(result.health).toBe(100);
    expect(result.hunger).toBeLessThan(80);
    expect(result.thirst).toBeLessThan(80);
  });

  it.each([
    ['starvation', { hunger: 100, thirst: 20, health: 0.01 }],
    ['thirst', { hunger: 20, thirst: 100, health: 0.01 }],
    ['exhaustion', { hunger: 20, thirst: 20, health: 0.01, stamina: 0, recoveryDebt: 100 }],
  ] as const)('can die from %s and become carrion', (cause, initial) => {
    const animal = new AnimalNeedsSystem('deer', initial);
    animal.update(0.25, cause === 'exhaustion' ? 'fleeing' : 'idle');

    expect(animal.isAlive()).toBe(false);
    expect(animal.getDeathCause()).toBe(cause);
  });
});
