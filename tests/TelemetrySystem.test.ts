import { describe, expect, it, vi } from 'vitest';
import { getOrCreateAnonymousId, TelemetrySystem } from '../src/game/systems/TelemetrySystem';

describe('browser telemetry', () => {
  it('persists only anonymous identifiers in browser storage', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(getOrCreateAnonymousId(storage, 'key', () => 'generated-id')).toBe('generated-id');
    expect(storage.setItem).toHaveBeenCalledWith('key', 'generated-id');
  });

  it('reports play presence without game-save state', async () => {
    const requests: Array<{ type: string; difficulty?: string }> = [];
    let visibilityListener: () => void = () => undefined;
    let pagehideListener: () => void = () => undefined;
    let visible = true;
    let heartbeat: () => void = () => undefined;
    const telemetry = new TelemetrySystem('visitor-test', 'session-test', {
      fetch: vi.fn(async (_input: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as { type: string; difficulty?: string });
      }),
      sendBeacon: vi.fn(() => false),
      addWindowListener: (_type, listener) => { pagehideListener = listener; },
      addVisibilityListener: (listener) => { visibilityListener = listener; },
      isVisible: () => visible,
      setInterval: (listener) => { heartbeat = listener; return 1; },
      clearInterval: vi.fn(),
    });

    telemetry.startPlay('survival');
    heartbeat();
    telemetry.recordDeath();
    visible = false;
    visibilityListener();
    pagehideListener();
    await Promise.resolve();

    expect(requests.map(({ type }) => type)).toEqual([
      'session_start', 'play_start', 'heartbeat', 'death', 'play_pause', 'session_end',
    ]);
    expect(requests[1]).toEqual(expect.objectContaining({ type: 'play_start', difficulty: 'survival' }));
    expect(JSON.stringify(requests)).not.toContain('needs');
    expect(JSON.stringify(requests)).not.toContain('player');
    expect(JSON.stringify(requests)).not.toContain('save');
  });
});
