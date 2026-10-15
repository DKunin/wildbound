import { describe, expect, it } from 'vitest';
import { getWolfMovementProfile } from '../src/game/systems/WolfStealthSystem';

describe('wolf stealth profile', () => {
  it('moves more slowly and produces less sight and sound while sneaking', () => {
    const walking = getWolfMovementProfile({ moving: true, running: false, sneaking: false });
    const sneaking = getWolfMovementProfile({ moving: true, running: false, sneaking: true });

    expect(sneaking.speed).toBeLessThan(walking.speed);
    expect(sneaking.visualSignature).toBeLessThan(walking.visualSignature);
    expect(sneaking.soundSignature).toBeLessThan(walking.soundSignature);
  });

  it('does not erase scent and cannot inherit running speed', () => {
    const running = getWolfMovementProfile({ moving: true, running: true, sneaking: false });
    const sneakingWithRunRequested = getWolfMovementProfile({ moving: true, running: true, sneaking: true });

    expect(sneakingWithRunRequested.speed).toBe(68);
    expect(sneakingWithRunRequested.speed).toBeLessThan(running.speed);
    expect(sneakingWithRunRequested.scentSignature).toBeGreaterThan(0.75);
  });
});
