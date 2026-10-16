import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/prey-v4');
const FRAME_SIZE = 181;
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/boar-art-visual-baseline.json');
const DIRECTION_BOARD_PATH = resolve(ROOT, 'tests/fixtures/boar-direction-board.png');
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1],
];

const metrics = (file: string, rows: number, columns = 8) => {
  const image = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, file)));
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pixels = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
      let visiblePixels = 0;
      let edgePixels = 0;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        const source = (((row * FRAME_SIZE + y) * image.width) + column * FRAME_SIZE) * 4;
        image.data.copy(pixels, y * FRAME_SIZE * 4, source, source + FRAME_SIZE * 4);
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const alpha = pixels[(y * FRAME_SIZE + x) * 4 + 3];
          if (alpha <= 16) continue;
          visiblePixels += 1;
          if (x === 0 || y === 0 || x === FRAME_SIZE - 1 || y === FRAME_SIZE - 1) edgePixels += 1;
        }
      }
      frames.push({ edgePixels, hash: createHash('sha256').update(pixels).digest('hex'), visiblePixels });
    }
  }
  return { width: image.width, height: image.height, frames };
};

const setPixel = (image: PNG, x: number, y: number, color: readonly [number, number, number, number]): void => {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return;
  image.data.set(color, (y * image.width + x) * 4);
};
const drawLine = (image: PNG, x1: number, y1: number, x2: number, y2: number): void => {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + (x2 - x1) * step / steps);
    const y = Math.round(y1 + (y2 - y1) * step / steps);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) setPixel(image, x + offsetX, y + offsetY, [126, 235, 219, 255]);
    }
  }
};
const directionBoard = (): Buffer => {
  const source = PNG.sync.read(readFileSync(resolve(ASSET_ROOT, 'boar-atlas.png')));
  const board = new PNG({ width: source.width, height: source.height, colorType: 6 });
  for (let index = 0; index < board.data.length; index += 4) board.data.set([16, 24, 19, 255], index);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      board.data[offset + channel] = Math.round(source.data[offset + channel] * alpha + board.data[offset + channel] * (1 - alpha));
    }
  }
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const [rawX, rawY] = DIRECTIONS[column];
      const length = Math.hypot(rawX, rawY);
      const dx = rawX / length;
      const dy = rawY / length;
      const centerX = column * FRAME_SIZE + 27;
      const centerY = row * FRAME_SIZE + 27;
      drawLine(board, Math.round(centerX - dx * 12), Math.round(centerY - dy * 12), Math.round(centerX + dx * 13), Math.round(centerY + dy * 13));
    }
  }
  return PNG.sync.write(board);
};

const movement = metrics('boar-atlas.png', 6);
const actions = metrics('boar-actions.png', 12);
const charge = metrics('boar-charge.png', 8, 4);
const baseline = { version: 2, movement: movement.frames, actions: actions.frames, charge: charge.frames };
const board = directionBoard();
if (process.env.UPDATE_BOAR_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  writeFileSync(DIRECTION_BOARD_PATH, board);
}

describe('boar artwork', () => {
  it('provides complete movement, carcass, action, and retaliation coverage in all eight directions', () => {
    expect(movement).toMatchObject({ width: 1_448, height: 1_086 });
    expect(actions).toMatchObject({ width: 1_448, height: 2_172 });
    expect(charge).toMatchObject({ width: 724, height: 1_448 });
    expect(movement.frames).toHaveLength(48);
    expect(actions.frames).toHaveLength(96);
    expect(charge.frames).toHaveLength(32);
    for (const frame of [...movement.frames, ...actions.frames, ...charge.frames]) {
      expect(frame.visiblePixels).toBeGreaterThan(900);
      expect(frame.edgePixels).toBe(0);
    }
  });
  it('matches the reviewed frame and direction baselines', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(baseline).toEqual(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
    expect(board).toEqual(readFileSync(DIRECTION_BOARD_PATH));
  });
});
