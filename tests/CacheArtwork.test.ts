import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_PATH = resolve(ROOT, 'public/assets/cache-mound-v1.png');

describe('buried cache artwork', () => {
  it('keeps a readable mound inside a transparent organic silhouette', () => {
    const image = PNG.sync.read(readFileSync(ASSET_PATH));
    let transparentPixels = 0;
    let opaquePixels = 0;
    let opaqueEdgePixels = 0;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const alpha = image.data[(y * image.width + x) * 4 + 3];
        if (alpha < 8) transparentPixels += 1;
        if (alpha > 247) opaquePixels += 1;
        if ((x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) && alpha > 38) opaqueEdgePixels += 1;
      }
    }

    const pixels = image.width * image.height;
    expect([image.width, image.height]).toEqual([512, 341]);
    expect(transparentPixels / pixels).toBeGreaterThan(0.4);
    expect(opaquePixels / pixels).toBeGreaterThan(0.4);
    expect(opaqueEdgePixels).toBe(0);
  });
});
