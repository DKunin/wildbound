import { describe, expect, it } from 'vitest';
import type { AwarenessReading } from '../src/game/systems/AnimalAwarenessSystem';
import { HuntLogSystem } from '../src/game/systems/HuntLogSystem';

const reading = (overrides: Partial<AwarenessReading> = {}): AwarenessReading => ({
  level: 0,
  strongestSense: 'sight',
  sight: 0,
  sound: 0,
  scent: 0,
  ...overrides,
});

describe('hunt log', () => {
  it('reports real sensory and alert transitions only once per animal', () => {
    const log = new HuntLogSystem();
    const deer = {};
    const detected = reading({ level: 0.45, sight: 0.4, sound: 0.2 });

    expect(log.observe(deer, 'deer', 'alert', detected, 1_000).map((event) => event.kind))
      .toEqual(['sight', 'sound', 'alert']);
    expect(log.observe(deer, 'deer', 'alert', detected, 1_100)).toEqual([]);
  });

  it('reports a new sense after it crosses the detection threshold', () => {
    const log = new HuntLogSystem();
    const deer = {};

    log.observe(deer, 'deer', 'alert', reading({ level: 0.3, sight: 0.3 }), 0);
    expect(log.observe(deer, 'deer', 'alert', reading({ level: 0.4, sight: 0.3, scent: 0.2 }), 3_000))
      .toEqual([{ kind: 'scent', message: 'A deer smelled the wolf.' }]);
  });

  it('reports fleeing and the later return to a relaxed state', () => {
    const log = new HuntLogSystem();
    const deer = {};

    log.observe(deer, 'deer', 'alert', reading({ level: 0.4, sight: 0.35 }), 0);
    expect(log.observe(deer, 'deer', 'flee', reading({ level: 0.8, sight: 0.7 }), 1_000))
      .toContainEqual({ kind: 'flee', message: 'A deer bolts away from the wolf.' });
    expect(log.observe(deer, 'deer', 'roam', reading(), 7_000))
      .toEqual([{ kind: 'relax', message: 'A deer is relaxed after losing the wolf.' }]);
  });

  it('deduplicates matching herd events while allowing another species', () => {
    const log = new HuntLogSystem();
    const firstDeer = {};
    const secondDeer = {};
    const rabbit = {};
    const heard = reading({ level: 0.3, sound: 0.3, strongestSense: 'sound' });

    expect(log.observe(firstDeer, 'deer', 'alert', heard, 10_000)).toHaveLength(2);
    expect(log.observe(secondDeer, 'deer', 'alert', heard, 10_100)).toEqual([]);
    expect(log.observe(rabbit, 'rabbit', 'alert', heard, 10_100).map((event) => event.kind))
      .toEqual(['sound', 'alert']);
  });
});
