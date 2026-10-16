import { describe, expect, it } from 'vitest';
import { DayNightSystem } from '../src/game/systems/DayNightSystem';
import {
  advanceSimulationTime,
  SIMULATION_MINUTES_PER_REAL_SECOND,
  simulationTimeToWorldMilliseconds,
} from '../src/game/systems/WorldTimeSystem';

describe('world time advancement', () => {
  it('uses the same clock rate for live play and skipped rest', () => {
    const dusk = 18 * 60 + 30;
    const afterRest = advanceSimulationTime(dusk, 60);

    expect(afterRest).toBe(dusk + 60 * SIMULATION_MINUTES_PER_REAL_SECOND);
    expect(new DayNightSystem().getState(afterRest).phase).toBe('NIGHT');
    expect(simulationTimeToWorldMilliseconds(afterRest)).toBeGreaterThan(simulationTimeToWorldMilliseconds(dusk));
  });
});
