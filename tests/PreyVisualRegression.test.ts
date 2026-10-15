import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const FRAME_SIZE = 181;
const FRAME_COUNT = 48;
const ALPHA_THRESHOLD = 38;
const MIN_COMPONENT_AREA = 100;
const MAX_DETACHED_SHARE = 0.02;

interface FrameMetrics {
  bbox: [number, number, number, number];
  components: number[];
  detachedShare: number;
  edgePixels: number;
  hash: string;
  opaquePixels: number;
}

interface VisualBaseline {
  atlases: Record<string, FrameMetrics[]>;
  frameSize: number;
  version: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/prey-v2');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/prey-animation-visual-baseline.json');
const RUN_DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/prey-running-direction-board.png');
const RUN_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1],
];

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

const createRunningDirectionBoard = (): Buffer => {
  const board = new PNG({ width: FRAME_SIZE * 8, height: FRAME_SIZE * 6, colorType: 6 });
  for (let index = 0; index < board.data.length; index += 4) {
    board.data[index] = 16;
    board.data[index + 1] = 24;
    board.data[index + 2] = 19;
    board.data[index + 3] = 255;
  }

  for (const [speciesIndex, species] of ['rabbit', 'deer'].entries()) {
    const atlas = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `${species}-atlas.png`)));
    for (let phase = 0; phase < 3; phase += 1) {
      const sourceY = (phase + 2) * FRAME_SIZE;
      const destinationY = (speciesIndex * 3 + phase) * FRAME_SIZE;
      for (let column = 0; column < 8; column += 1) {
        const sourceX = column * FRAME_SIZE;
        for (let y = 0; y < FRAME_SIZE; y += 1) {
          for (let x = 0; x < FRAME_SIZE; x += 1) {
            const source = ((sourceY + y) * atlas.width + sourceX + x) * 4;
            const alpha = atlas.data[source + 3] / 255;
            if (alpha <= 0) continue;
            const destination = ((destinationY + y) * board.width + sourceX + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
              board.data[destination + channel] = Math.round(atlas.data[source + channel] * alpha + board.data[destination + channel] * (1 - alpha));
            }
          }
        }
        drawDirectionArrow(board, sourceX, destinationY, RUN_DIRECTIONS[column]);
      }
    }
  }
  return PNG.sync.write(board);
};

const analyzeFrame = (image: PNG, frame: number): FrameMetrics => {
  const sourceX = (frame % 8) * FRAME_SIZE;
  const sourceY = Math.floor(frame / 8) * FRAME_SIZE;
  const pixels = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  const occupied = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
  let minX = FRAME_SIZE;
  let minY = FRAME_SIZE;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  let edgePixels = 0;

  for (let y = 0; y < FRAME_SIZE; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    image.data.copy(pixels, y * FRAME_SIZE * 4, sourceStart, sourceStart + FRAME_SIZE * 4);
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const pixel = y * FRAME_SIZE + x;
      if (pixels[pixel * 4 + 3] < ALPHA_THRESHOLD) continue;
      occupied[pixel] = 1;
      opaquePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === FRAME_SIZE - 1 || y === FRAME_SIZE - 1) edgePixels += 1;
    }
  }

  const visited = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);
  const components: number[] = [];
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % FRAME_SIZE;
      const y = Math.floor(pixel / FRAME_SIZE);
      area += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= FRAME_SIZE || nextY < 0 || nextY >= FRAME_SIZE) continue;
          const next = nextY * FRAME_SIZE + nextX;
          if (!occupied[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (area >= MIN_COMPONENT_AREA) components.push(area);
  }
  components.sort((left, right) => right - left);
  const significantArea = components.reduce((sum, area) => sum + area, 0);
  const detachedShare = significantArea > 0 ? (significantArea - (components[0] ?? 0)) / significantArea : 0;

  return {
    bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
    components,
    detachedShare: Number(detachedShare.toFixed(5)),
    edgePixels,
    hash: createHash('sha256').update(pixels).digest('hex'),
    opaquePixels,
  };
};

const collectBaseline = (): VisualBaseline => {
  const atlases: Record<string, FrameMetrics[]> = {};
  for (const species of ['rabbit', 'deer']) {
    const image = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `${species}-atlas.png`)));
    atlases[species] = Array.from({ length: FRAME_COUNT }, (_value, frame) => analyzeFrame(image, frame));
  }
  return { version: 1, frameSize: FRAME_SIZE, atlases };
};

const actual = collectBaseline();
const runningDirectionBoard = createRunningDirectionBoard();
if (process.env.UPDATE_PREY_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  writeFileSync(RUN_DIRECTION_BOARD_PATH, runningDirectionBoard);
}

describe('prey animation visual regressions', () => {
  it('matches the reviewed rabbit and deer frame baseline', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const expected = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as VisualBaseline;
    expect(actual).toEqual(expected);
  });

  it('keeps every directional, idle, movement and dead frame contained and connected', () => {
    const failures: string[] = [];
    for (const [species, frames] of Object.entries(actual.atlases)) {
      frames.forEach((frame, index) => {
        if (frame.opaquePixels < 1_500) failures.push(`${species}[${index}] collapsed to ${frame.opaquePixels}px`);
        if (frame.detachedShare > MAX_DETACHED_SHARE) failures.push(`${species}[${index}] detached ${(frame.detachedShare * 100).toFixed(1)}%`);
        if (frame.edgePixels > 0) failures.push(`${species}[${index}] touches cell edge`);
      });
    }
    expect(failures).toEqual([]);
  });

  it('matches the reviewed running direction board for all gait phases', () => {
    expect(existsSync(RUN_DIRECTION_BOARD_PATH)).toBe(true);
    expect(runningDirectionBoard).toEqual(readFileSync(RUN_DIRECTION_BOARD_PATH));
  });
});
