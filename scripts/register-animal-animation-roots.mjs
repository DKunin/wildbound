#!/usr/bin/env node

/**
 * Register Wildbound animal atlases around a stable anatomical body core.
 *
 * This is intentionally translation-only: every authored pixel, pose, scale,
 * limb swing, and vertical silhouette change survives. The script erodes each
 * alpha mask until thin legs, tails, ears, and antialiasing fall away, then
 * aligns the largest remaining torso mass to one direction-specific root.
 *
 * Usage:
 *   node scripts/register-animal-animation-roots.mjs --dry-run
 *   node scripts/register-animal-animation-roots.mjs
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_ROOT = resolve(ROOT, 'art-source/animal-animation-audit-v1');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const ALPHA_THRESHOLD = 96;
const EDGE_ALPHA_THRESHOLD = 16;
const SAFE_MARGIN = 2;
const MAX_SHIFT = 92;

const PLAYER_DIRECTIONS = [
  'east', 'northeast', 'north', 'northwest',
  'west', 'southwest', 'south', 'southeast',
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const frameOffset = (image, frameWidth, frameHeight, frame) => ({
  left: (frame % Math.floor(image.width / frameWidth)) * frameWidth,
  top: Math.floor(frame / Math.floor(image.width / frameWidth)) * frameHeight,
});

const alphaMask = (image, frameWidth, frameHeight, frame) => {
  const { left, top } = frameOffset(image, frameWidth, frameHeight, frame);
  const mask = new Uint8Array(frameWidth * frameHeight);
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  let weight = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const alpha = image.data[(((top + y) * image.width) + left + x) * 4 + 3];
      if (alpha > EDGE_ALPHA_THRESHOLD) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < ALPHA_THRESHOLD) continue;
      mask[y * frameWidth + x] = 1;
      weight += alpha;
      weightedX += x * alpha;
      weightedY += y * alpha;
    }
  }
  if (maxX < minX || weight === 0) throw new Error(`Frame ${frame} is empty`);
  return {
    mask,
    bounds: { minX, minY, maxX, maxY },
    fallback: { x: weightedX / weight, y: weightedY / weight },
  };
};

const erode = (source, width, height, iterations) => {
  let current = source;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!current[index]) continue;
        let solid = true;
        for (let offsetY = -1; offsetY <= 1 && solid; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!current[(y + offsetY) * width + x + offsetX]) {
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

const largestComponentCentroid = (mask, width, height) => {
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
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      size += 1;
      sumX += x;
      sumY += y;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (size > largest.size) largest = { size, sumX, sumY };
  }
  return largest.size > 0
    ? { x: largest.sumX / largest.size, y: largest.sumY / largest.size, pixels: largest.size }
    : undefined;
};

const analyzeFrame = (image, frameWidth, frameHeight, frame) => {
  const measured = alphaMask(image, frameWidth, frameHeight, frame);
  const erosionIterations = frameWidth <= 181 ? 4 : 7;
  const core = largestComponentCentroid(
    erode(measured.mask, frameWidth, frameHeight, erosionIterations),
    frameWidth,
    frameHeight,
  );
  return {
    root: core ?? measured.fallback,
    corePixels: core?.pixels ?? 0,
    bounds: measured.bounds,
  };
};

const safeShiftLimits = (measurement, frameWidth, frameHeight) => ({
  minX: SAFE_MARGIN - measurement.bounds.minX,
  maxX: frameWidth - SAFE_MARGIN - 1 - measurement.bounds.maxX,
  minY: SAFE_MARGIN - measurement.bounds.minY,
  maxY: frameHeight - SAFE_MARGIN - 1 - measurement.bounds.maxY,
});

const safeShift = (measurement, requestedX, requestedY, frameWidth, frameHeight) => {
  const limits = safeShiftLimits(measurement, frameWidth, frameHeight);
  const x = Math.max(limits.minX, Math.min(limits.maxX, requestedX));
  const y = Math.max(limits.minY, Math.min(limits.maxY, requestedY));
  return { x, y, capped: x !== requestedX || y !== requestedY };
};

const translateFrame = (source, target, frameWidth, frameHeight, frame, shiftX, shiftY) => {
  const { left, top } = frameOffset(source, frameWidth, frameHeight, frame);
  for (let y = 0; y < frameHeight; y += 1) {
    const start = (((top + y) * target.width) + left) * 4;
    target.data.fill(0, start, start + frameWidth * 4);
  }
  for (let y = 0; y < frameHeight; y += 1) {
    const targetY = y + shiftY;
    if (targetY < 0 || targetY >= frameHeight) continue;
    for (let x = 0; x < frameWidth; x += 1) {
      const targetX = x + shiftX;
      if (targetX < 0 || targetX >= frameWidth) continue;
      const sourceOffset = ((((top + y) * source.width) + left + x) * 4);
      const targetOffset = ((((top + targetY) * target.width) + left + targetX) * 4);
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
};

const readPng = (path) => PNG.sync.read(readFileSync(path));
const clonePng = (image) => {
  const clone = new PNG({ width: image.width, height: image.height, colorType: 6 });
  image.data.copy(clone.data);
  return clone;
};

const reports = [];
const pending = new Map();
const previousReportPath = resolve(REPORT_ROOT, 'registration-report.json');
const hasPreviousReport = existsSync(previousReportPath);
if (!DRY_RUN && !FORCE && !hasPreviousReport) {
  throw new Error('Registration state is missing. Run --dry-run first, then use --force only after backing up the source atlases.');
}
const previousReports = hasPreviousReport
  ? new Map(JSON.parse(readFileSync(previousReportPath, 'utf8')).files.map((entry) => [entry.file, entry]))
  : new Map();

const registerAtlas = ({ path, frameWidth, frameHeight, targets }) => {
  const file = relative(ROOT, path);
  const currentHash = sha256(readFileSync(path));
  const previous = previousReports.get(file);
  if (!FORCE && previous?.afterSha256 === currentHash) {
    reports.push({
      ...previous,
      alreadyRegistered: true,
    });
    return;
  }
  const source = readPng(path);
  const target = clonePng(source);
  const frameCount = Math.floor(source.width / frameWidth) * Math.floor(source.height / frameHeight);
  const shifts = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const targetRoot = targets.get(frame);
    if (!targetRoot) continue;
    const measurement = analyzeFrame(source, frameWidth, frameHeight, frame);
    const requestedX = Math.round(targetRoot.x - measurement.root.x);
    const requestedY = Math.round(targetRoot.y - measurement.root.y);
    if (Math.abs(requestedX) > MAX_SHIFT || Math.abs(requestedY) > MAX_SHIFT) {
      throw new Error(`${relative(ROOT, path)} frame ${frame} requested unsafe shift ${requestedX},${requestedY}`);
    }
    const shift = safeShift(measurement, requestedX, requestedY, frameWidth, frameHeight);
    translateFrame(source, target, frameWidth, frameHeight, frame, shift.x, shift.y);
    shifts.push({
      frame,
      x: shift.x,
      y: shift.y,
      requestedX,
      requestedY,
      capped: shift.capped,
      corePixels: measurement.corePixels,
    });
  }
  const after = PNG.sync.write(target);
  pending.set(path, after);
  reports.push({
    file,
    beforeSha256: currentHash,
    afterSha256: sha256(after),
    changedFrames: shifts.filter(({ x, y }) => x !== 0 || y !== 0).length,
    cappedFrames: shifts.filter(({ capped }) => capped).length,
    maximumShift: shifts.reduce((maximum, shift) => Math.max(maximum, Math.hypot(shift.x, shift.y)), 0),
    shifts,
  });
};

const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};

const targetsForSequences = (image, frameWidth, frameHeight, sequences) => {
  const targets = new Map();
  for (const sequence of sequences) {
    const measurements = sequence.map((frame) => analyzeFrame(image, frameWidth, frameHeight, frame));
    const roots = measurements.map(({ root }) => root);
    const limits = measurements.map((measurement) => safeShiftLimits(measurement, frameWidth, frameHeight));
    const chooseReachableTarget = (axis, minimum, maximum) => {
      const preferred = median(roots.map((root) => root[axis]));
      const sharedMinimum = Math.max(...roots.map((root, index) => root[axis] + limits[index][minimum]));
      const sharedMaximum = Math.min(...roots.map((root, index) => root[axis] + limits[index][maximum]));
      if (sharedMinimum <= sharedMaximum) return Math.max(sharedMinimum, Math.min(sharedMaximum, preferred));
      // When silhouettes leave no perfectly shared position, center the unavoidable gap
      // so neither extreme absorbs the entire residual jump.
      return (sharedMinimum + sharedMaximum) / 2;
    };
    const target = {
      x: chooseReachableTarget('x', 'minX', 'maxX'),
      y: chooseReachableTarget('y', 'minY', 'maxY'),
    };
    for (const frame of sequence) targets.set(frame, target);
  }
  return targets;
};

const frames = (start, end) => Array.from({ length: end - start + 1 }, (_value, index) => start + index);

const registerPlayer = () => {
  const root = resolve(ROOT, 'public/assets/player-wolf-v2');
  for (const direction of PLAYER_DIRECTIONS) {
    for (const kind of ['motion', 'run', 'crouch', 'action']) {
      const path = resolve(root, `wolf-${direction}-${kind}.png`);
      const image = readPng(path);
      const sequences = kind === 'motion' || kind === 'crouch'
        ? [frames(0, 7), frames(8, 15)]
        : kind === 'action'
          ? [frames(0, 4), frames(5, 9), frames(10, 15)]
          : [frames(0, 15)];
      registerAtlas({
        path,
        frameWidth: 346,
        frameHeight: 284,
        targets: targetsForSequences(image, 346, 284, sequences),
      });
    }
  }
};

const registerPack = () => {
  for (const subject of ['niva', 'torr']) {
    const path = resolve(ROOT, `public/assets/${subject}-sheet.png`);
    const image = readPng(path);
    const targets = targetsForSequences(
      image,
      346,
      284,
      Array.from({ length: 4 }, (_value, row) => frames(row * 4, row * 4 + 3)),
    );
    registerAtlas({ path, frameWidth: 346, frameHeight: 284, targets });
  }
};

const preyPaths = (species) => {
  const version = species === 'elk' ? 'prey-v3' : species === 'boar' ? 'prey-v4' : 'prey-v2';
  return {
    movement: resolve(ROOT, `public/assets/${version}/${species}-atlas.png`),
    actions: resolve(ROOT, `public/assets/${version}/${species}-actions.png`),
  };
};

const registerPrey = () => {
  for (const species of ['rabbit', 'deer', 'elk', 'boar']) {
    const paths = preyPaths(species);
    const movement = readPng(paths.movement);
    const movementTargets = targetsForSequences(
      movement,
      181,
      181,
      Array.from({ length: 8 }, (_value, column) => [
        [column, 8 + column],
        [16 + column, 24 + column, 32 + column],
      ]).flat(),
    );
    registerAtlas({ path: paths.movement, frameWidth: 181, frameHeight: 181, targets: movementTargets });

  }
};

registerPlayer();
registerPack();
registerPrey();

const summary = {
  version: 1,
  method: 'largest-eroded-alpha-core, whole-pixel translation only',
  dryRun: DRY_RUN,
  files: reports.length,
  changedFrames: reports.reduce((total, report) => total + (report.alreadyRegistered ? 0 : report.changedFrames), 0),
  cappedFrames: reports.reduce((total, report) => total + (report.alreadyRegistered ? 0 : report.cappedFrames), 0),
  maximumShift: reports.reduce(
    (maximum, report) => Math.max(maximum, report.alreadyRegistered ? 0 : report.maximumShift),
    0,
  ),
};

mkdirSync(REPORT_ROOT, { recursive: true });
if (DRY_RUN || pending.size > 0) {
  writeFileSync(
    resolve(REPORT_ROOT, DRY_RUN ? 'registration-preview.json' : 'registration-report.json'),
    `${JSON.stringify({ summary, files: reports }, null, 2)}\n`,
  );
}
if (!DRY_RUN) {
  for (const [path, encoded] of pending) writeFileSync(path, encoded);
  for (const script of [
    'build-player-wolf-carry-atlases.mjs',
    'build-player-wolf-bury-atlases.mjs',
    'build-wounded-spritesheets.mjs',
  ]) {
    const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts', script)], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? 'unknown'}`);
  }
}
process.stdout.write(`${DRY_RUN ? 'Previewed' : 'Registered'} ${summary.changedFrames} frames across ${summary.files} atlases; ${summary.cappedFrames} capped, max ${summary.maximumShift.toFixed(1)}px.\n`);
