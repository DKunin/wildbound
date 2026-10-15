import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const ALPHA_THRESHOLD = 38;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/player-wolf-v2');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/player-wolf-carry-visual-baseline.json');

const directions = {
  east: [1, 0],
  northeast: [Math.SQRT1_2, -Math.SQRT1_2],
  north: [0, -1],
  northwest: [-Math.SQRT1_2, -Math.SQRT1_2],
  west: [-1, 0],
  southwest: [-Math.SQRT1_2, Math.SQRT1_2],
  south: [0, 1],
  southeast: [Math.SQRT1_2, Math.SQRT1_2],
} as const;
const atlasKinds = ['motion', 'run', 'rest', 'crouch'] as const;

interface VisualBaseline {
  frames: Record<string, string[]>;
  version: number;
}

const readAtlas = (direction: keyof typeof directions, kind: typeof atlasKinds[number], carrying: boolean): PNG => (
  PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `wolf-${direction}-${kind}${carrying ? '-carry' : ''}.png`)))
);

const framePixels = (image: PNG, frame: number): Buffer => {
  const result = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 4);
  const sourceX = (frame % 4) * FRAME_WIDTH;
  const sourceY = Math.floor(frame / 4) * FRAME_HEIGHT;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    image.data.copy(result, y * FRAME_WIDTH * 4, sourceStart, sourceStart + FRAME_WIDTH * 4);
  }
  return result;
};

const collectBaseline = (): VisualBaseline => {
  const frames: Record<string, string[]> = {};
  for (const direction of Object.keys(directions) as Array<keyof typeof directions>) {
    for (const kind of atlasKinds) {
      const atlas = readAtlas(direction, kind, true);
      frames[`${direction}-${kind}`] = Array.from({ length: 16 }, (_, frame) => (
        createHash('sha256').update(framePixels(atlas, frame)).digest('hex')
      ));
    }
  }
  return { version: 1, frames };
};

const actual = collectBaseline();
if (process.env.UPDATE_WOLF_CARRY_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
}

describe('player wolf carrying visual regressions', () => {
  it('matches the reviewed frame-by-frame carrying baseline', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as VisualBaseline);
  });

  it('adds a visible, attached bundle near the muzzle without removing wolf artwork', () => {
    const failures: string[] = [];
    for (const direction of Object.keys(directions) as Array<keyof typeof directions>) {
      const [directionX, directionY] = directions[direction];
      for (const kind of atlasKinds) {
        const original = readAtlas(direction, kind, false);
        const carrying = readAtlas(direction, kind, true);
        if (carrying.width !== original.width || carrying.height !== original.height) {
          failures.push(`${direction}-${kind} atlas dimensions changed`);
          continue;
        }
        for (let frame = 0; frame < 16; frame += 1) {
          const base = framePixels(original, frame);
          const carry = framePixels(carrying, frame);
          let minX = FRAME_WIDTH;
          let minY = FRAME_HEIGHT;
          let maxX = -1;
          let maxY = -1;
          let added = 0;
          let lost = 0;
          let addedX = 0;
          let addedY = 0;
          let edge = 0;
          for (let y = 0; y < FRAME_HEIGHT; y += 1) {
            for (let x = 0; x < FRAME_WIDTH; x += 1) {
              const offset = (y * FRAME_WIDTH + x) * 4;
              const baseVisible = base[offset + 3] >= ALPHA_THRESHOLD;
              const carryVisible = carry[offset + 3] >= ALPHA_THRESHOLD;
              if (baseVisible) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
              }
              if (!baseVisible && carryVisible) {
                added += 1;
                addedX += x;
                addedY += y;
              }
              if (baseVisible && !carryVisible) lost += 1;
              if (carryVisible && (x === 0 || y === 0 || x === FRAME_WIDTH - 1 || y === FRAME_HEIGHT - 1)) edge += 1;
            }
          }
          const label = `${direction}-${kind}[${frame}]`;
          if (lost !== 0) failures.push(`${label} removes ${lost} wolf pixels`);
          if (added < 90 || added > 1_600) failures.push(`${label} adds ${added} meat pixels`);
          if (edge !== 0) failures.push(`${label} touches frame edge with ${edge} pixels`);
          if (added > 0) {
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const forwardOffset = (addedX / added - centerX) * directionX + (addedY / added - centerY) * directionY;
            if (forwardOffset < 10) failures.push(`${label} bundle is not in front of the wolf (${forwardOffset.toFixed(1)}px)`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
