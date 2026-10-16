import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'art-source/balance-v1');
const outputRoot = resolve(root, 'public/assets/balance-v1');
const preyRoot = resolve(root, 'public/assets/prey-v2');
const KICK_CELL = 181;
const WOUND_CELL = 96;
const ALPHA_CUTOFF = 40;

const read = (name) => PNG.sync.read(readFileSync(resolve(sourceRoot, name)));

const findBounds = (image, x0, y0, x1, y1, alphaCutoff = ALPHA_CUTOFF) => {
  let minX = x1;
  let minY = y1;
  let maxX = x0 - 1;
  let maxY = y0 - 1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < alphaCutoff) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error(`No visible pixels in source region ${x0},${y0}-${x1},${y1}`);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const extractBands = (image, count, alphaCutoff = ALPHA_CUTOFF) => Array.from({ length: count }, (_, index) => {
  const x0 = Math.floor(index * image.width / count);
  const x1 = Math.floor((index + 1) * image.width / count);
  return findBounds(image, x0, 0, x1, image.height, alphaCutoff);
});

const sample = (image, x, y, channel) => {
  const sx = Math.max(0, Math.min(image.width - 1, x));
  const sy = Math.max(0, Math.min(image.height - 1, y));
  return image.data[(sy * image.width + sx) * 4 + channel];
};

const bilinear = (image, x, y, channel) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const top = sample(image, x0, y0, channel) * (1 - tx) + sample(image, x1, y0, channel) * tx;
  const bottom = sample(image, x0, y1, channel) * (1 - tx) + sample(image, x1, y1, channel) * tx;
  return Math.round(top * (1 - ty) + bottom * ty);
};

const renderCrop = (image, bounds, cellSize, maximumSize, sharedScale) => {
  const output = new PNG({ width: cellSize, height: cellSize, colorType: 6 });
  const scale = sharedScale ?? Math.min(maximumSize / bounds.width, maximumSize / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const offsetX = Math.floor((cellSize - width) / 2);
  const offsetY = cellSize - height - Math.floor((cellSize - maximumSize) / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = bounds.x + (x + 0.5) / scale - 0.5;
      const sourceY = bounds.y + (y + 0.5) / scale - 0.5;
      const target = ((offsetY + y) * cellSize + offsetX + x) * 4;
      const alpha = bilinear(image, sourceX, sourceY, 3);
      if (alpha < ALPHA_CUTOFF) continue;
      output.data[target] = bilinear(image, sourceX, sourceY, 0);
      output.data[target + 1] = bilinear(image, sourceX, sourceY, 1);
      output.data[target + 2] = bilinear(image, sourceX, sourceY, 2);
      output.data[target + 3] = alpha;
    }
  }
  return output;
};

const transform = (source, angle, mirror = false) => {
  const output = new PNG({ width: source.width, height: source.height, colorType: 6 });
  const cosine = Math.cos(-angle);
  const sine = Math.sin(-angle);
  const center = (source.width - 1) / 2;
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const dx = x - center;
      const dy = y - center;
      let sourceX = dx * cosine - dy * sine + center;
      const sourceY = dx * sine + dy * cosine + center;
      if (mirror) sourceX = source.width - 1 - sourceX;
      if (sourceX < 0 || sourceX >= source.width || sourceY < 0 || sourceY >= source.height) continue;
      const target = (y * output.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output.data[target + channel] = bilinear(source, sourceX, sourceY, channel);
      if (output.data[target + 3] < ALPHA_CUTOFF) output.data[target + 3] = 0;
    }
  }
  return output;
};

const crop = (image, x, y, width, height) => {
  const output = new PNG({ width, height, colorType: 6 });
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * image.width + x) * 4;
    image.data.copy(output.data, row * width * 4, start, start + width * 4);
  }
  return output;
};

const remap = (source, sourceAnchor, targetAnchor, scaleX, scaleY) => {
  const output = new PNG({ width: source.width, height: source.height, colorType: 6 });
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const sourceX = (x - targetAnchor.x) / scaleX + sourceAnchor.x;
      const sourceY = (y - targetAnchor.y) / scaleY + sourceAnchor.y;
      if (sourceX < 0 || sourceX >= source.width || sourceY < 0 || sourceY >= source.height) continue;
      const target = (y * output.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output.data[target + channel] = bilinear(source, sourceX, sourceY, channel);
      if (output.data[target + 3] < ALPHA_CUTOFF) output.data[target + 3] = 0;
    }
  }
  return output;
};

const translateIntoCell = (source, padding = 4) => {
  const bounds = findBounds(source, 0, 0, source.width, source.height);
  const dx = bounds.x < padding
    ? padding - bounds.x
    : bounds.x + bounds.width > source.width - padding ? source.width - padding - bounds.x - bounds.width : 0;
  const dy = bounds.y < padding
    ? padding - bounds.y
    : bounds.y + bounds.height > source.height - padding ? source.height - padding - bounds.y - bounds.height : 0;
  if (dx === 0 && dy === 0) return source;
  const output = new PNG({ width: source.width, height: source.height, colorType: 6 });
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const targetX = x + dx;
      const targetY = y + dy;
      if (targetX < 0 || targetY < 0 || targetX >= output.width || targetY >= output.height) continue;
      const sourcePixel = (y * source.width + x) * 4;
      const targetPixel = (targetY * output.width + targetX) * 4;
      source.data.copy(output.data, targetPixel, sourcePixel, sourcePixel + 4);
    }
  }
  return output;
};

const alignSequenceToReference = (frames, reference) => {
  const readyBounds = findBounds(frames[0], 0, 0, frames[0].width, frames[0].height);
  const referenceBounds = findBounds(reference, 0, 0, reference.width, reference.height);
  const sourceAnchor = { x: readyBounds.x + readyBounds.width / 2, y: readyBounds.y + readyBounds.height / 2 };
  const targetAnchor = { x: referenceBounds.x + referenceBounds.width / 2, y: referenceBounds.y + referenceBounds.height / 2 };
  const scaleX = referenceBounds.width / readyBounds.width;
  const scaleY = referenceBounds.height / readyBounds.height;
  return frames.map((frame) => {
    const bounds = findBounds(frame, 0, 0, frame.width, frame.height);
    const minX = (bounds.x - sourceAnchor.x) * scaleX + targetAnchor.x;
    const maxX = (bounds.x + bounds.width - sourceAnchor.x) * scaleX + targetAnchor.x;
    const minY = (bounds.y - sourceAnchor.y) * scaleY + targetAnchor.y;
    const maxY = (bounds.y + bounds.height - sourceAnchor.y) * scaleY + targetAnchor.y;
    const shiftX = minX < 4 ? 4 - minX : maxX > frame.width - 4 ? frame.width - 4 - maxX : 0;
    const shiftY = minY < 4 ? 4 - minY : maxY > frame.height - 4 ? frame.height - 4 - maxY : 0;
    return keepLargestComponent(translateIntoCell(remap(
      frame,
      sourceAnchor,
      { x: targetAnchor.x + shiftX, y: targetAnchor.y + shiftY },
      scaleX,
      scaleY,
    )));
  });
};

const blit = (source, target, targetX, targetY) => {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((targetY + y) * target.width + targetX) * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceStart + source.width * 4);
  }
};

const keepLargestComponent = (image) => {
  const occupied = new Uint8Array(image.width * image.height);
  const visited = new Uint8Array(occupied.length);
  // Build topology from confidently opaque pixels so faint generation noise
  // cannot create a bridge between the deer and a detached source artifact.
  for (let pixel = 0; pixel < occupied.length; pixel += 1) occupied[pixel] = image.data[pixel * 4 + 3] >= 128 ? 1 : 0;
  const queue = new Int32Array(occupied.length);
  let largest = [];
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    const component = [];
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const pixel = queue[head++];
      component.push(pixel);
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
          const next = nextY * image.width + nextX;
          if (!occupied[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const retained = new Uint8Array(occupied.length);
  for (const pixel of largest) {
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
        retained[nextY * image.width + nextX] = 1;
      }
    }
  }
  for (let pixel = 0; pixel < retained.length; pixel += 1) {
    if (retained[pixel]) continue;
    image.data[pixel * 4 + 3] = 0;
  }
  return image;
};

const buildKickAtlas = () => {
  const eastSource = read('deer-kick-east-source.png');
  // The source animal faces south (head at the bottom of the frame). Keeping
  // that orientation explicit prevents a future atlas change from putting the
  // hind-leg extension over the shoulders/head again.
  const southSource = read('deer-kick-south-source.png');
  const eastBounds = extractBands(eastSource, 4);
  const southBounds = extractBands(southSource, 4);
  const eastScale = Math.min(145 / Math.max(...eastBounds.map((bounds) => bounds.width)), 145 / Math.max(...eastBounds.map((bounds) => bounds.height)));
  const southScale = Math.min(145 / Math.max(...southBounds.map((bounds) => bounds.width)), 145 / Math.max(...southBounds.map((bounds) => bounds.height)));
  const eastFrames = eastBounds.map((bounds) => keepLargestComponent(renderCrop(eastSource, bounds, KICK_CELL, 145, eastScale)));
  const southFrames = southBounds.map((bounds) => keepLargestComponent(renderCrop(southSource, bounds, KICK_CELL, 145, southScale)));
  const deerAtlas = PNG.sync.read(readFileSync(resolve(preyRoot, 'deer-atlas.png')));
  const directionalFrames = Array.from({ length: 8 }, () => []);
  for (let phase = 0; phase < 4; phase += 1) {
    const east = eastFrames[phase];
    const northeast = transform(east, -Math.PI / 4);
    const south = southFrames[phase];
    const north = transform(south, Math.PI);
    const northwest = transform(northeast, 0, true);
    const west = transform(east, 0, true);
    const southeast = transform(east, Math.PI / 4);
    const southwest = transform(southeast, 0, true);
    [east, northeast, north, northwest, west, southwest, south, southeast]
      .forEach((frame, direction) => directionalFrames[direction].push(keepLargestComponent(frame)));
  }
  const alignedFrames = directionalFrames.map((frames, direction) => alignSequenceToReference(
    frames,
    crop(deerAtlas, direction * KICK_CELL, 0, KICK_CELL, KICK_CELL),
  ));
  const atlas = new PNG({ width: KICK_CELL * 4, height: KICK_CELL * 8, colorType: 6 });
  alignedFrames.forEach((frames, direction) => frames.forEach((frame, phase) => blit(frame, atlas, phase * KICK_CELL, direction * KICK_CELL)));
  writeFileSync(resolve(outputRoot, 'deer-kick.png'), PNG.sync.write(atlas));
};

const buildWoundAtlas = () => {
  const source = read('wound-decals-source.png');
  const bounds = extractBands(source, 3, 90);
  const atlas = new PNG({ width: WOUND_CELL * 3, height: WOUND_CELL, colorType: 6 });
  bounds.forEach((crop, index) => blit(renderCrop(source, crop, WOUND_CELL, 78), atlas, index * WOUND_CELL, 0));
  writeFileSync(resolve(outputRoot, 'wound-decals.png'), PNG.sync.write(atlas));
};

mkdirSync(outputRoot, { recursive: true });
buildKickAtlas();
buildWoundAtlas();
console.log('Built 32 directional deer-kick frames and 3 wound decals.');
