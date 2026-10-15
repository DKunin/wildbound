import { describe, expect, it } from 'vitest';
import {
  BURIED_CARRION_LIFETIME_SECONDS,
  decayCarrionMeat,
  EXPOSED_CARRION_LIFETIME_SECONDS,
} from '../src/game/systems/CarrionDecaySystem';

describe('carrion decay', () => {
  it('slowly consumes exposed meat until the carcass disappears', () => {
    const halfway = decayCarrionMeat(120, 120, EXPOSED_CARRION_LIFETIME_SECONDS / 2, 'exposed');
    const gone = decayCarrionMeat(120, 120, EXPOSED_CARRION_LIFETIME_SECONDS, 'exposed');

    expect(halfway).toBeCloseTo(60);
    expect(gone).toBe(0);
  });

  it('preserves buried meat fifteen times longer than exposed or carried meat', () => {
    expect(BURIED_CARRION_LIFETIME_SECONDS / EXPOSED_CARRION_LIFETIME_SECONDS).toBe(15);
    const elapsed = 6 * 60;
    const exposed = decayCarrionMeat(120, 120, elapsed, 'exposed');
    const carried = decayCarrionMeat(120, 120, elapsed, 'carried');
    const buried = decayCarrionMeat(120, 120, elapsed, 'buried');

    expect(carried).toBeCloseTo(exposed);
    expect(buried).toBeGreaterThan(exposed);
    expect(buried).toBeGreaterThan(115);
  });
});
