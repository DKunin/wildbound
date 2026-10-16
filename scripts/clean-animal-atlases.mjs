import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const alphaFloor = 16;
const auditRoot = resolve(root, 'art-source/animal-audit-v1');

const atlas = (path, frameWidth, frameHeight, cleanComponents = true) => ({
  path: resolve(root, path), frameWidth, frameHeight, cleanComponents,
});

const inputs = [
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
  atlas('public/assets/balance-v1/deer-kick.png', 181, 181),
  ...readdirSync(resolve(root, 'public/assets/player-wolf-v2'))
    .filter((file) => file.endsWith('.png'))
    .map((file) => atlas(`public/assets/player-wolf-v2/${file}`, 346, 284, false)),
].filter((entry) => existsSync(entry.path));

const isSuspiciousMatte = (red, green, blue, alpha) => alpha > alphaFloor && alpha < 128 && (
  (green > red * 1.4 && green > blue * 1.25 && green - Math.min(red, blue) > 50)
  || (red > green * 1.35 && blue > green * 1.3 && Math.min(red, blue) - green > 45)
);

const findInteriorColor = (image, x, y, left, top, frameWidth, frameHeight) => {
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const sampleX = x + offsetX;
        const sampleY = y + offsetY;
        if (sampleX < left || sampleX >= left + frameWidth || sampleY < top || sampleY >= top + frameHeight) continue;
        const sample = (sampleY * image.width + sampleX) * 4;
        if (image.data[sample + 3] >= 160) return [image.data[sample], image.data[sample + 1], image.data[sample + 2]];
      }
    }
  }
  return undefined;
};

const cleanFrame = (image, left, top, frameWidth, frameHeight, cleanComponents) => {
  const occupied = new Uint8Array(frameWidth * frameHeight);
  let removedFloorPixels = 0;
  let despilledPixels = 0;
  let removedComponentPixels = 0;

  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const offset = ((top + y) * image.width + left + x) * 4;
      const alpha = image.data[offset + 3];
      if (alpha <= alphaFloor) {
        if (alpha > 0) removedFloorPixels += 1;
        image.data.fill(0, offset, offset + 4);
        continue;
      }
      occupied[y * frameWidth + x] = 1;
      if (isSuspiciousMatte(image.data[offset], image.data[offset + 1], image.data[offset + 2], alpha)) {
        const interior = findInteriorColor(image, left + x, top + y, left, top, frameWidth, frameHeight);
        if (interior) {
          image.data[offset] = interior[0];
          image.data[offset + 1] = interior[1];
          image.data[offset + 2] = interior[2];
          despilledPixels += 1;
        }
      }
    }
  }

  if (cleanComponents) {
    const visited = new Uint8Array(occupied.length);
    const queue = new Int32Array(occupied.length);
    const components = [];
    for (let start = 0; start < occupied.length; start += 1) {
      if (!occupied[start] || visited[start]) continue;
      const pixels = [];
      let head = 0;
      let tail = 0;
      visited[start] = 1;
      queue[tail++] = start;
      while (head < tail) {
        const pixel = queue[head++];
        pixels.push(pixel);
        const x = pixel % frameWidth;
        const y = Math.floor(pixel / frameWidth);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (nextX < 0 || nextX >= frameWidth || nextY < 0 || nextY >= frameHeight) continue;
            const next = nextY * frameWidth + nextX;
            if (!occupied[next] || visited[next]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      components.push(pixels);
    }
    components.sort((leftComponent, rightComponent) => rightComponent.length - leftComponent.length);
    const minimumSize = Math.max(24, Math.floor((components[0]?.length ?? 0) * 0.003));
    for (const component of components) {
      if (component.length >= minimumSize) continue;
      for (const pixel of component) {
        const x = pixel % frameWidth;
        const y = Math.floor(pixel / frameWidth);
        const offset = ((top + y) * image.width + left + x) * 4;
        image.data.fill(0, offset, offset + 4);
        removedComponentPixels += 1;
      }
    }
  }

  return { despilledPixels, removedComponentPixels, removedFloorPixels };
};

const report = [];
for (const input of inputs) {
  const image = PNG.sync.read(readFileSync(input.path));
  const columns = Math.floor(image.width / input.frameWidth);
  const rows = Math.floor(image.height / input.frameHeight);
  const trailingWidth = image.width - columns * input.frameWidth;
  const trailingHeight = image.height - rows * input.frameHeight;
  if (columns < 1 || rows < 1 || trailingWidth > 1 || trailingHeight > 1) {
    throw new Error(`${relative(root, input.path)} does not align to ${input.frameWidth}x${input.frameHeight} cells`);
  }
  const totals = { despilledPixels: 0, removedComponentPixels: 0, removedFloorPixels: 0 };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const top = row * input.frameHeight;
      const left = column * input.frameWidth;
      const frame = cleanFrame(image, left, top, input.frameWidth, input.frameHeight, input.cleanComponents);
      for (const key of Object.keys(totals)) totals[key] += frame[key];
    }
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = columns * input.frameWidth; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data.fill(0, offset, offset + 4);
    }
  }
  for (let y = rows * input.frameHeight; y < image.height; y += 1) {
    image.data.fill(0, y * image.width * 4, (y + 1) * image.width * 4);
  }
  writeFileSync(input.path, PNG.sync.write(image));
  report.push({ file: relative(root, input.path), ...totals });
}

mkdirSync(auditRoot, { recursive: true });
writeFileSync(resolve(auditRoot, 'cleanup-report.json'), `${JSON.stringify({
  version: 1,
  alphaFloor,
  files: report.sort((left, right) => left.file.localeCompare(right.file)),
  totals: report.reduce((totals, file) => ({
    despilledPixels: totals.despilledPixels + file.despilledPixels,
    removedComponentPixels: totals.removedComponentPixels + file.removedComponentPixels,
    removedFloorPixels: totals.removedFloorPixels + file.removedFloorPixels,
  }), { despilledPixels: 0, removedComponentPixels: 0, removedFloorPixels: 0 }),
}, null, 2)}\n`);

console.log(`Cleaned ${report.length} animal atlases (${basename(auditRoot)}/cleanup-report.json).`);
