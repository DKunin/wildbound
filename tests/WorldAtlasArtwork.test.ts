import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

const ROOT = resolve(import.meta.dirname, '..');
const FRAME_SIZE = 313;
const GRID_SIZE = 4;
const ATLAS_SIZE = FRAME_SIZE * GRID_SIZE;
const runtimeAtlases = [
  'terrain-overlays-v3.png',
  'obstacle-atlas-v3.png',
  'terrain-features-v4.png',
  'water-tiles-v3.png',
];
const isolatedAtlases = ['obstacle-atlas-v3.png', 'terrain-features-v4.png'];
const mutedPairs = [
  ['ground-base-v2.png', 'ground-base-v3.png'],
  ['terrain-tiles-v2.png', 'terrain-tiles-v3.png'],
  ['terrain-overlays-v2.png', 'terrain-overlays-v3.png'],
  ['obstacle-atlas-v2.png', 'obstacle-atlas-v3.png'],
  ['terrain-features-v3.png', 'terrain-features-v4.png'],
  ['water-tiles-v2.png', 'water-tiles-v3.png'],
  ['forest-world.png', 'forest-world-v2.png'],
] as const;

const readAsset = (name: string): PNG => PNG.sync.read(readFileSync(resolve(ROOT, 'public/assets', name)));
const readColorType = (name: string): number => readFileSync(resolve(ROOT, 'public/assets', name))[25];

const averageChroma = (image: PNG): number => {
  let chroma = 0;
  let visiblePixels = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] <= 16) continue;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    chroma += Math.max(red, green, blue) - Math.min(red, green, blue);
    visiblePixels += 1;
  }
  return chroma / visiblePixels;
};

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
    expect(readFileSync(resolve(ROOT, 'art-source/terrain-v4/terrain-features-source.png')))
      .toEqual(readFileSync(resolve(ROOT, 'public/assets/terrain-features-v4.png')));
  });

  it('quiets every terrain-family asset without changing dimensions or alpha', () => {
    for (const [sourceName, mutedName] of mutedPairs) {
      const source = readAsset(sourceName);
      const muted = readAsset(mutedName);
      expect([muted.width, muted.height], mutedName).toEqual([source.width, source.height]);
      expect(readColorType(mutedName), `${mutedName} PNG color type`).toBe(readColorType(sourceName));
      expect(averageChroma(muted), mutedName).toBeLessThan(averageChroma(source) * 0.72);
      let alphaMismatch = -1;
      for (let offset = 3; offset < source.data.length; offset += 4) {
        if (muted.data[offset] !== source.data[offset]) {
          alphaMismatch = (offset - 3) / 4;
          break;
        }
      }
      expect(alphaMismatch, `${mutedName} changes alpha topology`).toBe(-1);
    }
  });
});
