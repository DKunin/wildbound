import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

const ROOT = resolve(import.meta.dirname, '..');
const FRAME_SIZE = 313;
const GRID_SIZE = 4;
const ATLAS_SIZE = FRAME_SIZE * GRID_SIZE;
const runtimeAtlases = [
  'terrain-overlays-v2.png',
  'obstacle-atlas-v2.png',
  'terrain-features-v3.png',
  'water-tiles-v2.png',
];
const isolatedAtlases = ['obstacle-atlas-v2.png', 'terrain-features-v3.png'];

const readAsset = (name: string): PNG => PNG.sync.read(readFileSync(resolve(ROOT, 'public/assets', name)));

describe('world atlas artwork', () => {
  it('matches Phaser\'s exact 4x4 frame contract', () => {
    for (const name of runtimeAtlases) {
      const atlas = readAsset(name);
      expect([atlas.width, atlas.height], name).toEqual([ATLAS_SIZE, ATLAS_SIZE]);
    }
  });

  it('keeps every transparent prop frame populated and isolated', () => {
    for (const name of isolatedAtlases) {
      const atlas = readAsset(name);
      for (let frame = 0; frame < GRID_SIZE * GRID_SIZE; frame += 1) {
        const left = (frame % GRID_SIZE) * FRAME_SIZE;
        const top = Math.floor(frame / GRID_SIZE) * FRAME_SIZE;
        let solidPixels = 0;
        for (let y = 0; y < FRAME_SIZE; y += 1) {
          for (let x = 0; x < FRAME_SIZE; x += 1) {
            const alpha = atlas.data[((top + y) * atlas.width + left + x) * 4 + 3];
            if (alpha > 16) solidPixels += 1;
            if (x === 0 || y === 0 || x === FRAME_SIZE - 1 || y === FRAME_SIZE - 1) {
              expect(alpha, `${name} frame ${frame} touches its cell boundary`).toBe(0);
            }
          }
        }
        expect(solidPixels, `${name} frame ${frame} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the terrain feature source synchronized with its runtime atlas', () => {
    expect(readFileSync(resolve(ROOT, 'art-source/terrain-v3/terrain-features-source.png')))
      .toEqual(readFileSync(resolve(ROOT, 'public/assets/terrain-features-v3.png')));
  });
});
