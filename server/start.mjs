import { resolve } from 'node:path';
import { createWildboundServer } from './app.mjs';
import { StatsStore } from './stats-store.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const databasePath = resolve(process.env.STATS_DB_PATH ?? './data/wildbound-stats.sqlite');
const allowedUserIds = new Set((process.env.STATS_ALLOWED_USER_IDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const statsStore = new StatsStore({
  databasePath,
  timeZone: process.env.STATS_TIME_ZONE ?? 'Europe/Moscow',
});
const server = createWildboundServer({
  statsStore,
  distDirectory: resolve('dist'),
  allowedUserIds,
  appVersion: process.env.APP_VERSION ?? 'unknown',
});

server.listen(port, host, () => {
  console.log(`Wildbound listening on http://${host}:${port}`);
  if (allowedUserIds.size === 0) console.warn('/stats is fail-closed because STATS_ALLOWED_USER_IDS is empty.');
});

const shutdown = () => {
  server.close(() => {
    statsStore.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
