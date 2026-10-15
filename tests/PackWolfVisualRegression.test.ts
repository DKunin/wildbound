import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const FRAME_COUNT = 16;
const ALPHA_THRESHOLD = 38;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/pack-wolf-animation-visual-baseline.json');
const DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/pack-wolf-direction-board.png');
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

interface FrameMetrics {
  bbox: [number, number, number, number];
  edgePixels: number;
  hash: string;
  opaquePixels: number;
}

interface VisualBaseline {
  atlases: Record<string, FrameMetrics[]>;
  frameHeight: number;
  frameWidth: number;
  version: number;
}

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
  const length = Math.hypot(direction[0], direction[1]);
  const dx = direction[0] / length;
  const dy = direction[1] / length;
  const startX = cellX + 34 - dx * 14;
  const startY = cellY + 34 - dy * 14;
  const endX = cellX + 34 + dx * 16;
  const endY = cellY + 34 + dy * 16;
  for (let y = 8; y < 60; y += 1) {
    for (let x = 8; x < 60; x += 1) setPixel(image, cellX + x, cellY + y, [7, 22, 20, 220]);
  }
  drawLine(image, Math.round(startX), Math.round(startY), Math.round(endX), Math.round(endY));
  drawLine(image, Math.round(endX), Math.round(endY), Math.round(endX - dx * 9 - dy * 7), Math.round(endY - dy * 9 + dx * 7));
  drawLine(image, Math.round(endX), Math.round(endY), Math.round(endX - dx * 9 + dy * 7), Math.round(endY - dy * 9 - dx * 7));
};

const analyzeFrame = (image: PNG, frame: number): FrameMetrics => {
  const sourceX = (frame % 4) * FRAME_WIDTH;
  const sourceY = Math.floor(frame / 4) * FRAME_HEIGHT;
  const pixels = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 4);
  let minX = FRAME_WIDTH;
  let minY = FRAME_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  let edgePixels = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    image.data.copy(pixels, y * FRAME_WIDTH * 4, sourceStart, sourceStart + FRAME_WIDTH * 4);
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const alpha = pixels[(y * FRAME_WIDTH + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      opaquePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === FRAME_WIDTH - 1 || y === FRAME_HEIGHT - 1) edgePixels += 1;
    }
  }
  return {
    bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
    edgePixels,
    hash: createHash('sha256').update(pixels).digest('hex'),
    opaquePixels,
  };
};

const collectBaseline = (): VisualBaseline => {
  const atlases: Record<string, FrameMetrics[]> = {};
  for (const wolf of ['niva', 'torr']) {
    const image = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `${wolf}-sheet.png`)));
    atlases[wolf] = Array.from({ length: FRAME_COUNT }, (_value, frame) => analyzeFrame(image, frame));
  }
  return { version: 1, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT, atlases };
};

const createDirectionBoard = (): Buffer => {
  const board = new PNG({ width: FRAME_WIDTH * 4, height: FRAME_HEIGHT * 8, colorType: 6 });
  for (let index = 0; index < board.data.length; index += 4) {
    board.data[index] = 16;
    board.data[index + 1] = 24;
    board.data[index + 2] = 19;
    board.data[index + 3] = 255;
  }
  for (const [wolfIndex, wolf] of ['niva', 'torr'].entries()) {
    const atlas = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `${wolf}-sheet.png`)));
    const offsetY = wolfIndex * FRAME_HEIGHT * 4;
    for (let y = 0; y < atlas.height; y += 1) {
      for (let x = 0; x < atlas.width; x += 1) {
        const source = (y * atlas.width + x) * 4;
        const alpha = atlas.data[source + 3] / 255;
        if (alpha <= 0) continue;
        const destination = ((offsetY + y) * board.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          board.data[destination + channel] = Math.round(atlas.data[source + channel] * alpha + board.data[destination + channel] * (1 - alpha));
        }
      }
    }
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) drawDirectionArrow(board, column * FRAME_WIDTH, offsetY + row * FRAME_HEIGHT, DIRECTIONS[row]);
    }
  }
  return PNG.sync.write(board);
};

const actual = collectBaseline();
const directionBoard = createDirectionBoard();
if (process.env.UPDATE_PACK_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  writeFileSync(DIRECTION_BOARD_PATH, directionBoard);
}

describe('pack wolf animation visual regressions', () => {
  it('matches the reviewed frame-by-frame baseline', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const expected = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as VisualBaseline;
    expect(actual).toEqual(expected);
  });

  it('keeps every frame visible and inside its atlas cell', () => {
    const failures: string[] = [];
    for (const [wolf, frames] of Object.entries(actual.atlases)) {
      frames.forEach((frame, index) => {
        if (frame.opaquePixels < 4_000) failures.push(`${wolf}[${index}] collapsed to ${frame.opaquePixels}px`);
        if (frame.edgePixels > 0) failures.push(`${wolf}[${index}] touches cell edge`);
      });
    }
    expect(failures).toEqual([]);
  });

  it('matches the reviewed four-direction gait board', () => {
    expect(existsSync(DIRECTION_BOARD_PATH)).toBe(true);
    expect(directionBoard).toEqual(readFileSync(DIRECTION_BOARD_PATH));
  });
});
