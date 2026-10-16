import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_SIZE = 181;
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/elk-art-visual-baseline.json');

const atlasMetrics = (path: string, rows: number) => {
  const image = PNG.sync.read(readFileSync(path));
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      let opaquePixels = 0;
      let edgePixels = 0;
      const pixels = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const source = ((((row * FRAME_SIZE) + y) * image.width) + column * FRAME_SIZE + x) * 4;
          image.data.copy(pixels, (y * FRAME_SIZE + x) * 4, source, source + 4);
          const alpha = image.data[source + 3];
          if (alpha < 12) continue;
          opaquePixels += 1;
          if (x === 0 || y === 0 || x === FRAME_SIZE - 1 || y === FRAME_SIZE - 1) edgePixels += 1;
        }
      }
      frames.push({ edgePixels, hash: createHash('sha256').update(pixels).digest('hex'), opaquePixels });
    }
  }
  return { frames, height: image.height, width: image.width };
};

const movement = atlasMetrics(resolve(ROOT, 'public/assets/prey-v3/elk-atlas.png'), 6);
const actions = atlasMetrics(resolve(ROOT, 'public/assets/prey-v3/elk-actions.png'), 12);
const baseline = { version: 1, movement: movement.frames, actions: actions.frames };

if (process.env.UPDATE_ELK_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

describe('elk artwork', () => {
  it('provides a complete eight-direction movement atlas', () => {
    expect(movement.width).toBe(1_448);
    expect(movement.height).toBe(1_086);
    expect(movement.frames).toHaveLength(48);
    for (const frame of movement.frames) {
      expect(frame.opaquePixels).toBeGreaterThan(1_500);
      expect(frame.edgePixels).toBe(0);
    }
  });

  it('provides complete four-phase rest, graze, and drink animation rows', () => {
    expect(actions.width).toBe(1_448);
    expect(actions.height).toBe(2_172);
    expect(actions.frames).toHaveLength(96);
    for (const frame of actions.frames) {
      expect(frame.opaquePixels).toBeGreaterThan(1_000);
      expect(frame.edgePixels).toBe(0);
    }
  });

  it('matches the reviewed movement, action, and carcass artwork', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(baseline).toEqual(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  });
});
