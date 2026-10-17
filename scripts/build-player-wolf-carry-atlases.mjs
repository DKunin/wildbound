import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const ALPHA_THRESHOLD = 38;
const MEAT_WIDTH = 82;
const MEAT_HEIGHT = 28;
const MIN_EXPOSED_MEAT_PIXELS = 90;
const MEAT_FORWARD_OFFSETS = [8, 10, 12];
const CELL_MARGIN = 3;

const directions = {
  east: [1, 0],
  northeast: [Math.SQRT1_2, -Math.SQRT1_2],
  north: [0, -1],
  northwest: [-Math.SQRT1_2, -Math.SQRT1_2],
  west: [-1, 0],
  southwest: [-Math.SQRT1_2, Math.SQRT1_2],
  south: [0, 1],
  southeast: [Math.SQRT1_2, Math.SQRT1_2],
};
const atlasKinds = ['motion', 'run', 'rest', 'crouch'];

const root = resolve(import.meta.dirname, '..');
const assetRoot = resolve(root, 'public/assets/player-wolf-v2');
const meatSource = PNG.sync.read(readFileSync(resolve(root, 'public/assets/carried-meat-v1.png')));

const alphaBounds = (image) => {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Source image has no visible pixels');
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const meatBounds = alphaBounds(meatSource);

const sampleBilinear = (image, x, y) => {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const result = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = image.data[(y0 * image.width + x0) * 4 + channel] * (1 - tx)
      + image.data[(y0 * image.width + x1) * 4 + channel] * tx;
    const bottom = image.data[(y1 * image.width + x0) * 4 + channel] * (1 - tx)
      + image.data[(y1 * image.width + x1) * 4 + channel] * tx;
    result[channel] = Math.round(top * (1 - ty) + bottom * ty);
  }
  return result;
};

const sourceOver = (destination, offset, source) => {
  const sourceAlpha = source[3] / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = destination[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    destination[offset + channel] = Math.round(
      (source[channel] * sourceAlpha + destination[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
    );
  }
  destination[offset + 3] = Math.round(outputAlpha * 255);
};

const frameBounds = (atlas, frame) => {
  const cellX = (frame % 4) * FRAME_WIDTH;
  const cellY = Math.floor(frame / 4) * FRAME_HEIGHT;
  let minX = FRAME_WIDTH;
  let minY = FRAME_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      if (atlas.data[((cellY + y) * atlas.width + cellX + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error(`Frame ${frame} has no visible wolf pixels`);
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const findMuzzle = (atlas, frame, direction) => {
  const cellX = (frame % 4) * FRAME_WIDTH;
  const cellY = Math.floor(frame / 4) * FRAME_HEIGHT;
  const bounds = frameBounds(atlas, frame);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const [dx, dy] = directions[direction];
  let best = { score: -Infinity, x: centerX, y: centerY };

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = ((cellY + y) * atlas.width + cellX + x) * 4;
      const alpha = atlas.data[offset + 3];
      if (alpha < 128) continue;
      const normalizedX = (x - centerX) / Math.max(1, bounds.width);
      const normalizedY = (y - centerY) / Math.max(1, bounds.height);
      const forward = normalizedX * dx + normalizedY * dy;
      const perpendicular = Math.abs(-normalizedX * dy + normalizedY * dx);
      const luminance = (atlas.data[offset] * 0.2126 + atlas.data[offset + 1] * 0.7152 + atlas.data[offset + 2] * 0.0722) / 255;
      const score = forward * 2.4 - perpendicular * 1.35 - luminance * 0.85;
      if (score > best.score) best = { score, x, y };
    }
  }
  return best;
};

const renderMeatAtOffset = (output, original, frame, direction, forwardOffset) => {
  const cellX = (frame % 4) * FRAME_WIDTH;
  const cellY = Math.floor(frame / 4) * FRAME_HEIGHT;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const start = ((cellY + y) * output.width + cellX) * 4;
    output.data.fill(0, start, start + FRAME_WIDTH * 4);
  }
  const [dx, dy] = directions[direction];
  const muzzle = findMuzzle(original, frame, direction);
  const angle = Math.atan2(dy, dx) + Math.PI / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const extentX = Math.abs(cos) * MEAT_WIDTH / 2 + Math.abs(sin) * MEAT_HEIGHT / 2;
  const extentY = Math.abs(sin) * MEAT_WIDTH / 2 + Math.abs(cos) * MEAT_HEIGHT / 2;
  const desiredX = muzzle.x + dx * forwardOffset;
  const desiredY = muzzle.y + dy * forwardOffset;
  const centerX = Math.max(CELL_MARGIN + extentX, Math.min(FRAME_WIDTH - CELL_MARGIN - extentX, desiredX));
  const centerY = Math.max(CELL_MARGIN + extentY, Math.min(FRAME_HEIGHT - CELL_MARGIN - extentY, desiredY));

  const minX = Math.max(CELL_MARGIN, Math.floor(centerX - extentX - 1));
  const maxX = Math.min(FRAME_WIDTH - CELL_MARGIN - 1, Math.ceil(centerX + extentX + 1));
  const minY = Math.max(CELL_MARGIN, Math.floor(centerY - extentY - 1));
  const maxY = Math.min(FRAME_HEIGHT - CELL_MARGIN - 1, Math.ceil(centerY + extentY + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const relativeX = x - centerX;
      const relativeY = y - centerY;
      const unrotatedX = relativeX * cos + relativeY * sin;
      const unrotatedY = -relativeX * sin + relativeY * cos;
      const normalizedX = unrotatedX / MEAT_WIDTH + 0.5;
      const normalizedY = unrotatedY / MEAT_HEIGHT + 0.5;
      if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) continue;
      const sourceX = meatBounds.minX + normalizedX * (meatBounds.width - 1);
      const sourceY = meatBounds.minY + normalizedY * (meatBounds.height - 1);
      sourceOver(output.data, ((cellY + y) * output.width + cellX + x) * 4, sampleBilinear(meatSource, sourceX, sourceY));
    }
  }

  // The wolf is composited last, so the jaw naturally occludes the bundle instead of
  // the meat reading as a second sprite pasted over the animal's face.
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const offset = ((cellY + y) * original.width + cellX + x) * 4;
      sourceOver(output.data, offset, [
        original.data[offset], original.data[offset + 1], original.data[offset + 2], original.data[offset + 3],
      ]);
    }
  }
};

const countExposedMeatPixels = (output, original, frame) => {
  const cellX = (frame % 4) * FRAME_WIDTH;
  const cellY = Math.floor(frame / 4) * FRAME_HEIGHT;
  let added = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const offset = ((cellY + y) * output.width + cellX + x) * 4;
      if (original.data[offset + 3] < ALPHA_THRESHOLD && output.data[offset + 3] >= ALPHA_THRESHOLD) added += 1;
    }
  }
  return added;
};

const renderMeatBehindWolf = (output, original, frame, direction) => {
  for (const forwardOffset of MEAT_FORWARD_OFFSETS) {
    renderMeatAtOffset(output, original, frame, direction, forwardOffset);
    if (countExposedMeatPixels(output, original, frame) >= MIN_EXPOSED_MEAT_PIXELS) return;
  }
  throw new Error(`${direction} frame ${frame} cannot expose ${MIN_EXPOSED_MEAT_PIXELS} carried-meat pixels`);
};

const removeFaintPixels = (image) => {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] > 16) continue;
    image.data.fill(0, offset, offset + 4);
  }
};

for (const direction of Object.keys(directions)) {
  for (const kind of atlasKinds) {
    const sourcePath = resolve(assetRoot, `wolf-${direction}-${kind}.png`);
    const original = PNG.sync.read(readFileSync(sourcePath));
    const output = new PNG({ width: original.width, height: original.height });
    for (let frame = 0; frame < 16; frame += 1) renderMeatBehindWolf(output, original, frame, direction);
    removeFaintPixels(output);
    writeFileSync(resolve(assetRoot, `wolf-${direction}-${kind}-carry.png`), PNG.sync.write(output));
  }
}

console.log(`Built ${Object.keys(directions).length * atlasKinds.length} carrying-wolf atlases from one generic meat design.`);
