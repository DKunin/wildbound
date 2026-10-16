import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wolfRoot = resolve(root, 'public/assets/player-wolf-v2');
const preyRoot = resolve(root, 'public/assets/prey-v2');
const elkRoot = resolve(root, 'public/assets/prey-v3');
const boarRoot = resolve(root, 'public/assets/prey-v4');
const balanceRoot = resolve(root, 'public/assets/balance-v1');
const outputRoot = resolve(root, 'public/assets/wounds-v1');
const WOUND_LEVELS = 3;
const WOUND_CELL = 96;
const ALPHA_CUTOFF = 20;
const manifest = { version: 1, levels: WOUND_LEVELS, spritesheets: [] };

const directions = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
const directionVectors = {
  east: [1, 0],
  northeast: [Math.SQRT1_2, -Math.SQRT1_2],
  north: [0, -1],
  northwest: [-Math.SQRT1_2, -Math.SQRT1_2],
  west: [-1, 0],
  southwest: [-Math.SQRT1_2, Math.SQRT1_2],
  south: [0, 1],
  southeast: [Math.SQRT1_2, Math.SQRT1_2],
};
const stableWolfAnchorFrame = { motion: 8, run: 0, rest: 6, action: 5, crouch: 8, bury: 5 };

const read = (path) => PNG.sync.read(readFileSync(path));

const findBounds = (image, frameX, frameY, frameWidth, frameHeight) => {
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const alpha = image.data[((frameY + y) * image.width + frameX + x) * 4 + 3];
      if (alpha < ALPHA_CUTOFF) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error(`Empty frame at ${frameX},${frameY}`);
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const bilinear = (image, x, y, channel) => {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(image.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(image.height - 1, y0 + 1));
  const tx = x - Math.floor(x);
  const ty = y - Math.floor(y);
  const top = image.data[(y0 * image.width + x0) * 4 + channel] * (1 - tx)
    + image.data[(y0 * image.width + x1) * 4 + channel] * tx;
  const bottom = image.data[(y1 * image.width + x0) * 4 + channel] * (1 - tx)
    + image.data[(y1 * image.width + x1) * 4 + channel] * tx;
  return Math.round(top * (1 - ty) + bottom * ty);
};

const drawWound = ({ source, decal, output, frameX, frameY, frameWidth, frameHeight, outputBandY, bounds, direction, species, level }) => {
  const [forwardX, forwardY] = directionVectors[direction];
  const rearOffset = (Math.abs(forwardX) * bounds.width + Math.abs(forwardY) * bounds.height) * 0.1;
  const sideViewLift = Math.abs(forwardX) * bounds.height * 0.08;
  const centerX = bounds.minX + bounds.width / 2 - forwardX * rearOffset;
  const centerY = bounds.minY + bounds.height / 2 - forwardY * rearOffset - sideViewLift;
  const desiredSize = species === 'wolf' ? [0, 72, 88, 104][level] : [0, 38, 47, 56][level];
  const drawWidth = Math.round(Math.max(18, Math.min(desiredSize, bounds.width * 0.48)));
  const drawHeight = drawWidth;
  const left = Math.round(centerX - drawWidth / 2);
  const top = Math.round(centerY - drawHeight / 2);
  const mirror = forwardX < 0;
  let woundPixels = 0;

  for (let y = 0; y < drawHeight; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= source.height - frameY) continue;
    for (let x = 0; x < drawWidth; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= source.width - frameX) continue;
      const sourcePixel = ((frameY + targetY) * source.width + frameX + targetX) * 4;
      const animalAlpha = source.data[sourcePixel + 3];
      if (animalAlpha < ALPHA_CUTOFF) continue;
      const normalizedX = mirror ? 1 - (x + 0.5) / drawWidth : (x + 0.5) / drawWidth;
      const decalX = normalizedX * WOUND_CELL - 0.5;
      const decalY = ((y + 0.5) / drawHeight) * WOUND_CELL - 0.5;
      const decalAlpha = bilinear(decal, decalX, decalY, 3);
      if (decalAlpha < ALPHA_CUTOFF) continue;
      const outputPixel = ((outputBandY + frameY + targetY) * output.width + frameX + targetX) * 4;
      output.data[outputPixel] = bilinear(decal, decalX, decalY, 0);
      output.data[outputPixel + 1] = bilinear(decal, decalX, decalY, 1);
      output.data[outputPixel + 2] = bilinear(decal, decalX, decalY, 2);
      output.data[outputPixel + 3] = Math.round(decalAlpha * animalAlpha / 255);
      woundPixels += 1;
    }
  }
  return {
    woundPixels,
    placement: {
      x: frameX + left,
      y: frameY + top,
      width: drawWidth,
      height: drawHeight,
      mirror,
      clip: [frameX, frameY, frameWidth, frameHeight],
    },
  };
};

const extractDecal = (atlas, level) => {
  const output = new PNG({ width: WOUND_CELL, height: WOUND_CELL, colorType: 6 });
  for (let y = 0; y < WOUND_CELL; y += 1) {
    const start = (y * atlas.width + (level - 1) * WOUND_CELL) * 4;
    atlas.data.copy(output.data, y * WOUND_CELL * 4, start, start + WOUND_CELL * 4);
  }
  return output;
};

const decalCentroid = (decal) => {
  let weight = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < decal.height; y += 1) {
    for (let x = 0; x < decal.width; x += 1) {
      const alpha = decal.data[(y * decal.width + x) * 4 + 3];
      if (alpha < ALPHA_CUTOFF) continue;
      weight += alpha;
      sumX += x * alpha;
      sumY += y * alpha;
    }
  }
  if (weight === 0) throw new Error('Wound decal has no visible pixels');
  return { x: sumX / weight, y: sumY / weight };
};

const translateDecal = (decal, shiftX, shiftY) => {
  const output = new PNG({ width: decal.width, height: decal.height, colorType: 6 });
  for (let y = 0; y < decal.height; y += 1) {
    const targetY = y + shiftY;
    if (targetY < 0 || targetY >= decal.height) continue;
    for (let x = 0; x < decal.width; x += 1) {
      const targetX = x + shiftX;
      if (targetX < 0 || targetX >= decal.width) continue;
      const from = (y * decal.width + x) * 4;
      const to = (targetY * output.width + targetX) * 4;
      decal.data.copy(output.data, to, from, from + 4);
    }
  }
  return output;
};

const normalizedDecals = (atlas) => {
  const decals = Array.from({ length: WOUND_LEVELS }, (_, index) => extractDecal(atlas, index + 1));
  const centroids = decals.map(decalCentroid);
  const target = {
    x: centroids.reduce((sum, centroid) => sum + centroid.x, 0) / centroids.length,
    y: centroids.reduce((sum, centroid) => sum + centroid.y, 0) / centroids.length,
  };
  return decals.map((decal, index) => translateDecal(
    decal,
    Math.round(target.x - centroids[index].x),
    Math.round(target.y - centroids[index].y),
  ));
};

const buildLayer = ({
  sourcePath,
  anchorPath = sourcePath,
  anchorFrameAt = (column, row) => row * columns + column,
  frameWidth,
  frameHeight,
  columns,
  rows,
  directionAt,
  species,
}) => {
  const source = read(sourcePath);
  const anchorSource = read(anchorPath);
  if (source.width !== anchorSource.width || source.height !== anchorSource.height) {
    throw new Error(`Anchor dimensions do not match ${basename(sourcePath)}`);
  }
  if (source.width < frameWidth * columns || source.height < frameHeight * rows
    || source.width - frameWidth * columns > 1 || source.height - frameHeight * rows > 1) {
    throw new Error(`Unexpected grid dimensions for ${basename(sourcePath)}: ${source.width}x${source.height}`);
  }
  const woundAtlas = read(resolve(balanceRoot, 'wound-decals.png'));
  const decals = normalizedDecals(woundAtlas);
  const output = new PNG({ width: source.width, height: source.height * WOUND_LEVELS, colorType: 6 });
  const pixelsByLevel = Array.from({ length: WOUND_LEVELS }, () => []);
  const placementsByLevel = Array.from({ length: WOUND_LEVELS }, () => []);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const frameX = column * frameWidth;
      const frameY = row * frameHeight;
      const anchorFrame = anchorFrameAt(column, row);
      const anchorFrameX = (anchorFrame % columns) * frameWidth;
      const anchorFrameY = Math.floor(anchorFrame / columns) * frameHeight;
      const bounds = findBounds(anchorSource, anchorFrameX, anchorFrameY, frameWidth, frameHeight);
      const direction = directionAt(column, row);
      for (let level = 1; level <= WOUND_LEVELS; level += 1) {
        const rendered = drawWound({
          source,
          decal: decals[level - 1],
          output,
          frameX,
          frameY,
          frameWidth,
          frameHeight,
          outputBandY: source.height * (level - 1),
          bounds,
          direction,
          species,
          level,
        });
        pixelsByLevel[level - 1].push(rendered.woundPixels);
        placementsByLevel[level - 1].push(rendered.placement);
      }
    }
  }
  const outputName = `${basename(sourcePath, '.png')}-wounds.png`;
  const encoded = PNG.sync.write(output);
  writeFileSync(resolve(outputRoot, outputName), encoded);
  manifest.spritesheets.push({
    file: outputName,
    source: basename(sourcePath),
    width: source.width,
    sourceHeight: source.height,
    frameWidth,
    frameHeight,
    columns,
    rows,
    pixelsByLevel,
    placementsByLevel,
    sha256: createHash('sha256').update(encoded).digest('hex'),
  });
  return outputName;
};

mkdirSync(outputRoot, { recursive: true });

let built = 0;
for (const direction of directions) {
  for (const kind of ['motion', 'run', 'rest', 'action', 'crouch', 'bury']) {
    const sourcePath = resolve(wolfRoot, `wolf-${direction}-${kind}.png`);
    buildLayer({
      sourcePath,
      anchorPath: kind === 'bury' ? resolve(wolfRoot, `wolf-${direction}-action.png`) : sourcePath,
      anchorFrameAt: () => stableWolfAnchorFrame[kind],
      frameWidth: 346,
      frameHeight: 284,
      columns: 4,
      rows: 4,
      directionAt: () => direction,
      species: 'wolf',
    });
    built += 1;
    if (kind === 'action' || kind === 'bury') continue;
    const carryPath = resolve(wolfRoot, `wolf-${direction}-${kind}-carry.png`);
    buildLayer({
      sourcePath: carryPath,
      anchorPath: sourcePath,
      anchorFrameAt: () => stableWolfAnchorFrame[kind],
      frameWidth: 346,
      frameHeight: 284,
      columns: 4,
      rows: 4,
      directionAt: () => direction,
      species: 'wolf',
    });
    built += 1;
  }
}

buildLayer({
  sourcePath: resolve(preyRoot, 'deer-atlas.png'),
  anchorFrameAt: (column, row) => row === 5 ? 40 + column : column,
  frameWidth: 181,
  frameHeight: 181,
  columns: 8,
  rows: 6,
  directionAt: (column) => directions[column],
  species: 'deer',
});
buildLayer({
  sourcePath: resolve(preyRoot, 'deer-actions.png'),
  anchorFrameAt: (column, row) => row * 8 + column,
  frameWidth: 181,
  frameHeight: 181,
  columns: 8,
  rows: 3,
  directionAt: (column) => directions[column],
  species: 'deer',
});
buildLayer({
  sourcePath: resolve(balanceRoot, 'deer-kick.png'),
  anchorFrameAt: (column, row) => row * 4 + column,
  frameWidth: 181,
  frameHeight: 181,
  columns: 4,
  rows: 8,
  directionAt: (_column, row) => directions[row],
  species: 'deer',
});
built += 3;

for (const [species, sourceRoot] of [['elk', elkRoot], ['boar', boarRoot]]) {
  buildLayer({
    sourcePath: resolve(sourceRoot, `${species}-atlas.png`),
    anchorFrameAt: (column, row) => row === 5 ? 40 + column : column,
    frameWidth: 181,
    frameHeight: 181,
    columns: 8,
    rows: 6,
    directionAt: (column) => directions[column],
    species,
  });
  buildLayer({
    sourcePath: resolve(sourceRoot, `${species}-actions.png`),
    anchorFrameAt: (column, row) => row * 8 + column,
    frameWidth: 181,
    frameHeight: 181,
    columns: 8,
    rows: 3,
    directionAt: (column) => directions[column],
    species,
  });
  built += 2;
}

manifest.spritesheets.sort((left, right) => left.file.localeCompare(right.file));
writeFileSync(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${built} packed wound-layer spritesheets (${WOUND_LEVELS} levels each).`);
