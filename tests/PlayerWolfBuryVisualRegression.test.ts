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
const ASSET_ROOT = resolve(ROOT, 'public/assets/player-wolf-v2');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/player-wolf-bury-visual-baseline.json');
const DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/player-wolf-bury-direction-board.png');

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
const sourcePoseByPhase = [5, 6, 7, 8, 9, 8, 7, 6] as const;

type Direction = keyof typeof directions;

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

const readAtlas = (direction: Direction, bury = true): PNG => PNG.sync.read(readFileSync(resolve(
  ASSET_ROOT,
  `wolf-${direction}-${bury ? 'bury' : 'action'}.png`,
)));

const framePixels = (image: PNG, frame: number): Buffer => {
  const pixels = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 4);
  const sourceX = (frame % 4) * FRAME_WIDTH;
  const sourceY = Math.floor(frame / 4) * FRAME_HEIGHT;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    image.data.copy(pixels, y * FRAME_WIDTH * 4, sourceStart, sourceStart + FRAME_WIDTH * 4);
  }
  return pixels;
};

const analyzeFrame = (image: PNG, frame: number): FrameMetrics => {
  const pixels = framePixels(image, frame);
  let minX = FRAME_WIDTH;
  let minY = FRAME_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  let edgePixels = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
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
  for (const direction of Object.keys(directions) as Direction[]) {
    const atlas = readAtlas(direction);
    atlases[direction] = Array.from({ length: FRAME_COUNT }, (_value, frame) => analyzeFrame(atlas, frame));
  }
  return { version: 1, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT, atlases };
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
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        setPixel(image, x + offsetX, y + offsetY, [229, 179, 81, 255]);
      }
    }
  }
};

const drawDirectionArrow = (
  image: PNG,
  cellX: number,
  cellY: number,
  direction: readonly [number, number],
): void => {
  const length = Math.hypot(direction[0], direction[1]);
  const dx = direction[0] / length;
  const dy = direction[1] / length;
  for (let y = 8; y < 58; y += 1) {
    for (let x = 8; x < 58; x += 1) setPixel(image, cellX + x, cellY + y, [23, 25, 21, 224]);
  }
  const startX = cellX + 33 - dx * 13;
  const startY = cellY + 33 - dy * 13;
  const endX = cellX + 33 + dx * 15;
  const endY = cellY + 33 + dy * 15;
  drawLine(image, Math.round(startX), Math.round(startY), Math.round(endX), Math.round(endY));
  drawLine(image, Math.round(endX), Math.round(endY), Math.round(endX - dx * 9 - dy * 7), Math.round(endY - dy * 9 + dx * 7));
  drawLine(image, Math.round(endX), Math.round(endY), Math.round(endX - dx * 9 + dy * 7), Math.round(endY - dy * 9 - dx * 7));
};

const compositeFrame = (board: PNG, atlas: PNG, frame: number, cellX: number, cellY: number): void => {
  const pixels = framePixels(atlas, frame);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const source = (y * FRAME_WIDTH + x) * 4;
      const alpha = pixels[source + 3] / 255;
      if (alpha <= 0) continue;
      const destination = ((cellY + y) * board.width + cellX + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        board.data[destination + channel] = Math.round(
          pixels[source + channel] * alpha + board.data[destination + channel] * (1 - alpha),
        );
      }
    }
  }
};

const createDirectionBoard = (): Buffer => {
  const board = new PNG({ width: FRAME_WIDTH * 4, height: FRAME_HEIGHT * 4, colorType: 6 });
  for (let index = 0; index < board.data.length; index += 4) {
    board.data[index] = 20;
    board.data[index + 1] = 29;
    board.data[index + 2] = 23;
    board.data[index + 3] = 255;
  }
  (Object.keys(directions) as Direction[]).forEach((direction, directionIndex) => {
    const atlas = readAtlas(direction);
    [2, 7].forEach((frame, phaseIndex) => {
      const boardIndex = directionIndex * 2 + phaseIndex;
      const cellX = (boardIndex % 4) * FRAME_WIDTH;
      const cellY = Math.floor(boardIndex / 4) * FRAME_HEIGHT;
      compositeFrame(board, atlas, frame, cellX, cellY);
      drawDirectionArrow(board, cellX, cellY, directions[direction]);
    });
  });
  return PNG.sync.write(board);
};

const largestConnectedComponentRatio = (pixels: Buffer): number => {
  const visible = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  let visibleCount = 0;
  for (let index = 0; index < visible.length; index += 1) {
    if (pixels[index * 4 + 3] < ALPHA_THRESHOLD) continue;
    visible[index] = 1;
    visibleCount += 1;
  }
  const visited = new Uint8Array(visible.length);
  const queue = new Int32Array(visible.length);
  let largest = 0;
  for (let start = 0; start < visible.length; start += 1) {
    if (!visible[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    let size = 0;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      size += 1;
      const x = current % FRAME_WIDTH;
      const y = Math.floor(current / FRAME_WIDTH);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= FRAME_WIDTH || nextY < 0 || nextY >= FRAME_HEIGHT) continue;
          const next = nextY * FRAME_WIDTH + nextX;
          if (!visible[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest / Math.max(1, visibleCount);
};

const actual = collectBaseline();
const directionBoard = createDirectionBoard();
if (process.env.UPDATE_WOLF_BURY_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  writeFileSync(DIRECTION_BOARD_PATH, directionBoard);
}

describe('player wolf burial visual regressions', () => {
  it('matches the reviewed frame hashes and directional burial board', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as VisualBaseline);
    expect(existsSync(DIRECTION_BOARD_PATH)).toBe(true);
    expect(directionBoard).toEqual(readFileSync(DIRECTION_BOARD_PATH));
  });

  it('keeps all 128 frames visible, unclipped, and on the 346x284 grid', () => {
    const failures: string[] = [];
    for (const direction of Object.keys(directions) as Direction[]) {
      const atlas = readAtlas(direction);
      if (atlas.width < FRAME_WIDTH * 4 || atlas.height !== FRAME_HEIGHT * 4) {
        failures.push(`${direction} atlas is ${atlas.width}x${atlas.height}`);
      }
      actual.atlases[direction].forEach((frame, index) => {
        if (frame.opaquePixels < 10_000) failures.push(`${direction}[${index}] collapsed to ${frame.opaquePixels}px`);
        if (frame.edgePixels !== 0) failures.push(`${direction}[${index}] touches a cell edge`);
      });
    }
    expect(failures).toEqual([]);
  });

  it('preserves a connected directional wolf while adding a distinct cache in front', () => {
    const failures: string[] = [];
    for (const direction of Object.keys(directions) as Direction[]) {
      const [directionX, directionY] = directions[direction];
      const action = readAtlas(direction, false);
      const burial = readAtlas(direction);
      for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
        const sourceFrame = sourcePoseByPhase[Math.min(frame, 7)];
        const source = framePixels(action, sourceFrame);
        const output = framePixels(burial, frame);
        const label = `${direction}[${frame}]`;
        let minX = FRAME_WIDTH;
        let minY = FRAME_HEIGHT;
        let maxX = -1;
        let maxY = -1;
        let addedPixels = 0;
        let addedX = 0;
        let addedY = 0;
        let removedWolfPixels = 0;
        let changedPixels = 0;
        for (let y = 0; y < FRAME_HEIGHT; y += 1) {
          for (let x = 0; x < FRAME_WIDTH; x += 1) {
            const offset = (y * FRAME_WIDTH + x) * 4;
            const sourceVisible = source[offset + 3] >= ALPHA_THRESHOLD;
            const outputVisible = output[offset + 3] >= ALPHA_THRESHOLD;
            if (sourceVisible) {
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
            if (!sourceVisible && outputVisible) {
              addedPixels += 1;
              addedX += x;
              addedY += y;
            }
            if (sourceVisible && !outputVisible) removedWolfPixels += 1;
            if (
              source[offset] !== output[offset]
              || source[offset + 1] !== output[offset + 1]
              || source[offset + 2] !== output[offset + 2]
              || source[offset + 3] !== output[offset + 3]
            ) changedPixels += 1;
          }
        }
        if (largestConnectedComponentRatio(source) < 0.985) failures.push(`${label} wolf body is disconnected`);
        if (removedWolfPixels !== 0) failures.push(`${label} removes ${removedWolfPixels} wolf pixels`);
        if (addedPixels < 300) failures.push(`${label} cache adds only ${addedPixels}px`);
        if (changedPixels < 1_000) failures.push(`${label} is too similar to its eating source pose`);
        if (addedPixels > 0) {
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          const forwardOffset = (addedX / addedPixels - centerX) * directionX
            + (addedY / addedPixels - centerY) * directionY;
          if (forwardOffset < 40) failures.push(`${label} cache is not ahead of the wolf (${forwardOffset.toFixed(1)}px)`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('holds the completed burial pose after the reviewed eight-frame action', () => {
    const failures: string[] = [];
    for (const direction of Object.keys(directions) as Direction[]) {
      const atlas = readAtlas(direction);
      const completed = framePixels(atlas, 7);
      for (let frame = 8; frame < FRAME_COUNT; frame += 1) {
        if (!completed.equals(framePixels(atlas, frame))) failures.push(`${direction}[${frame}]`);
      }
    }
    expect(failures).toEqual([]);
  });
});
