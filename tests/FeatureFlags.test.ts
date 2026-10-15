import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS } from '../src/game/features';

describe('gameplay feature flags', () => {
  it('keeps pack behavior dormant without removing its implementation', () => {
    expect(FEATURE_FLAGS.pack).toBe(false);
  });
});
