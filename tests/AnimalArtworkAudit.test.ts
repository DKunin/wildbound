import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYER_ROOT = resolve(ROOT, 'public/assets/player-wolf-v2');
interface AtlasSpec { path: string; frameWidth: number; frameHeight: number }
const atlas = (path: string, frameWidth: number, frameHeight: number): AtlasSpec => ({
  path: resolve(ROOT, path), frameWidth, frameHeight,
});
const specs: AtlasSpec[] = [
  atlas('public/assets/niva-sheet.png', 346, 284),
  atlas('public/assets/torr-sheet.png', 346, 284),
  atlas('public/assets/prey-v2/rabbit-atlas.png', 181, 181),
  atlas('public/assets/prey-v2/rabbit-actions.png', 181, 181),
  atlas('public/assets/prey-v2/deer-atlas.png', 181, 181),
  atlas('public/assets/prey-v2/deer-actions.png', 181, 181),
  atlas('public/assets/prey-v3/elk-atlas.png', 181, 181),
  atlas('public/assets/prey-v3/elk-actions.png', 181, 181),
  atlas('public/assets/prey-v4/boar-atlas.png', 181, 181),
  atlas('public/assets/prey-v4/boar-actions.png', 181, 181),
  atlas('public/assets/prey-v4/boar-charge.png', 181, 181),
  atlas('public/assets/balance-v1/deer-kick.png', 181, 181),
  ...readdirSync(PLAYER_ROOT)
    .filter((file) => file.endsWith('.png') && file !== 'wolf-model-v2.png')
    .map((file) => atlas(`public/assets/player-wolf-v2/${file}`, 346, 284)),
];

describe('animal artwork hygiene', () => {
  it('keeps every runtime frame visible, contained, and free from low-alpha matte haze', () => {
    const failures: string[] = [];
    for (const spec of specs) {
      const image = PNG.sync.read(readFileSync(spec.path));
      const columns = Math.floor(image.width / spec.frameWidth);
      const rows = Math.floor(image.height / spec.frameHeight);
      if (columns < 1 || rows < 1 || image.width - columns * spec.frameWidth > 1 || image.height - rows * spec.frameHeight > 1) {
        failures.push(`${spec.path}: invalid cell grid`);
        continue;
      }
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          let visiblePixels = 0;
          let faintPixels = 0;
          let edgePixels = 0;
          for (let y = 0; y < spec.frameHeight; y += 1) {
            for (let x = 0; x < spec.frameWidth; x += 1) {
              const alpha = image.data[((((row * spec.frameHeight) + y) * image.width) + column * spec.frameWidth + x) * 4 + 3];
              if (alpha > 0 && alpha <= 16) faintPixels += 1;
              if (alpha <= 16) continue;
              visiblePixels += 1;
              if (x === 0 || y === 0 || x === spec.frameWidth - 1 || y === spec.frameHeight - 1) edgePixels += 1;
            }
          }
          const id = `${spec.path}[${row},${column}]`;
          if (visiblePixels === 0) failures.push(`${id}: empty`);
          if (faintPixels > 0) failures.push(`${id}: ${faintPixels} low-alpha pixels`);
          if (edgePixels > 0) failures.push(`${id}: ${edgePixels} pixels touch the cell edge`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
