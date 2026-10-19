module.exports = {
  apps: [{
    name: 'wildbound',
    script: 'server/start.mjs',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '4173',
      STATS_DB_PATH: process.env.STATS_DB_PATH || './data/wildbound-stats.sqlite',
      STATS_ALLOWED_USER_IDS: process.env.STATS_ALLOWED_USER_IDS || '',
      STATS_TIME_ZONE: process.env.STATS_TIME_ZONE || 'Europe/Moscow',
    },
  }],
};
