#!/usr/bin/env node

/**
 * Deterministically normalizes both authored prey idle phases, expands the
 * one-pose action sheets into grounded four-phase loops, and assembles a
 * dedicated boar charge.
 *
 * The source paintings stay on a fixed 181 px canvas. Alignment is a single
 * whole-pixel translation per authored pose (never per generated phase), and
 * the small in-between deformations use premultiplied-alpha sampling so the
 * generated edges do not acquire dark colour fringes.
 *
 * Usage:
 *   node scripts/build-animal-action-atlases.mjs
 *   node scripts/build-animal-action-atlases.mjs --check
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const CELL = 181;
const COLUMNS = 8;
const SOURCE_ACTION_ROWS = 3;
const OUTPUT_ACTION_ROWS = 12;
const EDGE_ALPHA_THRESHOLD = 16;
const CORE_ALPHA_THRESHOLD = 96;
const SAFE_MARGIN = 2;

const DIRECTIONS = [
  'east', 'northeast', 'north', 'northwest',
  'west', 'southwest', 'south', 'southeast',
];

const FACING = [
  { x: 1, y: 0 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: 0, y: -1 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: -1, y: 0 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: 0, y: 1 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
];

const SPECIES = [
  {
    name: 'rabbit',
    source: 'art-source/prey-actions-v2/sources/rabbit-actions-source.png',
    movement: 'public/assets/prey-v2/rabbit-atlas.png',
    output: 'public/assets/prey-v2/rabbit-actions.png',
  },
  {
    name: 'deer',
    source: 'art-source/prey-actions-v2/sources/deer-actions-source.png',
    movement: 'public/assets/prey-v2/deer-atlas.png',
    output: 'public/assets/prey-v2/deer-actions.png',
  },
  {
    name: 'elk',
    source: 'art-source/prey-actions-v2/sources/elk-actions-source.png',
    movement: 'public/assets/prey-v3/elk-atlas.png',
    output: 'public/assets/prey-v3/elk-actions.png',
  },
  {
    name: 'boar',
    source: 'art-source/prey-actions-v2/sources/boar-actions-source.png',
    movement: 'public/assets/prey-v4/boar-atlas.png',
    output: 'public/assets/prey-v4/boar-actions.png',
  },
];

const CHARGE_OUTPUT = 'public/assets/prey-v4/boar-charge.png';
const MANIFEST_OUTPUT = 'art-source/prey-actions-v2/build-manifest.json';
const ACTIONS = ['resting', 'foraging', 'drinking'];

const absolute = (path) => resolve(ROOT, path);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const round = (value, precision = 3) => Number(value.toFixed(precision));

const readPng = (path) => PNG.sync.read(readFileSync(absolute(path)));

const requireDimensions = (image, width, height, label) => {
  if (image.width !== width || image.height !== height) {
    throw new Error(`${label} must be ${width}x${height}; found ${image.width}x${image.height}`);
  }
};

const emptyPng = (width, height) => {
  const image = new PNG({ width, height, colorType: 6 });
  image.data.fill(0);
  return image;
};

const extractCell = (atlas, column, row) => {
  const cell = emptyPng(CELL, CELL);
  PNG.bitblt(atlas, cell, column * CELL, row * CELL, CELL, CELL, 0, 0);
  return cell;
};

const pasteCell = (cell, atlas, column, row) => {
  PNG.bitblt(cell, atlas, 0, 0, CELL, CELL, column * CELL, row * CELL);
};

const sanitizeAlpha = (image) => {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] > EDGE_ALPHA_THRESHOLD) continue;
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
    image.data[offset + 3] = 0;
  }
  return image;
};

const alphaMask = (cell) => {
  const mask = new Uint8Array(CELL * CELL);
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const alpha = cell.data[(y * CELL + x) * 4 + 3];
      if (alpha > EDGE_ALPHA_THRESHOLD) {
        visiblePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < CORE_ALPHA_THRESHOLD) continue;
      mask[y * CELL + x] = 1;
      alphaWeight += alpha;
      weightedX += x * alpha;
      weightedY += y * alpha;
    }
  }

  if (maxX < minX || alphaWeight === 0) throw new Error('Generated an empty action cell');
  return {
    mask,
    bounds: { minX, minY, maxX, maxY },
    visiblePixels,
    fallbackRoot: { x: weightedX / alphaWeight, y: weightedY / alphaWeight },
  };
};

const erode = (source, iterations) => {
  let current = source;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 1; y < CELL - 1; y += 1) {
      for (let x = 1; x < CELL - 1; x += 1) {
        const index = y * CELL + x;
        if (!current[index]) continue;
        let solid = true;
        for (let dy = -1; dy <= 1 && solid; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!current[(y + dy) * CELL + x + dx]) {
              solid = false;
              break;
            }
          }
        }
        if (solid) next[index] = 1;
      }
    }
    current = next;
  }
  return current;
};

const largestComponentCentroid = (mask) => {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest = { size: 0, sumX: 0, sumY: 0 };

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    let sumX = 0;
    let sumY = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % CELL;
      const y = Math.floor(pixel / CELL);
      size += 1;
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= CELL || nextY < 0 || nextY >= CELL) continue;
          const next = nextY * CELL + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (size > largest.size) largest = { size, sumX, sumY };
  }

  return largest.size > 0
    ? { x: largest.sumX / largest.size, y: largest.sumY / largest.size }
    : undefined;
};

const measure = (cell) => {
  const measured = alphaMask(cell);
  const core = largestComponentCentroid(erode(measured.mask, 4)) ?? measured.fallbackRoot;
  return {
    bounds: measured.bounds,
    visiblePixels: measured.visiblePixels,
    root: core,
    ground: { x: core.x, y: measured.bounds.maxY },
  };
};

const clampShift = (measurement, requested) => {
  const { bounds } = measurement;
  const minX = SAFE_MARGIN - bounds.minX;
  const maxX = CELL - SAFE_MARGIN - 1 - bounds.maxX;
  const minY = SAFE_MARGIN - bounds.minY;
  const maxY = CELL - SAFE_MARGIN - 1 - bounds.maxY;
  const x = Math.max(minX, Math.min(maxX, requested.x));
  const y = Math.max(minY, Math.min(maxY, requested.y));
  return { x, y, capped: x !== requested.x || y !== requested.y };
};

const translateCell = (source, shift) => {
  const target = emptyPng(CELL, CELL);
  for (let y = 0; y < CELL; y += 1) {
    const targetY = y + shift.y;
    if (targetY < 0 || targetY >= CELL) continue;
    for (let x = 0; x < CELL; x += 1) {
      const targetX = x + shift.x;
      if (targetX < 0 || targetX >= CELL) continue;
      const sourceOffset = (y * CELL + x) * 4;
      const targetOffset = (targetY * CELL + targetX) * 4;
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return sanitizeAlpha(target);
};

const alignToIdle = (source, idle) => {
  const before = measure(source);
  const target = measure(idle);
  const requested = {
    x: Math.round(target.root.x - before.root.x),
    y: Math.round(target.ground.y - before.ground.y),
  };
  const applied = clampShift(before, requested);
  const cell = translateCell(source, applied);
  const after = measure(cell);
  return {
    cell,
    report: {
      requested,
      applied: { x: applied.x, y: applied.y },
      capped: applied.capped,
      idleRoot: { x: round(target.root.x), y: round(target.root.y) },
      idleGroundY: target.ground.y,
      sourceRootBefore: { x: round(before.root.x), y: round(before.root.y) },
      rootAfter: { x: round(after.root.x), y: round(after.root.y) },
      groundYBefore: before.ground.y,
      groundYAfter: after.ground.y,
      rootDeltaX: round(after.root.x - target.root.x),
      groundDeltaY: after.ground.y - target.ground.y,
    },
  };
};

const samplePremultiplied = (source, x, y, output, outputOffset) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  let alpha = 0;
  let premultipliedR = 0;
  let premultipliedG = 0;
  let premultipliedB = 0;

  for (let sampleY = 0; sampleY <= 1; sampleY += 1) {
    const sourceY = y0 + sampleY;
    if (sourceY < 0 || sourceY >= CELL) continue;
    const weightY = sampleY === 0 ? 1 - ty : ty;
    for (let sampleX = 0; sampleX <= 1; sampleX += 1) {
      const sourceX = x0 + sampleX;
      if (sourceX < 0 || sourceX >= CELL) continue;
      const weightX = sampleX === 0 ? 1 - tx : tx;
      const weight = weightX * weightY;
      const offset = (sourceY * CELL + sourceX) * 4;
      const sourceAlpha = source.data[offset + 3] / 255;
      alpha += sourceAlpha * weight;
      premultipliedR += source.data[offset] * sourceAlpha * weight;
      premultipliedG += source.data[offset + 1] * sourceAlpha * weight;
      premultipliedB += source.data[offset + 2] * sourceAlpha * weight;
    }
  }

  const outputAlpha = Math.round(alpha * 255);
  if (outputAlpha <= EDGE_ALPHA_THRESHOLD || alpha <= 0) {
    output.fill(0, outputOffset, outputOffset + 4);
    return;
  }
  output[outputOffset] = Math.max(0, Math.min(255, Math.round(premultipliedR / alpha)));
  output[outputOffset + 1] = Math.max(0, Math.min(255, Math.round(premultipliedG / alpha)));
  output[outputOffset + 2] = Math.max(0, Math.min(255, Math.round(premultipliedB / alpha)));
  output[outputOffset + 3] = outputAlpha;
};

const warpCell = (source, sourceCoordinate) => {
  const target = emptyPng(CELL, CELL);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const sample = sourceCoordinate(x, y);
      samplePremultiplied(source, sample.x, sample.y, target.data, (y * CELL + x) * 4);
    }
  }
  return sanitizeAlpha(target);
};

const warpEdgeFade = (x, y) => Math.max(0, Math.min(
  1,
  (x - (SAFE_MARGIN - 1)) / 4,
  (y - (SAFE_MARGIN - 1)) / 4,
  (CELL - SAFE_MARGIN - x) / 4,
  (CELL - SAFE_MARGIN - y) / 4,
));

const groundedBreath = (source, phase, directionIndex) => {
  const scales = [
    { x: 1, y: 1 },
    { x: 1.008, y: 1.03 },
    { x: 1.016, y: 1.06 },
    { x: 1.006, y: 1.025 },
  ];
  if (phase === 0) return source;
  const measured = measure(source);
  const anchor = { x: measured.root.x, y: measured.ground.y };
  const scale = scales[phase];
  const facing = FACING[directionIndex];
  const perpendicular = { x: -facing.y, y: facing.x };
  const { bounds } = measured;
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const head = {
    x: (bounds.minX + bounds.maxX) / 2 + facing.x * width * 0.32,
    y: (bounds.minY + bounds.maxY) / 2 + facing.y * height * 0.32,
  };
  const headMotion = [
    { lateral: 0, down: 0 },
    { lateral: 1.5, down: 0.5 },
    { lateral: 3, down: 1 },
    { lateral: -1, down: 0.25 },
  ][phase];
  return warpCell(source, (x, y) => {
    const scaled = {
      x: anchor.x + (x - anchor.x) / scale.x,
      y: anchor.y + (y - anchor.y) / scale.y,
    };
    // Preserve the authored transparent guard pixels even for silhouettes that
    // already use nearly the full cell (notably the elk north/south poses).
    const edgeFade = warpEdgeFade(x, y);
    const normalizedX = (x - head.x) / Math.max(20, width * 0.3);
    const normalizedY = (y - head.y) / Math.max(20, height * 0.32);
    const contactFade = Math.max(0, Math.min(1, (measured.ground.y - y) / 8));
    const headInfluence = Math.exp(-0.5 * (normalizedX ** 2 + normalizedY ** 2)) * edgeFade * contactFade;
    return {
      x: x + (scaled.x - x) * edgeFade
        - perpendicular.x * headMotion.lateral * headInfluence,
      y: y + (scaled.y - y) * edgeFade
        - (perpendicular.y * headMotion.lateral + headMotion.down) * headInfluence,
    };
  });
};

const headMotion = (source, directionIndex, phase, action, species) => {
  if (phase === 0) return source;
  const measured = measure(source);
  const { bounds } = measured;
  const facing = FACING[directionIndex];
  // The compact rabbit/deer source paintings project a lowered muzzle toward
  // the camera, while the taller elk/boar preserve their world-facing depth.
  // Account for that authored perspective so north-facing motion articulates
  // the head rather than the rump.
  const projectsMuzzleTowardCamera = species === 'rabbit' || species === 'deer';
  const poseFacing = { x: facing.x, y: projectsMuzzleTowardCamera ? Math.abs(facing.y) : facing.y };
  // The away-facing elk/boar head occupies a much smaller share of the tall
  // silhouette, so the same source-pixel displacement reads too weakly. Give
  // that one projection a larger, still grounded, neck articulation.
  const motionBoost = !projectsMuzzleTowardCamera && directionIndex === 2 ? 2 : 1;
  const perpendicular = { x: -poseFacing.y, y: poseFacing.x };
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const center = {
    x: (bounds.minX + bounds.maxX) / 2 + poseFacing.x * width * 0.31,
    y: (bounds.minY + bounds.maxY) / 2 + poseFacing.y * height * 0.31,
  };
  const radius = {
    x: Math.max(18, width * 0.28),
    y: Math.max(18, height * 0.3),
  };
  const motion = action === 'foraging'
    ? [
      { forward: 0, down: 0, lateral: 0 },
      { forward: 1.4, down: 2.2, lateral: -0.6 },
      { forward: 4, down: 5, lateral: 0.3 },
      { forward: 0.6, down: 1.5, lateral: 1.4 },
    ][phase]
    : [
      { forward: 0, down: 0, lateral: 0 },
      { forward: 1.2, down: 2.4, lateral: 0.45 },
      { forward: 3, down: 5.5, lateral: -0.45 },
      { forward: 0.4, down: 1.5, lateral: -1.4 },
    ][phase];
  const displacement = {
    x: (poseFacing.x * motion.forward + perpendicular.x * motion.lateral) * motionBoost,
    // A head dip is screen-down in the painted projection. Do not cancel it
    // with the north-facing world vector.
    y: (motion.down + perpendicular.y * motion.lateral) * motionBoost,
  };
  const baseBodyScale = [
    { x: 1, y: 1 },
    { x: 1.004, y: 1.01 },
    { x: 1.01, y: 1.025 },
    { x: 1.003, y: 1.008 },
  ][phase];
  const bodyScale = {
    x: 1 + (baseBodyScale.x - 1) * motionBoost,
    y: 1 + (baseBodyScale.y - 1) * motionBoost,
  };
  const bodyAnchor = { x: measured.root.x, y: measured.ground.y };

  return warpCell(source, (x, y) => {
    const normalizedX = (x - center.x) / radius.x;
    const normalizedY = (y - center.y) / radius.y;
    const edgeFade = warpEdgeFade(x, y);
    const contactFade = Math.max(0, Math.min(1, (measured.ground.y - y) / 8));
    const influence = Math.exp(-0.5 * (normalizedX ** 2 + normalizedY ** 2)) * edgeFade * contactFade;
    const scaled = {
      x: bodyAnchor.x + (x - bodyAnchor.x) / bodyScale.x,
      y: bodyAnchor.y + (y - bodyAnchor.y) / bodyScale.y,
    };
    return {
      x: x + (scaled.x - x) * edgeFade - displacement.x * influence,
      y: y + (scaled.y - y) * edgeFade - displacement.y * influence,
    };
  });
};

const countFaintAlpha = (image) => {
  let count = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] > 0 && image.data[offset] <= EDGE_ALPHA_THRESHOLD) count += 1;
  }
  return count;
};

const countEdgePixels = (cell) => {
  let count = 0;
  for (let coordinate = 0; coordinate < CELL; coordinate += 1) {
    const offsets = [
      coordinate * 4 + 3,
      ((CELL - 1) * CELL + coordinate) * 4 + 3,
      (coordinate * CELL) * 4 + 3,
      (coordinate * CELL + CELL - 1) * 4 + 3,
    ];
    for (const offset of offsets) if (cell.data[offset] > EDGE_ALPHA_THRESHOLD) count += 1;
  }
  return count;
};

const rawCellHash = (cell) => sha256(cell.data);

const validateAtlas = (atlas, columns, rows, label, groups) => {
  requireDimensions(atlas, columns * CELL, rows * CELL, label);
  let faintAlphaPixels = countFaintAlpha(atlas);
  let edgePixels = 0;
  let minVisiblePixels = Number.POSITIVE_INFINITY;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = extractCell(atlas, column, row);
      edgePixels += countEdgePixels(cell);
      minVisiblePixels = Math.min(minVisiblePixels, measure(cell).visiblePixels);
    }
  }
  if (faintAlphaPixels > 0) throw new Error(`${label} contains ${faintAlphaPixels} faint-alpha pixels`);
  if (edgePixels > 0) throw new Error(`${label} contains ${edgePixels} visible cell-edge pixels`);

  const uniquePoseCounts = [];
  for (const group of groups) {
    const hashes = group.cells.map(({ column, row }) => rawCellHash(extractCell(atlas, column, row)));
    const unique = new Set(hashes).size;
    if (unique < group.minimum) {
      throw new Error(`${label} ${group.label} has ${unique} unique poses; expected ${group.minimum}`);
    }
    uniquePoseCounts.push({ label: group.label, unique });
  }

  return {
    faintAlphaPixels,
    edgePixels,
    minVisiblePixels,
    minimumUniquePoses: Math.min(...uniquePoseCounts.map(({ unique }) => unique)),
  };
};

const registerIdlePhase = (source, reference) => {
  const before = measure(source);
  const target = measure(reference);
  const requested = {
    x: Math.round(target.root.x - before.root.x),
    rootY: Math.round(target.root.y - before.root.y),
    groundY: target.ground.y - before.ground.y,
  };
  if (requested.x === 0 && requested.rootY === 0 && requested.groundY === 0) {
    return {
      cell: source,
      report: {
        requested,
        applied: { ...requested },
        capped: false,
        idleRoot: { x: round(target.root.x), y: round(target.root.y) },
        idleGroundY: target.ground.y,
        sourceRootBefore: { x: round(before.root.x), y: round(before.root.y) },
        rootAfter: { x: round(before.root.x), y: round(before.root.y) },
        groundYBefore: before.ground.y,
        groundYAfter: before.ground.y,
        rootDeltaX: round(before.root.x - target.root.x),
        rootDeltaY: round(before.root.y - target.root.y),
        groundDeltaY: before.ground.y - target.ground.y,
      },
    };
  }

  const horizontal = clampShift(before, { x: requested.x, y: 0 });
  const rootY = before.root.y + requested.rootY;
  const sourceLowerSpan = before.ground.y - before.root.y;
  const targetLowerSpan = target.ground.y - rootY;
  if (sourceLowerSpan <= 1 || targetLowerSpan <= 1) {
    throw new Error('Idle registration requires a measurable root-to-ground span');
  }
  const cell = warpCell(source, (x, y) => {
    let sourceY;
    if (y <= rootY) sourceY = y - requested.rootY;
    else if (y <= target.ground.y) {
      sourceY = before.root.y + ((y - rootY) * sourceLowerSpan) / targetLowerSpan;
    } else sourceY = before.ground.y + (y - target.ground.y);
    return { x: x - horizontal.x, y: sourceY };
  });
  const after = measure(cell);
  return {
    cell,
    report: {
      requested,
      applied: { x: horizontal.x, rootY: requested.rootY, groundY: requested.groundY },
      capped: horizontal.x !== requested.x,
      idleRoot: { x: round(target.root.x), y: round(target.root.y) },
      idleGroundY: target.ground.y,
      sourceRootBefore: { x: round(before.root.x), y: round(before.root.y) },
      rootAfter: { x: round(after.root.x), y: round(after.root.y) },
      groundYBefore: before.ground.y,
      groundYAfter: after.ground.y,
      rootDeltaX: round(after.root.x - target.root.x),
      rootDeltaY: round(after.root.y - target.root.y),
      groundDeltaY: after.ground.y - target.ground.y,
    },
  };
};

const normalizeIdlePhase = (source, reference) => {
  let cell = source;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const result = registerIdlePhase(cell, reference);
    cell = result.cell;
    const { requested } = result.report;
    if (requested.x === 0 && requested.rootY === 0 && requested.groundY === 0) break;
  }
  const final = registerIdlePhase(cell, reference);
  if (final.report.requested.x !== 0
    || final.report.requested.rootY !== 0
    || final.report.requested.groundY !== 0) {
    throw new Error('Idle phase registration did not converge to a stable root and ground line');
  }
  return { cell, report: final.report };
};

const normalizeMovementAtlas = (definition) => {
  const source = readPng(definition.movement);
  requireDimensions(source, COLUMNS * CELL, 6 * CELL, definition.movement);
  const output = emptyPng(source.width, source.height);
  PNG.bitblt(source, output, 0, 0, source.width, source.height, 0, 0);
  const alignment = [];

  for (let directionIndex = 0; directionIndex < COLUMNS; directionIndex += 1) {
    const reference = sanitizeAlpha(extractCell(source, directionIndex, 0));
    for (let phase = 0; phase < 2; phase += 1) {
      const idle = sanitizeAlpha(extractCell(source, directionIndex, phase));
      const registered = normalizeIdlePhase(idle, reference);
      pasteCell(registered.cell, output, directionIndex, phase);
    }
  }

  // Record the final fixed point rather than the pre-normalization shift. The
  // movement atlas is both an input and an output, so this keeps the manifest
  // byte-stable on the first subsequent --check.
  for (let directionIndex = 0; directionIndex < COLUMNS; directionIndex += 1) {
    const reference = extractCell(output, directionIndex, 0);
    for (let phase = 0; phase < 2; phase += 1) {
      const registered = normalizeIdlePhase(extractCell(output, directionIndex, phase), reference);
      alignment.push({
        direction: DIRECTIONS[directionIndex],
        phase,
        ...registered.report,
      });
    }
  }

  const groups = DIRECTIONS.map((direction, directionIndex) => ({
    label: `${direction}/idle`,
    minimum: 2,
    cells: [0, 1].map((row) => ({ column: directionIndex, row })),
  }));
  return {
    output,
    alignment,
    quality: validateAtlas(output, COLUMNS, 6, definition.movement, groups),
  };
};

const buildActionAtlas = (definition, movement) => {
  const source = readPng(definition.source);
  requireDimensions(source, COLUMNS * CELL, SOURCE_ACTION_ROWS * CELL, definition.source);
  requireDimensions(movement, COLUMNS * CELL, 6 * CELL, definition.movement);

  const output = emptyPng(COLUMNS * CELL, OUTPUT_ACTION_ROWS * CELL);
  const alignment = [];
  const aligned = Array.from({ length: SOURCE_ACTION_ROWS }, () => Array(COLUMNS));

  for (let actionIndex = 0; actionIndex < SOURCE_ACTION_ROWS; actionIndex += 1) {
    for (let directionIndex = 0; directionIndex < COLUMNS; directionIndex += 1) {
      const sourceCell = sanitizeAlpha(extractCell(source, directionIndex, actionIndex));
      const idleCell = sanitizeAlpha(extractCell(movement, directionIndex, 0));
      const result = alignToIdle(sourceCell, idleCell);
      aligned[actionIndex][directionIndex] = result.cell;
      alignment.push({
        action: ACTIONS[actionIndex],
        direction: DIRECTIONS[directionIndex],
        ...result.report,
      });

      for (let phase = 0; phase < 4; phase += 1) {
        const generated = actionIndex === 0
          ? groundedBreath(result.cell, phase, directionIndex)
          : headMotion(result.cell, directionIndex, phase, ACTIONS[actionIndex], definition.name);
        pasteCell(generated, output, directionIndex, actionIndex * 4 + phase);
      }
    }
  }

  const groups = [];
  for (let actionIndex = 0; actionIndex < ACTIONS.length; actionIndex += 1) {
    for (let directionIndex = 0; directionIndex < COLUMNS; directionIndex += 1) {
      groups.push({
        label: `${DIRECTIONS[directionIndex]}/${ACTIONS[actionIndex]}`,
        minimum: 3,
        cells: [0, 1, 2, 3].map((phase) => ({ column: directionIndex, row: actionIndex * 4 + phase })),
      });
    }
  }
  const quality = validateAtlas(output, COLUMNS, OUTPUT_ACTION_ROWS, definition.output, groups);
  return { output, alignment, quality };
};

const buildBoarCharge = (movement) => {
  const output = emptyPng(4 * CELL, COLUMNS * CELL);
  const alignment = [];
  for (let directionIndex = 0; directionIndex < COLUMNS; directionIndex += 1) {
    const idle = sanitizeAlpha(extractCell(movement, directionIndex, 0));
    const runA = sanitizeAlpha(extractCell(movement, directionIndex, 2));
    const runB = sanitizeAlpha(extractCell(movement, directionIndex, 3));
    const sprint = sanitizeAlpha(extractCell(movement, directionIndex, 4));
    const planted = measure(runB);
    // Every charge phase is a locomotion pose because the boar remains at full
    // velocity during retaliation. The compressed run-B is a distinct planted
    // anticipation key between the two authored stride poses.
    const compressedRunB = warpCell(runB, (x, y) => {
      const anchor = { x: planted.root.x, y: planted.ground.y };
      const edgeFade = warpEdgeFade(x, y);
      const compressed = {
        x: anchor.x + (x - anchor.x) / 1.025,
        y: anchor.y + (y - anchor.y) / 0.95,
      };
      return {
        x: x + (compressed.x - x) * edgeFade,
        y: y + (compressed.y - y) * edgeFade,
      };
    });
    const sourcePhases = [runA, compressedRunB, sprint, runB];
    const phases = sourcePhases.map((cell, phase) => {
      const registered = alignToIdle(cell, idle);
      alignment.push({
        direction: DIRECTIONS[directionIndex],
        phase: ['stride-anticipation', 'stride-compression', 'stride-extension', 'stride-recovery'][phase],
        ...registered.report,
      });
      return registered.cell;
    });
    phases.forEach((cell, phase) => pasteCell(cell, output, phase, directionIndex));
  }
  const groups = DIRECTIONS.map((direction, directionIndex) => ({
    label: `${direction}/charge`,
    minimum: 4,
    cells: [0, 1, 2, 3].map((column) => ({ column, row: directionIndex })),
  }));
  return {
    output,
    alignment,
    quality: validateAtlas(output, 4, COLUMNS, CHARGE_OUTPUT, groups),
  };
};

const encodedOutputs = new Map();
const speciesManifest = {};
const movementBySpecies = new Map();

for (const definition of SPECIES) {
  const movementBuild = normalizeMovementAtlas(definition);
  const movementBytes = PNG.sync.write(movementBuild.output);
  encodedOutputs.set(definition.movement, movementBytes);
  movementBySpecies.set(definition.name, movementBuild.output);

  const actionBuild = buildActionAtlas(definition, movementBuild.output);
  const actionBytes = PNG.sync.write(actionBuild.output);
  encodedOutputs.set(definition.output, actionBytes);
  speciesManifest[definition.name] = {
    source: definition.source,
    sourceSha256: sha256(readFileSync(absolute(definition.source))),
    movement: definition.movement,
    movementSha256: sha256(movementBytes),
    movementQuality: movementBuild.quality,
    idleAlignment: movementBuild.alignment,
    output: definition.output,
    outputSha256: sha256(actionBytes),
    width: actionBuild.output.width,
    height: actionBuild.output.height,
    frames: COLUMNS * OUTPUT_ACTION_ROWS,
    quality: actionBuild.quality,
    alignment: actionBuild.alignment,
  };
}

const boarDefinition = SPECIES.find(({ name }) => name === 'boar');
if (!boarDefinition) throw new Error('Boar source is required for the charge atlas');
const boarMovement = movementBySpecies.get(boarDefinition.name);
if (!boarMovement) throw new Error('Normalized boar movement atlas is required for the charge atlas');
const chargeBuild = buildBoarCharge(boarMovement);
const chargeBytes = PNG.sync.write(chargeBuild.output);
encodedOutputs.set(CHARGE_OUTPUT, chargeBytes);

const manifest = {
  schemaVersion: 1,
  generator: 'scripts/build-animal-action-atlases.mjs',
  art_source: 'existing',
  cellSize: CELL,
  directions: DIRECTIONS,
  actions: {
    layout: 'phaseRows',
    rows: {
      resting: [0, 1, 2, 3],
      foraging: [4, 5, 6, 7],
      drinking: [8, 9, 10, 11],
    },
  },
  species: speciesManifest,
  boarCharge: {
    output: CHARGE_OUTPUT,
    outputSha256: sha256(chargeBytes),
    width: chargeBuild.output.width,
    height: chargeBuild.output.height,
    frames: 32,
    layout: 'directionRows',
    phases: ['stride-anticipation', 'stride-compression', 'stride-extension', 'stride-recovery'],
    quality: chargeBuild.quality,
    alignment: chargeBuild.alignment,
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
encodedOutputs.set(MANIFEST_OUTPUT, manifestBytes);

if (CHECK) {
  const stale = [];
  for (const [path, expected] of encodedOutputs) {
    if (!existsSync(absolute(path)) || !readFileSync(absolute(path)).equals(expected)) stale.push(path);
  }
  if (stale.length > 0) {
    console.error(`Animal action factory outputs are stale:\n${stale.map((path) => `- ${path}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Animal action factory check passed (${encodedOutputs.size} deterministic outputs).`);
  }
} else {
  for (const [path, bytes] of encodedOutputs) {
    mkdirSync(dirname(absolute(path)), { recursive: true });
    writeFileSync(absolute(path), bytes);
  }
  const capped = Object.values(speciesManifest)
    .flatMap(({ alignment, idleAlignment }) => [...idleAlignment, ...alignment])
    .filter(({ capped }) => capped).length;
  const maxGroundDelta = Math.max(...Object.values(speciesManifest)
    .flatMap(({ alignment, idleAlignment }) => [...idleAlignment, ...alignment])
    .map(({ groundDeltaY }) => Math.abs(groundDeltaY)));
  const poseCount = SPECIES.length * (2 + SOURCE_ACTION_ROWS) * COLUMNS;
  console.log(`Built ${SPECIES.length} normalized movement atlases, action atlases, and boar charge (${encodedOutputs.size} outputs).`);
  console.log(`Alignment: ${poseCount} poses, ${capped} safely capped, max ground delta ${maxGroundDelta}px.`);
}
