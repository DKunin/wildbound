#!/usr/bin/env node

/**
 * Normalize player-wolf state atlases to the same visible body-area profile as
 * the same-direction idle. One shared factor is applied to each authored state
 * sequence, around every frame's existing direction-specific registration.
 *
 * Usage:
 *   node scripts/normalize-player-state-scales.mjs
 *   node scripts/normalize-player-state-scales.mjs --check
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/player-wolf-v2');
const REPORT_PATH = resolve(ROOT, 'art-source/animal-scale-audit-v1/player-normalization.json');
const CHECK = process.argv.includes('--check');
const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const ALPHA_THRESHOLD = 16;
const SCALE_EPSILON = 0.01;
const DIRECTIONS = [
  'east', 'northeast', 'north', 'northwest',
  'west', 'southwest', 'south', 'southeast',
];
const ACTIONS = [
  { state: 'attacking', frames: [0, 1, 2, 3, 4] },
  { state: 'eating', frames: [5, 6, 7, 8, 9] },
  { state: 'drinking', frames: [10, 11, 12, 13, 14, 15] },
];

const round = (value, places = 6) => Number(value.toFixed(places));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};

const extractCell = (atlas, frame) => {
  const cell = new PNG({ width: FRAME_WIDTH, height: FRAME_HEIGHT, colorType: 6 });
  const left = (frame % 4) * FRAME_WIDTH;
  const top = Math.floor(frame / 4) * FRAME_HEIGHT;
  PNG.bitblt(atlas, cell, left, top, FRAME_WIDTH, FRAME_HEIGHT, 0, 0);
  return cell;
};

const pasteCell = (cell, atlas, frame) => {
  const left = (frame % 4) * FRAME_WIDTH;
  const top = Math.floor(frame / 4) * FRAME_HEIGHT;
  PNG.bitblt(cell, atlas, 0, 0, FRAME_WIDTH, FRAME_HEIGHT, left, top);
};

const measure = (cell) => {
  let visiblePixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let topY = FRAME_HEIGHT;
  let groundY = -1;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const alpha = cell.data[(y * FRAME_WIDTH + x) * 4 + 3];
      if (alpha <= ALPHA_THRESHOLD) continue;
      visiblePixels += 1;
      alphaWeight += alpha;
      weightedX += x * alpha;
      topY = Math.min(topY, y);
      groundY = y;
    }
  }
  if (visiblePixels === 0) throw new Error('Player atlas contains an empty frame');
  return { visiblePixels, rootX: weightedX / alphaWeight, topY, groundY };
};

const sanitizeAlpha = (cell) => {
  for (let offset = 0; offset < cell.data.length; offset += 4) {
    if (cell.data[offset + 3] > ALPHA_THRESHOLD) continue;
    cell.data.fill(0, offset, offset + 4);
  }
  return cell;
};

const samplePremultiplied = (source, x, y, output, outputOffset) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  let alpha = 0;
  const premultiplied = [0, 0, 0];
  for (let sampleY = 0; sampleY <= 1; sampleY += 1) {
    const sourceY = y0 + sampleY;
    if (sourceY < 0 || sourceY >= FRAME_HEIGHT) continue;
    const weightY = sampleY === 0 ? 1 - ty : ty;
    for (let sampleX = 0; sampleX <= 1; sampleX += 1) {
      const sourceX = x0 + sampleX;
      if (sourceX < 0 || sourceX >= FRAME_WIDTH) continue;
      const weight = weightY * (sampleX === 0 ? 1 - tx : tx);
      const sourceOffset = (sourceY * FRAME_WIDTH + sourceX) * 4;
      const sourceAlpha = source.data[sourceOffset + 3] / 255;
      alpha += sourceAlpha * weight;
      for (let channel = 0; channel < 3; channel += 1) {
        premultiplied[channel] += source.data[sourceOffset + channel] * sourceAlpha * weight;
      }
    }
  }
  const outputAlpha = Math.round(alpha * 255);
  if (outputAlpha <= ALPHA_THRESHOLD) {
    output.fill(0, outputOffset, outputOffset + 4);
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    output[outputOffset + channel] = Math.max(0, Math.min(255, Math.round(premultiplied[channel] / alpha)));
  }
  output[outputOffset + 3] = outputAlpha;
};

const translateCell = (source, shiftY) => {
  if (shiftY === 0) return source;
  const target = new PNG({ width: FRAME_WIDTH, height: FRAME_HEIGHT, colorType: 6 });
  target.data.fill(0);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const targetY = y + shiftY;
    if (targetY < 0 || targetY >= FRAME_HEIGHT) continue;
    const sourceStart = y * FRAME_WIDTH * 4;
    const targetStart = targetY * FRAME_WIDTH * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceStart + FRAME_WIDTH * 4);
  }
  return target;
};

const scaleCell = (source, scale, direction, targetNorthAnchorY) => {
  const anchor = measure(source);
  if (Math.abs(scale - 1) < SCALE_EPSILON) {
    const aligned = direction === 'north'
      ? translateCell(source, Math.round(targetNorthAnchorY - anchor.topY))
      : source;
    return sanitizeAlpha(aligned);
  }
  const target = new PNG({ width: FRAME_WIDTH, height: FRAME_HEIGHT, colorType: 6 });
  target.data.fill(0);
  const anchorY = direction === 'north' ? anchor.topY : anchor.groundY;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      samplePremultiplied(
        source,
        anchor.rootX + (x - anchor.rootX) / scale,
        anchorY + (y - anchorY) / scale,
        target.data,
        (y * FRAME_WIDTH + x) * 4,
      );
    }
  }
  const aligned = direction === 'north'
    ? translateCell(target, Math.round(targetNorthAnchorY - measure(target).topY))
    : target;
  return sanitizeAlpha(aligned);
};

const normalizeGroup = (atlas, frames, targetArea, state, direction, targetNorthAnchorY, calibrationFrames = frames) => {
  const beforeAreas = calibrationFrames.map((frame) => measure(extractCell(atlas, frame)).visiblePixels);
  const beforeArea = median(beforeAreas);
  const scale = Math.sqrt(targetArea / beforeArea);
  for (const frame of frames) {
    pasteCell(scaleCell(extractCell(atlas, frame), scale, direction, targetNorthAnchorY), atlas, frame);
  }
  const afterAreas = calibrationFrames.map((frame) => measure(extractCell(atlas, frame)).visiblePixels);
  const afterArea = median(afterAreas);
  return {
    state,
    frames,
    calibrationFrames,
    scale: round(scale),
    targetVisiblePixels: round(targetArea, 3),
    visiblePixelsBefore: round(beforeArea, 3),
    visiblePixelsAfter: round(afterArea, 3),
    areaRatioBefore: round(beforeArea / targetArea),
    areaRatioAfter: round(afterArea / targetArea),
  };
};

const pending = new Map();
const directions = [];
for (const direction of DIRECTIONS) {
  const motionPath = resolve(ASSET_ROOT, `wolf-${direction}-motion.png`);
  const actionPath = resolve(ASSET_ROOT, `wolf-${direction}-action.png`);
  const restPath = resolve(ASSET_ROOT, `wolf-${direction}-rest.png`);
  const motion = PNG.sync.read(readFileSync(motionPath));
  const action = PNG.sync.read(readFileSync(actionPath));
  const rest = PNG.sync.read(readFileSync(restPath));
  const targetArea = median(Array.from({ length: 8 }, (_value, index) => (
    measure(extractCell(motion, 8 + index)).visiblePixels
  )));
  const targetNorthAnchorY = median(Array.from({ length: 8 }, (_value, index) => (
    measure(extractCell(motion, 8 + index)).topY
  )));
  const groups = ACTIONS.map(({ state, frames }) => normalizeGroup(
    action,
    frames,
    targetArea,
    state,
    direction,
    targetNorthAnchorY,
  ));
  groups.push(normalizeGroup(
    rest,
    Array.from({ length: 16 }, (_value, frame) => frame),
    targetArea,
    'rest-sequence',
    direction,
    targetNorthAnchorY,
    [0, 15],
  ));
  const actionBytes = PNG.sync.write(action);
  const restBytes = PNG.sync.write(rest);
  pending.set(actionPath, actionBytes);
  pending.set(restPath, restBytes);
  directions.push({
    direction,
    idleVisiblePixels: round(targetArea, 3),
    groups,
    outputs: [
      { file: `public/assets/player-wolf-v2/wolf-${direction}-action.png`, sha256: sha256(actionBytes) },
      { file: `public/assets/player-wolf-v2/wolf-${direction}-rest.png`, sha256: sha256(restBytes) },
    ],
  });
}

const changed = [...pending].filter(([path, bytes]) => !readFileSync(path).equals(bytes));
if (CHECK) {
  if (changed.length > 0) {
    console.error(`Player state scale outputs are stale:\n${changed.map(([path]) => `- ${path}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Player state scale check passed (${pending.size} atlases).`);
  }
} else if (changed.length === 0 && existsSync(REPORT_PATH)) {
  console.log(`Player state scales already normalized (${pending.size} atlases).`);
} else {
  const beforeHashes = new Map(changed.map(([path]) => [path, sha256(readFileSync(path))]));
  for (const [path, bytes] of changed) writeFileSync(path, bytes);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    generator: 'scripts/normalize-player-state-scales.mjs',
    art_source: 'existing',
    method: 'shared visible-area scale per same-direction state sequence; premultiplied bilinear sampling around the existing horizontal root and direction-specific vertical anchor',
    directions,
    changed: changed.map(([path, bytes]) => ({
      file: path.slice(ROOT.length + 1),
      beforeSha256: beforeHashes.get(path),
      afterSha256: sha256(bytes),
    })),
  }, null, 2)}\n`);
  console.log(`Normalized ${changed.length} player state atlases; report: ${REPORT_PATH.slice(ROOT.length + 1)}.`);
}
