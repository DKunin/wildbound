import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/balance-v1');
const PREY_ROOT = resolve(ROOT, 'public/assets/prey-v2');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/balance-art-visual-baseline.json');
const KICK_DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/deer-kick-direction-board.png');
const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]] as const;

interface FrameMetrics {
  edgePixels: number;
  hash: string;
  opaquePixels: number;
}

const opaqueBounds = (image: PNG, frame: number, frameWidth: number, frameHeight: number, columns: number) => {
  const startX = (frame % columns) * frameWidth;
  const startY = Math.floor(frame / columns) * frameHeight;
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      if (image.data[((startY + y) * image.width + startX + x) * 4 + 3] < 38) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
};

const metrics = (image: PNG, frame: number, frameWidth: number, frameHeight: number, columns: number): FrameMetrics => {
  const startX = (frame % columns) * frameWidth;
  const startY = Math.floor(frame / columns) * frameHeight;
  const pixels = Buffer.alloc(frameWidth * frameHeight * 4);
  let opaquePixels = 0;
  let edgePixels = 0;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const source = ((startY + y) * image.width + startX + x) * 4;
      const target = (y * frameWidth + x) * 4;
      image.data.copy(pixels, target, source, source + 4);
      if (image.data[source + 3] < 38) continue;
      opaquePixels += 1;
      if (x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1) edgePixels += 1;
    }
  }
  return { edgePixels, hash: createHash('sha256').update(pixels).digest('hex'), opaquePixels };
};

const setPixel = (image: PNG, x: number, y: number, color: readonly [number, number, number, number]): void => {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return;
  const offset = (y * image.width + x) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = color[3];
};

const drawLine = (image: PNG, fromX: number, fromY: number, toX: number, toY: number): void => {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(fromX + ((toX - fromX) * step) / steps);
    const y = Math.round(fromY + ((toY - fromY) * step) / steps);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) setPixel(image, x + offsetX, y + offsetY, [126, 235, 219, 255]);
    }
  }
};

const drawDirectionArrow = (image: PNG, cellX: number, cellY: number, direction: readonly [number, number]): void => {
  for (let y = 8; y < 48; y += 1) {
    for (let x = 8; x < 48; x += 1) setPixel(image, cellX + x, cellY + y, [7, 22, 20, 220]);
  }
  const length = Math.hypot(direction[0], direction[1]);
  const dx = direction[0] / length;
  const dy = direction[1] / length;
  const startX = cellX + 28 - dx * 12;
  const startY = cellY + 28 - dy * 12;
  const endX = cellX + 28 + dx * 13;
  const endY = cellY + 28 + dy * 13;
  drawLine(image, Math.round(startX), Math.round(startY), Math.round(endX), Math.round(endY));
  drawLine(image, Math.round(endX), Math.round(endY), Math.round(endX - dx * 8 - dy * 6), Math.round(endY - dy * 8 + dx * 6));
  drawLine(image, Math.round(endX), Math.round(endY), Math.round(endX - dx * 8 + dy * 6), Math.round(endY - dy * 8 - dx * 6));
};

const blitFrame = (source: PNG, sourceX: number, sourceY: number, target: PNG, targetX: number, targetY: number): void => {
  for (let y = 0; y < 181; y += 1) {
    for (let x = 0; x < 181; x += 1) {
      const sourcePixel = ((sourceY + y) * source.width + sourceX + x) * 4;
      const alpha = source.data[sourcePixel + 3] / 255;
      if (alpha <= 0) continue;
      const targetPixel = ((targetY + y) * target.width + targetX + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        target.data[targetPixel + channel] = Math.round(source.data[sourcePixel + channel] * alpha + target.data[targetPixel + channel] * (1 - alpha));
      }
    }
  }
};

const createKickDirectionBoard = (atlas: PNG): Buffer => {
  const board = new PNG({ width: 181 * 8, height: 181 * 4, colorType: 6 });
  for (let index = 0; index < board.data.length; index += 4) {
    board.data[index] = 16;
    board.data[index + 1] = 24;
    board.data[index + 2] = 19;
    board.data[index + 3] = 255;
  }
  for (let direction = 0; direction < 8; direction += 1) {
    for (let phase = 0; phase < 4; phase += 1) {
      blitFrame(atlas, phase * 181, direction * 181, board, direction * 181, phase * 181);
      drawDirectionArrow(board, direction * 181, phase * 181, DIRECTIONS[direction]);
    }
  }
  return PNG.sync.write(board);
};

const centroid = (image: PNG, startX: number, startY: number): [number, number] => {
  let totalX = 0;
  let totalY = 0;
  let count = 0;
  for (let y = 0; y < 181; y += 1) {
    for (let x = 0; x < 181; x += 1) {
      if (image.data[((startY + y) * image.width + startX + x) * 4 + 3] < 38) continue;
      totalX += x;
      totalY += y;
      count += 1;
    }
  }
  return [totalX / count, totalY / count];
};

const kick = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, 'deer-kick.png')));
const wounds = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, 'wound-decals.png')));
const deer = PNG.sync.read(readFileSync(resolve(PREY_ROOT, 'deer-atlas.png')));
const kickDirectionBoard = createKickDirectionBoard(kick);
const actual = {
  version: 2,
  kick: Array.from({ length: 32 }, (_, frame) => metrics(kick, frame, 181, 181, 4)),
  wounds: Array.from({ length: 3 }, (_, frame) => metrics(wounds, frame, 96, 96, 3)),
};

if (process.env.UPDATE_BALANCE_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  writeFileSync(KICK_DIRECTION_BOARD_PATH, kickDirectionBoard);
}

describe('survival balance artwork', () => {
  it('matches the reviewed kick and wound baseline', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  });

  it('keeps every kick and wound sprite visible and inside its cell', () => {
    expect(kick.width).toBe(724);
    expect(kick.height).toBe(1_448);
    expect(wounds.width).toBe(288);
    expect(wounds.height).toBe(96);
    for (const frame of actual.kick) {
      expect(frame.opaquePixels).toBeGreaterThan(2_000);
      expect(frame.edgePixels).toBe(0);
    }
    for (const frame of actual.wounds) {
      expect(frame.opaquePixels).toBeGreaterThan(150);
      expect(frame.edgePixels).toBe(0);
    }
  });

  it('enters and exits retaliation without a direction-specific sprite jump', () => {
    for (let direction = 0; direction < 8; direction += 1) {
      const idle = centroid(deer, direction * 181, 0);
      const ready = centroid(kick, 0, direction * 181);
      const returned = centroid(kick, 3 * 181, direction * 181);
      expect(Math.hypot(idle[0] - ready[0], idle[1] - ready[1]), `direction ${direction} entry`).toBeLessThan(10);
      expect(Math.hypot(idle[0] - returned[0], idle[1] - returned[1]), `direction ${direction} exit`).toBeLessThan(10);
    }
  });

  it('matches the reviewed true-eight-direction kick board', () => {
    expect(existsSync(KICK_DIRECTION_BOARD_PATH)).toBe(true);
    expect(kickDirectionBoard).toEqual(readFileSync(KICK_DIRECTION_BOARD_PATH));
  });

  it('extends the top-down kick behind the pelvis while the head stays anchored', () => {
    // South-facing frames occupy atlas row 6: the head is at the bottom and
    // the hind legs must extend upward, away from it.
    const ready = opaqueBounds(kick, 24, 181, 181, 4);
    const fullExtension = opaqueBounds(kick, 26, 181, 181, 4);
    expect(fullExtension.minY).toBeLessThan(ready.minY - 25);
    expect(Math.abs(fullExtension.maxY - ready.maxY)).toBeLessThanOrEqual(5);
  });
});
