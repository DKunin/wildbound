import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const FRAME_SIZE = 181;
const FRAME_COUNT = 48;
const ACTION_FRAME_SIZE = FRAME_SIZE;
const ACTION_FRAME_COUNT = 24;
const ALPHA_THRESHOLD = 38;
const MIN_COMPONENT_AREA = 100;
const MAX_DETACHED_SHARE = 0.02;

interface FrameMetrics {
  anchor: [number, number];
  root: [number, number];
  bbox: [number, number, number, number];
  components: number[];
  detachedShare: number;
  edgePixels: number;
  hash: string;
  opaquePixels: number;
}

interface VisualBaseline {
  atlases: Record<string, FrameMetrics[]>;
  frameSizes: Record<string, number>;
  version: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/prey-v2');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/prey-animation-visual-baseline.json');
const RUN_DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/prey-running-direction-board.png');
const ACTION_DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/prey-action-direction-board.png');
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

const createActionDirectionBoard = (): Buffer => {
  const board = new PNG({ width: ACTION_FRAME_SIZE * 8, height: ACTION_FRAME_SIZE * 6, colorType: 6 });
  for (let index = 0; index < board.data.length; index += 4) {
    board.data[index] = 16;
    board.data[index + 1] = 24;
    board.data[index + 2] = 19;
    board.data[index + 3] = 255;
  }

  for (const [speciesIndex, species] of ['rabbit', 'deer'].entries()) {
    const atlas = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `${species}-actions.png`)));
    for (let phase = 0; phase < 3; phase += 1) {
      const sourceY = phase * ACTION_FRAME_SIZE;
      const destinationY = (speciesIndex * 3 + phase) * ACTION_FRAME_SIZE;
      for (let column = 0; column < 8; column += 1) {
        const sourceX = column * ACTION_FRAME_SIZE;
        for (let y = 0; y < ACTION_FRAME_SIZE; y += 1) {
          for (let x = 0; x < ACTION_FRAME_SIZE; x += 1) {
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

const analyzeFrame = (image: PNG, frame: number, frameSize: number): FrameMetrics => {
  const sourceX = (frame % 8) * frameSize;
  const sourceY = Math.floor(frame / 8) * frameSize;
  const pixels = Buffer.alloc(frameSize * frameSize * 4);
  const occupied = new Uint8Array(frameSize * frameSize);
  let minX = frameSize;
  let minY = frameSize;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  let edgePixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < frameSize; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    image.data.copy(pixels, y * frameSize * 4, sourceStart, sourceStart + frameSize * 4);
    for (let x = 0; x < frameSize; x += 1) {
      const pixel = y * frameSize + x;
      const alpha = pixels[pixel * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      occupied[pixel] = 1;
      opaquePixels += 1;
      alphaWeight += alpha;
      weightedX += x * alpha;
      weightedY += y * alpha;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === frameSize - 1 || y === frameSize - 1) edgePixels += 1;
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
      const x = pixel % frameSize;
      const y = Math.floor(pixel / frameSize);
      area += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= frameSize || nextY < 0 || nextY >= frameSize) continue;
          const next = nextY * frameSize + nextX;
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
    anchor: [(minX + maxX) / 2, maxY],
    root: [weightedX / alphaWeight, weightedY / alphaWeight],
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
    atlases[species] = Array.from({ length: FRAME_COUNT }, (_value, frame) => analyzeFrame(image, frame, FRAME_SIZE));
    const actions = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, `${species}-actions.png`)));
    atlases[`${species}-actions`] = Array.from({ length: ACTION_FRAME_COUNT }, (_value, frame) => analyzeFrame(actions, frame, ACTION_FRAME_SIZE));
  }
  return {
    version: 2,
    frameSizes: { rabbit: FRAME_SIZE, deer: FRAME_SIZE, 'rabbit-actions': ACTION_FRAME_SIZE, 'deer-actions': ACTION_FRAME_SIZE },
    atlases,
  };
};

const actual = collectBaseline();
const runningDirectionBoard = createRunningDirectionBoard();
const actionDirectionBoard = createActionDirectionBoard();
if (process.env.UPDATE_PREY_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  writeFileSync(RUN_DIRECTION_BOARD_PATH, runningDirectionBoard);
  writeFileSync(ACTION_DIRECTION_BOARD_PATH, actionDirectionBoard);
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

  it('keeps both standing frames on the same anatomical root', () => {
    const failures: string[] = [];
    for (const species of ['rabbit', 'deer']) {
      for (let direction = 0; direction < 8; direction += 1) {
        const first = actual.atlases[species][direction];
        const second = actual.atlases[species][8 + direction];
        const step = Math.hypot(first.root[0] - second.root[0], first.root[1] - second.root[1]);
        if (step > 2) failures.push(`${species}[${direction}] standing root step ${step.toFixed(1)}px`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('uses true northwest deer frames instead of southwest artwork', () => {
    for (const [filename, rows] of [['deer-atlas.png', [2, 3, 4]], ['deer-actions.png', [0, 1, 2]]] as const) {
      const atlas = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, filename)));
      for (const row of rows) {
        const northeast = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
        const northwest = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
        for (let y = 0; y < FRAME_SIZE; y += 1) {
          for (let x = 0; x < FRAME_SIZE; x += 1) {
            const target = (y * FRAME_SIZE + x) * 4;
            const northeastSource = ((row * FRAME_SIZE + y) * atlas.width + FRAME_SIZE + (FRAME_SIZE - 1 - x)) * 4;
            const northwestSource = ((row * FRAME_SIZE + y) * atlas.width + FRAME_SIZE * 3 + x) * 4;
            atlas.data.copy(northeast, target, northeastSource, northeastSource + 4);
            atlas.data.copy(northwest, target, northwestSource, northwestSource + 4);
          }
        }
        expect(northwest, `${filename} northwest row ${row}`).toEqual(northeast);
      }
    }
  });

  it('matches the reviewed running direction board for all gait phases', () => {
    expect(existsSync(RUN_DIRECTION_BOARD_PATH)).toBe(true);
    expect(runningDirectionBoard).toEqual(readFileSync(RUN_DIRECTION_BOARD_PATH));
  });

  it('matches the reviewed rest, eating and drinking direction board', () => {
    expect(existsSync(ACTION_DIRECTION_BOARD_PATH)).toBe(true);
    expect(actionDirectionBoard).toEqual(readFileSync(ACTION_DIRECTION_BOARD_PATH));
  });
});
