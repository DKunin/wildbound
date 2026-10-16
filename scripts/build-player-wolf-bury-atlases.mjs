import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const FRAME_COUNT = 16;
const ALPHA_THRESHOLD = 38;
const CELL_MARGIN = 4;
const MEAT_WIDTH = 70;
const MEAT_HEIGHT = 24;
const MOUND_WIDTH = 126;
const MOUND_HEIGHT = 78;

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

// Eating poses already keep the muzzle low and the forelegs planted. Reordering them
// creates a forward-and-back digging stroke without redrawing or distorting anatomy.
const sourcePoseByPhase = [5, 6, 7, 8, 9, 8, 7, 6];
const coverByPhase = [0.04, 0.14, 0.29, 0.48, 0.68, 0.82, 0.92, 0.98];
const sprayByPhase = [0, 0.35, 0.95, 0.45, 0, 0.25, 0.72, 0.18];

const root = resolve(import.meta.dirname, '..');
const assetRoot = resolve(root, 'public/assets/player-wolf-v2');
const meatSource = PNG.sync.read(readFileSync(resolve(root, 'public/assets/carried-meat-v1.png')));
const moundSource = PNG.sync.read(readFileSync(resolve(root, 'public/assets/cache-mound-v1.png')));

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
const moundBounds = alphaBounds(moundSource);

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

const sourceOver = (destination, offset, source, opacity = 1) => {
  const sourceAlpha = (source[3] / 255) * opacity;
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
      if (atlas.data[offset + 3] < 128) continue;
      const normalizedX = (x - centerX) / Math.max(1, bounds.width);
      const normalizedY = (y - centerY) / Math.max(1, bounds.height);
      const forward = normalizedX * dx + normalizedY * dy;
      const perpendicular = Math.abs(-normalizedX * dy + normalizedY * dx);
      const luminance = (atlas.data[offset] * 0.2126 + atlas.data[offset + 1] * 0.7152 + atlas.data[offset + 2] * 0.0722) / 255;
      const score = forward * 2.5 - perpendicular * 1.4 - luminance * 0.82;
      if (score > best.score) best = { score, x, y };
    }
  }
  return best;
};

const transformedExtents = (width, height, angle) => ({
  x: Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * height / 2,
  y: Math.abs(Math.sin(angle)) * width / 2 + Math.abs(Math.cos(angle)) * height / 2,
});

const clampCenter = (center, extents) => ({
  x: Math.max(CELL_MARGIN + extents.x, Math.min(FRAME_WIDTH - CELL_MARGIN - extents.x, center.x)),
  y: Math.max(CELL_MARGIN + extents.y, Math.min(FRAME_HEIGHT - CELL_MARGIN - extents.y, center.y)),
});

const compositeTransformed = ({
  output, targetFrame, source, bounds, center, width, height, angle, opacity = 1, filter,
}) => {
  const cellX = (targetFrame % 4) * FRAME_WIDTH;
  const cellY = Math.floor(targetFrame / 4) * FRAME_HEIGHT;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const extents = transformedExtents(width, height, angle);
  const minX = Math.max(CELL_MARGIN, Math.floor(center.x - extents.x - 1));
  const maxX = Math.min(FRAME_WIDTH - CELL_MARGIN - 1, Math.ceil(center.x + extents.x + 1));
  const minY = Math.max(CELL_MARGIN, Math.floor(center.y - extents.y - 1));
  const maxY = Math.min(FRAME_HEIGHT - CELL_MARGIN - 1, Math.ceil(center.y + extents.y + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const relativeX = x - center.x;
      const relativeY = y - center.y;
      const localX = relativeX * cos + relativeY * sin;
      const localY = -relativeX * sin + relativeY * cos;
      const normalizedX = localX / width + 0.5;
      const normalizedY = localY / height + 0.5;
      if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) continue;
      const pixelOpacity = filter ? filter(normalizedX, normalizedY) : 1;
      if (pixelOpacity <= 0) continue;
      const sourceX = bounds.minX + normalizedX * (bounds.width - 1);
      const sourceY = bounds.minY + normalizedY * (bounds.height - 1);
      sourceOver(
        output.data,
        ((cellY + y) * output.width + cellX + x) * 4,
        sampleBilinear(source, sourceX, sourceY),
        opacity * pixelOpacity,
      );
    }
  }
};

const drawDisc = (output, targetFrame, centerX, centerY, radius, color, opacity) => {
  const cellX = (targetFrame % 4) * FRAME_WIDTH;
  const cellY = Math.floor(targetFrame / 4) * FRAME_HEIGHT;
  const minX = Math.max(CELL_MARGIN, Math.floor(centerX - radius));
  const maxX = Math.min(FRAME_WIDTH - CELL_MARGIN - 1, Math.ceil(centerX + radius));
  const minY = Math.max(CELL_MARGIN, Math.floor(centerY - radius));
  const maxY = Math.min(FRAME_HEIGHT - CELL_MARGIN - 1, Math.ceil(centerY + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > radius) continue;
      sourceOver(output.data, ((cellY + y) * output.width + cellX + x) * 4, color, opacity * (1 - distance / radius));
    }
  }
};

const renderDirtSpray = (output, targetFrame, direction, center, intensity, phase) => {
  if (intensity <= 0) return;
  const [dx, dy] = directions[direction];
  const perpendicularX = -dy;
  const perpendicularY = dx;
  const particles = [
    [-18, -8, 3.4], [-12, 9, 2.7], [-5, -13, 2.2], [5, 11, 3], [12, -7, 2.4], [18, 6, 1.9],
  ];
  for (const [along, across, radius] of particles) {
    const stroke = Math.sin((phase / 8) * Math.PI * 2);
    const x = center.x - dx * (7 + along * intensity) + perpendicularX * (across + stroke * 3);
    const y = center.y - dy * (7 + along * intensity) + perpendicularY * (across + stroke * 3);
    drawDisc(output, targetFrame, x, y, radius * (0.65 + intensity * 0.45), [92, 57, 32, 255], 0.7 * intensity);
  }
};

const copyWolfPose = (output, original, targetFrame, sourceFrame) => {
  const sourceCellX = (sourceFrame % 4) * FRAME_WIDTH;
  const sourceCellY = Math.floor(sourceFrame / 4) * FRAME_HEIGHT;
  const targetCellX = (targetFrame % 4) * FRAME_WIDTH;
  const targetCellY = Math.floor(targetFrame / 4) * FRAME_HEIGHT;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const sourceOffset = ((sourceCellY + y) * original.width + sourceCellX + x) * 4;
      const targetOffset = ((targetCellY + y) * output.width + targetCellX + x) * 4;
      sourceOver(output.data, targetOffset, [
        original.data[sourceOffset], original.data[sourceOffset + 1], original.data[sourceOffset + 2], original.data[sourceOffset + 3],
      ]);
    }
  }
};

const removeFaintPixels = (image) => {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] > 16) continue;
    image.data.fill(0, offset, offset + 4);
  }
};

const getCacheCenter = (original, direction) => {
  const phase = 0;
  const sourceFrame = sourcePoseByPhase[phase];
  const [dx, dy] = directions[direction];
  const angle = Math.atan2(dy, dx) + Math.PI / 2;
  const muzzle = findMuzzle(original, sourceFrame, direction);
  return clampCenter(
    { x: muzzle.x + dx * 22, y: muzzle.y + dy * 22 },
    transformedExtents(MOUND_WIDTH, MOUND_HEIGHT, angle),
  );
};

const renderBurialFrame = (output, original, targetFrame, direction, center) => {
  const phase = Math.min(targetFrame, 7);
  const sourceFrame = sourcePoseByPhase[phase];
  const [dx, dy] = directions[direction];
  const angle = Math.atan2(dy, dx) + Math.PI / 2;

  // A subdued base patch anchors the cache to the ground before the meat is placed.
  compositeTransformed({
    output, targetFrame, source: moundSource, bounds: moundBounds, center,
    width: MOUND_WIDTH, height: MOUND_HEIGHT, angle, opacity: 0.42,
  });
  compositeTransformed({
    output, targetFrame, source: meatSource, bounds: meatBounds,
    center: { x: center.x + dx * 2, y: center.y + dy * 2 },
    width: MEAT_WIDTH, height: MEAT_HEIGHT, angle, opacity: 1,
  });

  // Soil advances from the wolf-facing edge across the meat. The soft boundary reads
  // as loose earth instead of a hard wipe, while the final pose leaves only a hint.
  const cover = coverByPhase[phase];
  compositeTransformed({
    output, targetFrame, source: moundSource, bounds: moundBounds, center,
    width: MOUND_WIDTH, height: MOUND_HEIGHT, angle, opacity: 0.96,
    filter: (_x, normalizedY) => {
      const transition = (cover - normalizedY) * 12 + 0.5;
      return Math.max(0, Math.min(1, transition));
    },
  });
  renderDirtSpray(output, targetFrame, direction, center, sprayByPhase[phase], phase);

  // Keep the existing directional wolf artwork above every ground detail. This also
  // guarantees that dirt never replaces a paw, muzzle, or other anatomical feature.
  copyWolfPose(output, original, targetFrame, sourceFrame);
};

for (const direction of Object.keys(directions)) {
  const sourcePath = resolve(assetRoot, `wolf-${direction}-action.png`);
  const original = PNG.sync.read(readFileSync(sourcePath));
  if (original.width < FRAME_WIDTH * 4 || original.height !== FRAME_HEIGHT * 4) {
    throw new Error(`${direction} action atlas does not match the 4x4 frame contract`);
  }
  const output = new PNG({ width: original.width, height: original.height });
  const cacheCenter = getCacheCenter(original, direction);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    renderBurialFrame(output, original, frame, direction, cacheCenter);
  }
  removeFaintPixels(output);
  writeFileSync(resolve(assetRoot, `wolf-${direction}-bury.png`), PNG.sync.write(output));
}

console.log(`Built ${Object.keys(directions).length} directional burial atlases with ${FRAME_COUNT} frames each.`);
