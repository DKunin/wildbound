import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frameSize = 181;
const carcassSourcePath = resolve(root, 'art-source/elk-v1/elk-carcass-source.png');
const atlases = [
  { path: resolve(root, 'public/assets/prey-v3/elk-atlas.png'), rows: 6 },
  { path: resolve(root, 'public/assets/prey-v3/elk-actions.png'), rows: 3 },
];

const installCarcassRow = (atlas) => {
  const source = PNG.sync.read(readFileSync(carcassSourcePath));
  const targetRow = 5;
  for (let column = 0; column < 8; column += 1) {
    const sourceLeft = Math.round(column * source.width / 8);
    const sourceRight = Math.round((column + 1) * source.width / 8);
    const sourceWidth = sourceRight - sourceLeft;
    const occupied = new Uint8Array(sourceWidth * source.height);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        occupied[y * sourceWidth + x] = source.data[(y * source.width + sourceLeft + x) * 4 + 3] >= 12 ? 1 : 0;
      }
    }
    const visited = new Uint8Array(occupied.length);
    const queue = new Int32Array(occupied.length);
    let largest = [];
    for (let start = 0; start < occupied.length; start += 1) {
      if (!occupied[start] || visited[start]) continue;
      const pixels = [];
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      while (head < tail) {
        const pixel = queue[head++];
        pixels.push(pixel);
        const x = pixel % sourceWidth;
        const y = Math.floor(pixel / sourceWidth);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= sourceWidth || nextY < 0 || nextY >= source.height) continue;
            const next = nextY * sourceWidth + nextX;
            if (!occupied[next] || visited[next]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      if (pixels.length > largest.length) largest = pixels;
    }
    if (largest.length === 0) throw new Error(`Elk carcass cell ${column} is empty.`);
    const mask = new Uint8Array(occupied.length);
    let minX = sourceWidth;
    let minY = source.height;
    let maxX = 0;
    let maxY = 0;
    for (const pixel of largest) {
      mask[pixel] = 1;
      const x = pixel % sourceWidth;
      const y = Math.floor(pixel / sourceWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const spriteWidth = maxX - minX + 1;
    const spriteHeight = maxY - minY + 1;
    const scale = Math.min(150 / spriteWidth, 140 / spriteHeight);
    const outputWidth = Math.max(1, Math.round(spriteWidth * scale));
    const outputHeight = Math.max(1, Math.round(spriteHeight * scale));
    const targetLeft = column * frameSize + Math.round((frameSize - outputWidth) / 2);
    const targetTop = targetRow * frameSize + 168 - outputHeight;
    for (let y = 0; y < frameSize; y += 1) {
      const offset = ((((targetRow * frameSize) + y) * atlas.width) + column * frameSize) * 4;
      atlas.data.fill(0, offset, offset + frameSize * 4);
    }
    for (let y = 0; y < outputHeight; y += 1) {
      const sourceY = minY + Math.min(spriteHeight - 1, Math.round(y / scale));
      for (let x = 0; x < outputWidth; x += 1) {
        const sourceX = minX + Math.min(spriteWidth - 1, Math.round(x / scale));
        if (!mask[sourceY * sourceWidth + sourceX]) continue;
        const from = ((sourceY * source.width) + sourceLeft + sourceX) * 4;
        const to = (((targetTop + y) * atlas.width) + targetLeft + x) * 4;
        source.data.copy(atlas.data, to, from, from + 4);
      }
    }
  }
};

const cleanFrame = (image, column, row) => {
  const left = column * frameSize;
  const top = row * frameSize;
  const occupied = new Uint8Array(frameSize * frameSize);
  for (let y = 0; y < frameSize; y += 1) {
    for (let x = 0; x < frameSize; x += 1) {
      const alpha = image.data[(((top + y) * image.width) + left + x) * 4 + 3];
      occupied[y * frameSize + x] = alpha >= 12 ? 1 : 0;
    }
  }

  const visited = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);
  const components = [];
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || visited[start]) continue;
    const pixels = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const pixel = queue[head++];
      pixels.push(pixel);
      const x = pixel % frameSize;
      const y = Math.floor(pixel / frameSize);
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
    components.push(pixels);
  }

  components.sort((a, b) => b.length - a.length);
  const minimumComponentSize = Math.max(36, Math.floor((components[0]?.length ?? 0) * 0.018));
  const keep = new Uint8Array(occupied.length);
  for (const component of components) {
    if (component.length < minimumComponentSize) continue;
    for (const pixel of component) keep[pixel] = 1;
  }

  for (let y = 0; y < frameSize; y += 1) {
    for (let x = 0; x < frameSize; x += 1) {
      const insideSafeFrame = x >= 2 && y >= 2 && x < frameSize - 2 && y < frameSize - 2;
      if (insideSafeFrame && keep[y * frameSize + x]) continue;
      const offset = (((top + y) * image.width) + left + x) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 0;
    }
  }
};

for (const atlas of atlases) {
  const image = PNG.sync.read(readFileSync(atlas.path));
  if (image.width !== frameSize * 8 || image.height !== frameSize * atlas.rows) {
    throw new Error(`Unexpected elk atlas dimensions: ${atlas.path} is ${image.width}x${image.height}`);
  }
  if (atlas.rows === 6) installCarcassRow(image);
  for (let row = 0; row < atlas.rows; row += 1) {
    for (let column = 0; column < 8; column += 1) cleanFrame(image, column, row);
  }
  writeFileSync(atlas.path, PNG.sync.write(image));
}
