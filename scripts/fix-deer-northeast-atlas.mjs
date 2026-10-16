import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const atlasPath = resolve(root, 'public/assets/prey-v2/deer-atlas.png');
const sourcePath = resolve(root, 'public/assets/deer-sheet.png');
const frameSize = 181;
const atlas = PNG.sync.read(readFileSync(atlasPath));
const source = PNG.sync.read(readFileSync(sourcePath));

const alphaAt = (image, x, y) => image.data[(y * image.width + x) * 4 + 3];

const largestComponent = (image, left, top, width, height) => {
  const occupied = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      occupied[y * width + x] = alphaAt(image, left + x, top + y) >= 28 ? 1 : 0;
    }
  }
  const visited = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);
  let best = [];
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || visited[start]) continue;
    const component = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const pixel = queue[head++];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!occupied[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (component.length > best.length) best = component;
  }
  if (best.length === 0) throw new Error('Deer source frame contains no visible sprite.');
  const mask = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const pixel of best) {
    mask[pixel] = 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { mask, minX, minY, maxX, maxY, width, height, left, top };
};

const clearCell = (column, row) => {
  for (let y = 0; y < frameSize; y += 1) {
    const offset = (((row * frameSize + y) * atlas.width) + column * frameSize) * 4;
    atlas.data.fill(0, offset, offset + frameSize * 4);
  }
};

const drawSourceFrame = (sourceColumn, targetColumn, targetRow) => {
  const sourceLeft = Math.round(sourceColumn * source.width / 4);
  const sourceRight = Math.round((sourceColumn + 1) * source.width / 4);
  const sourceTop = Math.round(2 * source.height / 4);
  const sourceBottom = Math.round(3 * source.height / 4);
  const component = largestComponent(source, sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop);
  const spriteWidth = component.maxX - component.minX + 1;
  const spriteHeight = component.maxY - component.minY + 1;
  const scale = Math.min(130 / spriteWidth, 140 / spriteHeight);
  const outputWidth = Math.max(1, Math.round(spriteWidth * scale));
  const outputHeight = Math.max(1, Math.round(spriteHeight * scale));
  const targetLeft = Math.round((frameSize - outputWidth) / 2);
  const targetTop = 169 - outputHeight;
  clearCell(targetColumn, targetRow);

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = component.minY + Math.min(spriteHeight - 1, Math.round(y / scale));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = component.minX + Math.min(spriteWidth - 1, Math.round(x / scale));
      if (!component.mask[sourceY * component.width + sourceX]) continue;
      const from = (((component.top + sourceY) * source.width) + component.left + sourceX) * 4;
      const targetX = targetLeft + x;
      const to = (((targetRow * frameSize + targetTop + y) * atlas.width) + targetColumn * frameSize + targetX) * 4;
      source.data.copy(atlas.data, to, from, from + 4);
    }
  }
};

const mirrorCell = (sourceColumn, targetColumn, row) => {
  clearCell(targetColumn, row);
  for (let y = 0; y < frameSize; y += 1) {
    for (let x = 0; x < frameSize; x += 1) {
      const from = ((((row * frameSize) + y) * atlas.width) + sourceColumn * frameSize + x) * 4;
      const to = ((((row * frameSize) + y) * atlas.width) + targetColumn * frameSize + frameSize - 1 - x) * 4;
      atlas.data.copy(atlas.data, to, from, from + 4);
    }
  }
};

for (const [row, sourceColumn] of [[2, 0], [3, 1], [4, 3]]) {
  drawSourceFrame(sourceColumn, 1, row);
  mirrorCell(1, 3, row);
}

writeFileSync(atlasPath, PNG.sync.write(atlas));
