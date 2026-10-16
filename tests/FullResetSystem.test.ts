import { describe, expect, it, vi } from 'vitest';
import { runFullReset } from '../src/game/systems/FullResetSystem';

describe('full reset menu flow', () => {
  it('waits for persistent storage to clear before starting a new game', async () => {
    let finishClear: (() => void) | undefined;
    const clearSave = vi.fn(() => new Promise<void>((resolve) => { finishClear = resolve; }));
    const startFresh = vi.fn();
    const reportFailure = vi.fn();

    const reset = runFullReset({ clearSave, startFresh, reportFailure });
    expect(startFresh).not.toHaveBeenCalled();

    finishClear?.();
    await expect(reset).resolves.toBe(true);
    expect(startFresh).toHaveBeenCalledOnce();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('reports a clear failure and never starts the game', async () => {
    const failure = new Error('IndexedDB is unavailable');
    const startFresh = vi.fn();
    const reportFailure = vi.fn();

    await expect(runFullReset({
      clearSave: () => Promise.reject(failure),
      startFresh,
      reportFailure,
    })).resolves.toBe(false);

    expect(startFresh).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(failure);
  });
});
