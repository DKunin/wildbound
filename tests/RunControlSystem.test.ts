import { describe, expect, it } from 'vitest';
import { NeedsSystem } from '../src/game/systems/NeedsSystem';
import { RunControlSystem } from '../src/game/systems/RunControlSystem';

describe('run input control', () => {
  it('stays in walking mode after exhaustion until Shift is released and pressed again', () => {
    const needs = new NeedsSystem();
    const runControl = new RunControlSystem();
    needs.restore({ health: 100, hunger: 32, thirst: 25, stamina: 5.2, alive: true });

    const initiallyRunning = runControl.update(true, needs.canRun());
    expect(initiallyRunning).toBe(true);
    needs.update(0.05, { moving: true, running: initiallyRunning, resting: false });

    expect(needs.canRun()).toBe(false);
    expect(runControl.update(true, needs.canRun())).toBe(false);

    for (let frame = 0; frame < 20; frame += 1) {
      needs.update(0.05, { moving: true, running: false, resting: false });
    }
    expect(needs.canRun()).toBe(true);
    expect(runControl.update(true, needs.canRun())).toBe(false);

    expect(runControl.update(false, needs.canRun())).toBe(false);
    expect(runControl.update(true, needs.canRun())).toBe(true);
  });

  it('does not arm a new run press while stamina is still below the threshold', () => {
    const runControl = new RunControlSystem();

    expect(runControl.update(true, false)).toBe(false);
    expect(runControl.update(true, true)).toBe(false);
    expect(runControl.update(false, true)).toBe(false);
    expect(runControl.update(true, true)).toBe(true);
  });
});
