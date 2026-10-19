import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWildboundServer } from '../server/app.mjs';
import { StatsStore } from '../server/stats-store.mjs';

const cleanups = [];

const startServer = async (allowedUserIds = new Set(['owner-user-id'])) => {
  const root = mkdtempSync(join(tmpdir(), 'wildbound-stats-'));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<h1>game</h1>');
  writeFileSync(join(dist, 'stats.html'), '<h1>stats</h1>');
  const store = new StatsStore({ databasePath: ':memory:' });
  const server = createWildboundServer({
    statsStore: store,
    distDirectory: dist,
    allowedUserIds,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return origin;
};

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()();
});

describe('Wildbound statistics server', () => {
  it('keeps ingestion public while stats fail closed to the owner allowlist', async () => {
    const origin = await startServer();
    const event = await fetch(`${origin}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-test', visitorId: 'visitor-test', type: 'play_start', difficulty: 'survival' }),
    });
    expect(event.status).toBe(202);

    expect((await fetch(`${origin}/api/stats`)).status).toBe(401);
    expect((await fetch(`${origin}/stats.html`, { redirect: 'manual' })).status).toBe(401);
    expect((await fetch(`${origin}/api/stats`, { headers: { 'X-Auth-User-Id': 'someone-else' } })).status).toBe(403);

    const authorized = await fetch(`${origin}/api/stats`, { headers: { 'X-Auth-User-Id': 'owner-user-id' } });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ live: { online: 1, playing: 1 }, totals: { sessions: 1 } });
    expect((await fetch(`${origin}/stats`, { headers: { 'X-Auth-User-Id': 'owner-user-id' } })).status).toBe(200);
  });

  it('rejects malformed events and never exposes a missing static file', async () => {
    const origin = await startServer();
    const invalid = await fetch(`${origin}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '../bad', visitorId: 'visitor-test', type: 'save_upload' }),
    });
    expect(invalid.status).toBe(400);
    expect((await fetch(`${origin}/missing.js`)).status).toBe(404);
  });

  it('fails closed when no owner user ID is configured', async () => {
    const origin = await startServer(new Set());
    expect((await fetch(`${origin}/stats`, { headers: { 'X-Auth-User-Id': 'owner-user-id' } })).status).toBe(403);
  });
});
