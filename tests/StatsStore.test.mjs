import { afterEach, describe, expect, it } from 'vitest';
import { StatsStore } from '../server/stats-store.mjs';

const stores = [];
const createStore = () => {
  const store = new StatsStore({ databasePath: ':memory:', timeZone: 'Europe/Moscow' });
  stores.push(store);
  return store;
};

afterEach(() => {
  while (stores.length > 0) stores.pop().close();
});

describe('shared event statistics', () => {
  it('counts live visitors and computes median active playtime without save data', () => {
    const store = createStore();
    const now = Date.UTC(2026, 9, 19, 9, 0, 0);

    store.recordEvent({ sessionId: 'session-a', visitorId: 'visitor-a', type: 'session_start' }, now);
    store.recordEvent({ sessionId: 'session-a', visitorId: 'visitor-a', type: 'play_start', difficulty: 'survival' }, now + 1_000);
    store.recordEvent({ sessionId: 'session-a', visitorId: 'visitor-a', type: 'heartbeat', difficulty: 'survival' }, now + 16_000);
    store.recordEvent({ sessionId: 'session-a', visitorId: 'visitor-a', type: 'play_pause', difficulty: 'survival' }, now + 31_000);

    store.recordEvent({ sessionId: 'session-b', visitorId: 'visitor-b', type: 'session_start' }, now + 2_000);
    store.recordEvent({ sessionId: 'session-b', visitorId: 'visitor-b', type: 'play_start', difficulty: 'explorer' }, now + 3_000);
    store.recordEvent({ sessionId: 'session-b', visitorId: 'visitor-b', type: 'heartbeat', difficulty: 'explorer' }, now + 13_000);
    store.recordEvent({ sessionId: 'session-b', visitorId: 'visitor-b', type: 'death', difficulty: 'explorer' }, now + 14_000);

    const summary = store.getSummary(now + 20_000);
    expect(summary.live).toEqual({ online: 2, playing: 1 });
    expect(summary.today).toMatchObject({ visitors: 2, sessions: 2, playStarts: 2, deaths: 1 });
    expect(summary.totals).toMatchObject({
      visitors: 2,
      sessions: 2,
      playedSessions: 2,
      medianPlaytimeSeconds: 23.5,
      totalPlaytimeSeconds: 47,
      deaths: 1,
    });
    expect(summary.recentSessions[0]).toMatchObject({ visitor: 'visitor-', playing: true, difficulty: 'explorer' });
  });

  it('caps missing-heartbeat accrual and rejects session identifier reassignment', () => {
    const store = createStore();
    const now = Date.UTC(2026, 9, 19, 9, 0, 0);
    store.recordEvent({ sessionId: 'session-c', visitorId: 'visitor-c', type: 'play_start' }, now);

    expect(store.getSummary(now + 120_000).totals.totalPlaytimeSeconds).toBe(30);
    expect(() => store.recordEvent({
      sessionId: 'session-c', visitorId: 'visitor-other', type: 'heartbeat',
    }, now + 5_000)).toThrow(/another visitor/u);
  });
});
