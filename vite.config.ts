import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        stats: resolve(__dirname, 'stats.html'),
        audio: resolve(__dirname, 'audio.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
  },
});
