#!/usr/bin/env node

/**
 * Deterministic Wildbound animal-animation audit and visual review lab.
 *
 * The inventory below mirrors the frame sequences created in WildScene. It is
 * intentionally explicit: a spritesheet can be technically valid while the
 * actual ordered runtime cycle still pops, pulses, or contains duplicate poses.
 *
 * Usage:
 *   node scripts/audit-animal-animations.mjs
 *   node scripts/audit-animal-animations.mjs --no-html --family boar
 *   node scripts/audit-animal-animations.mjs --inventory-only --stdout
 *   node scripts/audit-animal-animations.mjs --fail-on-hard
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const DEFAULT_OUTPUT = 'art-source/animal-animation-audit-v1';
const ALPHA_THRESHOLD = 16;
const CORE_ALPHA_THRESHOLD = 192;

export const DIRECTIONS = [
  'east',
  'northeast',
  'north',
  'northwest',
  'west',
  'southwest',
  'south',
  'southeast',
];

const PACK_DIRECTIONS = ['down-right', 'down-left', 'up-right', 'up-left'];
const WOUND_LEVELS = [0, 1, 2, 3];

/**
 * Hard limits are deliberately tolerant of intentional body motion. Warnings
 * start much earlier and are the useful curation queue for small visible
 * jiggles. All normalized anchor ranges use the median visible body dimension,
 * not the padded atlas cell, so differently sized animals remain comparable.
 */
export const THRESHOLDS = Object.freeze({
  warning: Object.freeze({
    alphaAnchorRange: 0.055,
    coreAnchorRange: 0.07,
    groundContactYRange: 0.045,
    bboxDimensionPulse: 0.14,
    bboxAreaPulse: 0.24,
    alphaAreaPulse: 0.24,
    loopSeamRatio: 1.9,
    loopSeamDelta: 0.08,
    uniquePoseRatio: 0.55,
    semanticMotionScore: 0.025,
  }),
  hard: Object.freeze({
    alphaAnchorRange: 0.16,
    coreAnchorRange: 0.19,
    groundContactYRange: 0.14,
    bboxDimensionPulse: 0.42,
    bboxAreaPulse: 0.68,
    alphaAreaPulse: 0.68,
    loopSeamRatio: 3.2,
    loopSeamDelta: 0.18,
    uniquePoseRatio: 0.34,
    semanticMotionScore: 0.01,
  }),
});

export const STATE_TRANSITION_THRESHOLDS = Object.freeze({
  warningLinearScaleRatio: 1.06,
  hardLinearScaleRatio: 1.08,
});

const round = (value, places = 6) => {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const median = (values) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};

const range = (values) => values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
const normalizedRange = (values, denominator) => denominator > 0 ? range(values) / denominator : 0;
const pulse = (values) => {
  const center = median(values);
  return center > 0 ? range(values) / center : 0;
};

const sequenceFrames = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

const sourceAssetPath = (source) => {
  if (source.startsWith('wolf-')) return `public/assets/player-wolf-v2/${source}`;
  if (source === 'deer-kick.png') return `public/assets/balance-v1/${source}`;
  return `public/assets/prey-v2/${source}`;
};

const readPreyAnimationContract = (root) => {
  const path = resolve(root, 'src/game/data/prey-animation-contract.json');
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  if (contract.version !== 2 || contract.cellSize !== 181 || !Array.isArray(contract.directions)) {
    throw new Error('Unsupported prey animation contract. Expected version 2 with 181px cells.');
  }
  if (JSON.stringify(contract.directions) !== JSON.stringify(DIRECTIONS)) {
    throw new Error('Prey animation direction order differs from the animation lab.');
  }
  return contract;
};

const readWoundManifest = (root) => {
  const path = resolve(root, 'public/assets/wounds-v1/manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.version !== 1 || manifest.levels !== 3 || !Array.isArray(manifest.spritesheets)) {
    throw new Error('Unsupported wound manifest. Expected version 1 with three levels.');
  }
  return manifest;
};

const frameRefs = (asset, frameWidth, frameHeight, indexes, woundSheet, woundLevel) => {
  if (woundLevel > 0 && !woundSheet) {
    throw new Error(`Missing wound manifest entry for ${asset.split('/').at(-1)}.`);
  }
  return indexes.map((frame) => ({
    asset,
    frame,
    frameWidth,
    frameHeight,
    ...(woundLevel > 0 ? {
      woundAsset: `public/assets/wounds-v1/${woundSheet.file}`,
      woundLevel,
      woundSourceHeight: woundSheet.sourceHeight,
    } : {}),
  }));
};

const makeAnimation = ({
  family,
  subject,
  state,
  direction,
  carrying = false,
  woundLevel = 0,
  frameRate,
  loop,
  motionClass,
  asset,
  frameWidth,
  frameHeight,
  indexes,
  woundSheet,
  minFrames,
  minUniquePoses,
}) => {
  const id = [family, subject, state, direction, carrying ? 'carry' : 'plain', `wound-${woundLevel}`].join('/');
  return {
    id,
    family,
    subject,
    state,
    direction,
    carrying,
    woundLevel,
    frameRate,
    loop,
    motionClass,
    ...(minFrames === undefined ? {} : { minFrames }),
    ...(minUniquePoses === undefined ? {} : { minUniquePoses }),
    cell: { width: frameWidth, height: frameHeight },
    frames: frameRefs(asset, frameWidth, frameHeight, indexes, woundSheet, woundLevel),
  };
};

const addPlayerAnimations = (animations, woundBySource) => {
  const nonActionStates = [
    { state: 'walking', kind: 'motion', indexes: sequenceFrames(0, 7), frameRate: 8, loop: true, motionClass: 'locomotion' },
    { state: 'running', kind: 'run', indexes: sequenceFrames(0, 15), frameRate: 16, loop: true, motionClass: 'locomotion' },
    { state: 'idle', kind: 'motion', indexes: sequenceFrames(8, 15), frameRate: 3, loop: true, motionClass: 'ambient' },
    { state: 'sneaking', kind: 'crouch', indexes: sequenceFrames(0, 7), frameRate: 8, loop: true, motionClass: 'locomotion' },
    { state: 'crouching', kind: 'crouch', indexes: sequenceFrames(8, 15), frameRate: 2.4, loop: true, motionClass: 'ambient' },
    { state: 'laying-down', kind: 'rest', indexes: sequenceFrames(0, 5), frameRate: 6, loop: false, motionClass: 'one-shot' },
    { state: 'resting', kind: 'rest', indexes: [6, 7], frameRate: 0.8, loop: true, motionClass: 'ambient' },
    { state: 'rest-micro-ear', kind: 'rest', indexes: [6, 8, 6, 7], frameRate: 3, loop: false, motionClass: 'ambient' },
    { state: 'rest-micro-head', kind: 'rest', indexes: [6, 9, 7, 6], frameRate: 2, loop: false, motionClass: 'ambient' },
    { state: 'getting-up', kind: 'rest', indexes: sequenceFrames(10, 15), frameRate: 6, loop: false, motionClass: 'one-shot' },
  ];
  const actionStates = [
    { state: 'attacking', kind: 'action', indexes: sequenceFrames(0, 4), frameRate: 10, loop: false, motionClass: 'one-shot' },
    { state: 'eating', kind: 'action', indexes: sequenceFrames(5, 9), frameRate: 7, loop: false, motionClass: 'action' },
    { state: 'drinking', kind: 'action', indexes: sequenceFrames(10, 15), frameRate: 7, loop: false, motionClass: 'action' },
    { state: 'burying', kind: 'bury', indexes: sequenceFrames(0, 7), frameRate: 8 / 3, loop: false, motionClass: 'action' },
  ];

  for (const direction of DIRECTIONS) {
    for (const carrying of [false, true]) {
      for (const woundLevel of WOUND_LEVELS) {
        for (const state of nonActionStates) {
          const source = `wolf-${direction}-${state.kind}${carrying ? '-carry' : ''}.png`;
          animations.push(makeAnimation({
            family: 'player-wolf', subject: 'player', direction, carrying, woundLevel,
            ...state,
            asset: sourceAssetPath(source), frameWidth: 346, frameHeight: 284,
            woundSheet: woundBySource.get(source),
          }));
        }
      }
    }
    for (const woundLevel of WOUND_LEVELS) {
      for (const state of actionStates) {
        const source = `wolf-${direction}-${state.kind}.png`;
        animations.push(makeAnimation({
          family: 'player-wolf', subject: 'player', direction, woundLevel,
          ...state,
          asset: sourceAssetPath(source), frameWidth: 346, frameHeight: 284,
          woundSheet: woundBySource.get(source),
        }));
      }
    }
  }
};

const addPackAnimations = (animations) => {
  const states = [
    { state: 'pace-6', indexes: [0, 1, 2, 3], frameRate: 6, loop: true, motionClass: 'locomotion' },
    { state: 'pace-8', indexes: [0, 1, 2, 3], frameRate: 8, loop: true, motionClass: 'locomotion' },
    { state: 'pace-11', indexes: [0, 1, 2, 3], frameRate: 11, loop: true, motionClass: 'locomotion' },
    { state: 'rest', indexes: [0], frameRate: 1, loop: true, motionClass: 'static' },
    { state: 'feed', indexes: [0, 1, 0, 2], frameRate: 3, loop: true, motionClass: 'action' },
  ];
  for (const subject of ['niva', 'torr']) {
    const asset = `public/assets/${subject}-sheet.png`;
    for (const [row, direction] of PACK_DIRECTIONS.entries()) {
      for (const state of states) {
        animations.push(makeAnimation({
          family: 'pack-wolf', subject, direction, woundLevel: 0,
          ...state,
          asset, frameWidth: 346, frameHeight: 284,
          indexes: state.indexes.map((index) => row * 4 + index),
        }));
      }
    }
  }
};

const preyFrames = (directionIndex, state, contract) => {
  const settings = contract.states[state];
  if (settings.layout === 'directionRows') {
    return settings.rows.map((phase) => directionIndex * settings.rows.length + phase);
  }
  return settings.rows.map((row) => row * contract.directions.length + directionIndex);
};

const preySource = (species, state, contract) => {
  const definition = contract.species[species];
  const sheet = contract.states[state].sheet;
  if (sheet === 'retaliation') return `${definition.retaliationAsset}.png`;
  return `${species}-${sheet === 'actions' ? 'actions' : 'atlas'}.png`;
};

const preyAsset = (species, state, contract) => {
  const definition = contract.species[species];
  const sheet = contract.states[state].sheet;
  if (sheet === 'retaliation') {
    return `public/assets/${definition.retaliationAssetRoot}/${definition.retaliationAsset}.png`;
  }
  return `public/assets/${definition.assetRoot}/${species}-${sheet === 'actions' ? 'actions' : 'atlas'}.png`;
};

const addPreyAnimations = (animations, woundBySource, contract) => {
  for (const species of ['rabbit', 'deer', 'elk', 'boar']) {
    const states = ['idle', 'walk', 'flee', 'foraging', 'drinking', 'resting', 'dead'];
    if (contract.species[species].retaliationAsset) states.push('retaliating');
    const woundLevels = contract.species[species].wounds ? WOUND_LEVELS : [0];
    for (const woundLevel of woundLevels) {
      for (const [directionIndex, direction] of DIRECTIONS.entries()) {
        for (const state of states) {
          const definition = contract.states[state];
          const source = preySource(species, state, contract);
          animations.push(makeAnimation({
            family: 'prey', subject: species, state, direction, woundLevel,
            frameRate: definition.frameRate,
            loop: definition.repeat === -1,
            motionClass: definition.motionClass,
            minFrames: definition.minFrames,
            minUniquePoses: definition.minUniquePoses,
            asset: preyAsset(species, state, contract),
            frameWidth: contract.cellSize,
            frameHeight: contract.cellSize,
            indexes: preyFrames(directionIndex, state, contract),
            woundSheet: woundLevel > 0 ? woundBySource.get(source) : undefined,
          }));
        }
      }
    }
  }
};

const validateInventory = (root, animations, woundManifest) => {
  const failures = [];
  const ids = new Set();
  const referencedWoundSources = new Set();
  const dimensions = new Map();
  const imageDimensions = (path) => {
    if (dimensions.has(path)) return dimensions.get(path);
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath)) return undefined;
    const bytes = readFileSync(absolutePath);
    if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
      failures.push(`invalid PNG asset: ${path}`);
      return undefined;
    }
    const value = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    dimensions.set(path, value);
    return value;
  };
  for (const animation of animations) {
    if (ids.has(animation.id)) failures.push(`duplicate animation id: ${animation.id}`);
    ids.add(animation.id);
    if (animation.frames.length === 0) failures.push(`empty runtime sequence: ${animation.id}`);
    if (animation.minFrames !== undefined && animation.frames.length < animation.minFrames) {
      failures.push(`short runtime sequence: ${animation.id} has ${animation.frames.length}, requires ${animation.minFrames}`);
    }
    for (const frame of animation.frames) {
      const baseDimensions = imageDimensions(frame.asset);
      if (!baseDimensions) failures.push(`missing asset: ${frame.asset}`);
      else {
        const columns = Math.floor(baseDimensions.width / frame.frameWidth);
        const rows = Math.floor(baseDimensions.height / frame.frameHeight);
        const maximumPadding = animation.family === 'prey' ? 0 : 1;
        if (baseDimensions.width - columns * frame.frameWidth > maximumPadding
          || baseDimensions.height - rows * frame.frameHeight > maximumPadding) {
          failures.push(`invalid fixed-cell dimensions: ${frame.asset} is ${baseDimensions.width}x${baseDimensions.height}`);
        } else if (frame.frame < 0 || frame.frame >= columns * rows) {
          failures.push(`out-of-range frame ${frame.frame}: ${frame.asset} has ${columns * rows} cells`);
        }
      }
      if (frame.woundAsset) {
        const woundDimensions = imageDimensions(frame.woundAsset);
        if (!woundDimensions) failures.push(`missing wound asset: ${frame.woundAsset}`);
        else if (woundDimensions.width !== baseDimensions?.width
          || woundDimensions.height !== frame.woundSourceHeight * woundManifest.levels) {
          failures.push(`invalid wound atlas dimensions: ${frame.woundAsset}`);
        }
        referencedWoundSources.add(frame.asset.split('/').at(-1));
      }
    }
  }
  const manifestSources = woundManifest.spritesheets.map(({ source }) => source).sort();
  const unusedWoundSources = manifestSources.filter((source) => !referencedWoundSources.has(source));
  if (unusedWoundSources.length > 0) failures.push(`unreviewed wound sources: ${unusedWoundSources.join(', ')}`);
  if (failures.length > 0) throw new Error(`Invalid animation inventory:\n${failures.join('\n')}`);
};

export const buildInventory = (root = DEFAULT_ROOT) => {
  const preyAnimationContract = readPreyAnimationContract(root);
  const woundManifest = readWoundManifest(root);
  const woundBySource = new Map(woundManifest.spritesheets.map((sheet) => [sheet.source, sheet]));
  const animations = [];
  addPlayerAnimations(animations, woundBySource);
  addPackAnimations(animations);
  addPreyAnimations(animations, woundBySource, preyAnimationContract);
  animations.sort((left, right) => left.id.localeCompare(right.id));
  validateInventory(root, animations, woundManifest);

  const baseAssets = new Set();
  const woundAssets = new Set();
  for (const animation of animations) {
    for (const frame of animation.frames) {
      baseAssets.add(frame.asset);
      if (frame.woundAsset) woundAssets.add(frame.woundAsset);
    }
  }
  const countsByFamily = Object.fromEntries([...new Set(animations.map(({ family }) => family))]
    .sort()
    .map((family) => [family, animations.filter((animation) => animation.family === family).length]));
  const countsBySubject = Object.fromEntries([...new Set(animations.map(({ subject }) => subject))]
    .sort()
    .map((subject) => [subject, animations.filter((animation) => animation.subject === subject).length]));
  return {
    schemaVersion: 1,
    animations,
    coverage: {
      animations: animations.length,
      baseAssets: [...baseAssets].sort(),
      woundAssets: [...woundAssets].sort(),
      woundManifestSources: woundManifest.spritesheets.map(({ source }) => source).sort(),
      directions: [...DIRECTIONS],
      woundLevels: [...WOUND_LEVELS],
      countsByFamily,
      countsBySubject,
    },
  };
};

class PngCache {
  constructor(root, maxBytes = 96 * 1024 * 1024) {
    this.root = root;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
  }

  get(path) {
    if (this.entries.has(path)) {
      const value = this.entries.get(path);
      this.entries.delete(path);
      this.entries.set(path, value);
      return value.image;
    }
    const image = PNG.sync.read(readFileSync(resolve(this.root, path)));
    const size = image.data.byteLength;
    while (this.bytes + size > this.maxBytes && this.entries.size > 0) {
      const [oldestPath, oldest] = this.entries.entries().next().value;
      this.entries.delete(oldestPath);
      this.bytes -= oldest.size;
    }
    this.entries.set(path, { image, size });
    this.bytes += size;
    return image;
  }
}

const compositePixel = (base, overlay, baseOffset, overlayOffset, output, outputOffset) => {
  const baseAlpha = base[baseOffset + 3] / 255;
  const overlayAlpha = overlay ? overlay[overlayOffset + 3] / 255 : 0;
  const outputAlpha = overlayAlpha + baseAlpha * (1 - overlayAlpha);
  if (outputAlpha <= 0) {
    output[outputOffset] = 0;
    output[outputOffset + 1] = 0;
    output[outputOffset + 2] = 0;
    output[outputOffset + 3] = 0;
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const premultiplied = (overlay ? overlay[overlayOffset + channel] : 0) * overlayAlpha
      + base[baseOffset + channel] * baseAlpha * (1 - overlayAlpha);
    output[outputOffset + channel] = Math.round(premultiplied / outputAlpha);
  }
  output[outputOffset + 3] = Math.round(outputAlpha * 255);
};

const extractFrame = (cache, ref) => {
  const source = cache.get(ref.asset);
  const columns = Math.floor(source.width / ref.frameWidth);
  const sourceX = (ref.frame % columns) * ref.frameWidth;
  const sourceY = Math.floor(ref.frame / columns) * ref.frameHeight;
  if (sourceX + ref.frameWidth > source.width || sourceY + ref.frameHeight > source.height) {
    throw new Error(`Frame ${ref.frame} falls outside ${ref.asset}`);
  }
  const wound = ref.woundAsset ? cache.get(ref.woundAsset) : undefined;
  const woundLevelOffset = wound ? (ref.woundLevel - 1) * ref.woundSourceHeight : 0;
  const data = Buffer.allocUnsafe(ref.frameWidth * ref.frameHeight * 4);
  for (let y = 0; y < ref.frameHeight; y += 1) {
    for (let x = 0; x < ref.frameWidth; x += 1) {
      const sourceOffset = (((sourceY + y) * source.width) + sourceX + x) * 4;
      const outputOffset = (y * ref.frameWidth + x) * 4;
      const woundOffset = wound
        ? ((((woundLevelOffset + sourceY + y) * wound.width) + sourceX + x) * 4)
        : 0;
      compositePixel(source.data, wound?.data, sourceOffset, woundOffset, data, outputOffset);
    }
  }
  return { width: ref.frameWidth, height: ref.frameHeight, data };
};

const inspectFrame = (image) => {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let alphaWeight = 0;
  let alphaX = 0;
  let alphaY = 0;
  let corePixels = 0;
  let coreX = 0;
  let coreY = 0;
  let coreXX = 0;
  let coreYY = 0;
  let coreXY = 0;
  const signal = Buffer.allocUnsafe(image.width * image.height * 2);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const signalOffset = (y * image.width + x) * 2;
      const alpha = image.data[offset + 3];
      const luma = Math.round((image.data[offset] * 54 + image.data[offset + 1] * 183 + image.data[offset + 2] * 19) / 256);
      signal[signalOffset] = alpha;
      signal[signalOffset + 1] = Math.round(luma * alpha / 255);
      if (alpha <= ALPHA_THRESHOLD) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      alphaWeight += alpha;
      alphaX += x * alpha;
      alphaY += y * alpha;
      if (alpha >= CORE_ALPHA_THRESHOLD) {
        corePixels += 1;
        coreX += x;
        coreY += y;
        coreXX += x * x;
        coreYY += y * y;
        coreXY += x * y;
      }
    }
  }
  if (visiblePixels === 0) {
    return {
      empty: true,
      bbox: { x: 0, y: 0, width: 0, height: 0, area: 0 },
      visiblePixels: 0,
      alphaCentroid: { x: 0, y: 0 },
      coreCentroid: { x: 0, y: 0 },
      bodyScale: 0,
      groundContact: { x: 0, y: 0 },
      signal,
      hash: createHash('sha256').update(signal).digest('hex'),
    };
  }
  let groundPixels = 0;
  let groundX = 0;
  for (let y = Math.max(minY, maxY - 2); y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
      groundPixels += 1;
      groundX += x;
    }
  }
  const alphaCentroid = { x: alphaX / alphaWeight, y: alphaY / alphaWeight };
  const coreCentroid = corePixels > 0 ? { x: coreX / corePixels, y: coreY / corePixels } : alphaCentroid;
  const coreVarianceX = corePixels > 0 ? Math.max(0, coreXX / corePixels - coreCentroid.x ** 2) : 0;
  const coreVarianceY = corePixels > 0 ? Math.max(0, coreYY / corePixels - coreCentroid.y ** 2) : 0;
  const coreCovariance = corePixels > 0 ? coreXY / corePixels - coreCentroid.x * coreCentroid.y : 0;
  const coreTrace = coreVarianceX + coreVarianceY;
  const coreDiscriminant = Math.sqrt(Math.max(0, (coreVarianceX - coreVarianceY) ** 2 + 4 * coreCovariance ** 2));
  return {
    empty: false,
    bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area: (maxX - minX + 1) * (maxY - minY + 1) },
    visiblePixels,
    alphaCentroid,
    coreCentroid,
    // The minor axis of the opaque core is a pose-tolerant scale proxy: a
    // lowered head may lengthen a quadruped, but should not thicken its torso.
    bodyScale: Math.sqrt(Math.max(0, (coreTrace - coreDiscriminant) / 2)),
    groundContact: { x: groundPixels > 0 ? groundX / groundPixels : alphaCentroid.x, y: maxY },
    signal,
    hash: createHash('sha256').update(signal).digest('hex'),
  };
};

const compareFrames = (left, right) => {
  let union = 0;
  let intersection = 0;
  let visualDifference = 0;
  let alphaDifference = 0;
  for (let offset = 0; offset < left.signal.length; offset += 2) {
    const leftAlpha = left.signal[offset];
    const rightAlpha = right.signal[offset];
    const leftVisible = leftAlpha > ALPHA_THRESHOLD;
    const rightVisible = rightAlpha > ALPHA_THRESHOLD;
    if (leftVisible || rightVisible) union += 1;
    if (leftVisible && rightVisible) intersection += 1;
    if (!leftVisible && !rightVisible) continue;
    alphaDifference += Math.abs(leftAlpha - rightAlpha) / 255;
    visualDifference += (
      Math.abs(leftAlpha - rightAlpha) / 255
      + Math.abs(left.signal[offset + 1] - right.signal[offset + 1]) / 255
    ) / 2;
  }
  return {
    alphaDelta: union > 0 ? alphaDifference / union : 0,
    visualDelta: union > 0 ? visualDifference / union : 0,
    silhouetteIou: union > 0 ? intersection / union : 1,
  };
};

const issue = (severity, metric, value, threshold, message) => ({
  severity, metric, value: round(value), threshold, message,
});

const evaluateHighMetric = (issues, name, value, message, hardFailure = true) => {
  if (hardFailure && value > THRESHOLDS.hard[name]) issues.push(issue('fail', name, value, THRESHOLDS.hard[name], message));
  else if (value > THRESHOLDS.warning[name]) issues.push(issue('warn', name, value, THRESHOLDS.warning[name], message));
};

const evaluateLowMetric = (issues, name, value, message) => {
  if (value < THRESHOLDS.hard[name]) issues.push(issue('fail', name, value, THRESHOLDS.hard[name], message));
  else if (value < THRESHOLDS.warning[name]) issues.push(issue('warn', name, value, THRESHOLDS.warning[name], message));
};

const analyzeAnimation = (animation, cache) => {
  const inspected = animation.frames.map((frame) => inspectFrame(extractFrame(cache, frame)));
  const widths = inspected.map(({ bbox }) => bbox.width);
  const heights = inspected.map(({ bbox }) => bbox.height);
  const bboxAreas = inspected.map(({ bbox }) => bbox.area);
  const alphaAreas = inspected.map(({ visiblePixels }) => visiblePixels);
  const medianWidth = median(widths);
  const medianHeight = median(heights);
  const transitions = inspected.slice(1).map((frame, index) => compareFrames(inspected[index], frame));
  const seam = inspected.length > 1 ? compareFrames(inspected.at(-1), inspected[0]) : undefined;
  const semanticMotionScore = median(transitions.map(({ visualDelta }) => visualDelta));
  const transitionBaseline = Math.max(semanticMotionScore, 0.005);
  const uniquePoses = new Set(inspected.map(({ hash }) => hash)).size;
  const uniquePoseRatio = uniquePoses / inspected.length;
  const metrics = {
    alphaAnchorXRange: normalizedRange(inspected.map(({ alphaCentroid }) => alphaCentroid.x), medianWidth),
    alphaAnchorYRange: normalizedRange(inspected.map(({ alphaCentroid }) => alphaCentroid.y), medianHeight),
    coreAnchorXRange: normalizedRange(inspected.map(({ coreCentroid }) => coreCentroid.x), medianWidth),
    coreAnchorYRange: normalizedRange(inspected.map(({ coreCentroid }) => coreCentroid.y), medianHeight),
    groundContactXRange: normalizedRange(inspected.map(({ groundContact }) => groundContact.x), medianWidth),
    groundContactYRange: normalizedRange(inspected.map(({ groundContact }) => groundContact.y), medianHeight),
    bboxWidthPulse: pulse(widths),
    bboxHeightPulse: pulse(heights),
    bboxAreaPulse: pulse(bboxAreas),
    alphaAreaPulse: pulse(alphaAreas),
    semanticMotionScore,
    meanTransitionDelta: transitions.length > 0
      ? transitions.reduce((sum, transition) => sum + transition.visualDelta, 0) / transitions.length
      : 0,
    minimumTransitionDelta: transitions.length > 0 ? Math.min(...transitions.map(({ visualDelta }) => visualDelta)) : 0,
    nearDuplicateTransitions: transitions.filter(({ visualDelta }) => visualDelta < 0.012).length,
    duplicateTransitions: inspected.slice(1).filter((frame, index) => frame.hash === inspected[index].hash).length,
    uniquePoses,
    uniquePoseRatio,
    loopSeamDelta: seam?.visualDelta ?? 0,
    loopSeamAlphaDelta: seam?.alphaDelta ?? 0,
    loopSeamSilhouetteIou: seam?.silhouetteIou ?? 1,
    loopSeamRatio: animation.loop && seam ? seam.visualDelta / transitionBaseline : 0,
  };
  for (const [name, value] of Object.entries(metrics)) metrics[name] = round(value);

  const issues = [];
  inspected.forEach((frame, index) => {
    if (frame.empty) issues.push(issue('fail', 'emptyFrame', index, 0, `Runtime frame ${index} is empty.`));
  });
  // Locomotion and ambient loops should remain registered in place. Large
  // centroid/bounds changes are expected during attacks, lying down, feeding,
  // drinking, and other authored actions, so those values remain visible as
  // curation warnings but cannot become false-positive hard failures.
  const registrationMustBeStable = animation.motionClass === 'locomotion' || animation.motionClass === 'ambient';
  const contactMustBeStable = animation.motionClass === 'ambient';
  evaluateHighMetric(issues, 'alphaAnchorRange', Math.max(metrics.alphaAnchorXRange, metrics.alphaAnchorYRange), 'Alpha-weighted body center drifts across the cycle.', registrationMustBeStable);
  evaluateHighMetric(issues, 'coreAnchorRange', Math.max(metrics.coreAnchorXRange, metrics.coreAnchorYRange), 'Opaque body core drifts across the cycle.', registrationMustBeStable);
  evaluateHighMetric(issues, 'groundContactYRange', metrics.groundContactYRange, 'Lowest contact line moves vertically and may cause visible bobbing.', contactMustBeStable);
  evaluateHighMetric(issues, 'bboxDimensionPulse', Math.max(metrics.bboxWidthPulse, metrics.bboxHeightPulse), 'Visible frame bounds change size abruptly.', contactMustBeStable);
  evaluateHighMetric(issues, 'bboxAreaPulse', metrics.bboxAreaPulse, 'Visible bounding-box area pulses across frames.', contactMustBeStable);
  evaluateHighMetric(issues, 'alphaAreaPulse', metrics.alphaAreaPulse, 'Visible silhouette area pulses across frames.', contactMustBeStable);
  if (animation.loop && animation.frames.length > 2
      && metrics.loopSeamDelta > THRESHOLDS.warning.loopSeamDelta) {
    evaluateHighMetric(issues, 'loopSeamRatio', metrics.loopSeamRatio, 'Last-to-first loop transition is harsher than the internal cadence.');
  }
  const expectsMotion = animation.motionClass !== 'static';
  if (expectsMotion && animation.frames.length > 1) {
    evaluateLowMetric(issues, 'uniquePoseRatio', metrics.uniquePoseRatio, 'Too few distinct rendered poses for the runtime sequence.');
    evaluateLowMetric(issues, 'semanticMotionScore', metrics.semanticMotionScore, 'Pose-to-pose visual change is too small to read as the named action.');
  }
  if (animation.minUniquePoses !== undefined && uniquePoses < animation.minUniquePoses) {
    issues.push(issue(
      'fail',
      'requiredUniquePoses',
      uniquePoses,
      animation.minUniquePoses,
      `Runtime contract requires at least ${animation.minUniquePoses} unique poses.`,
    ));
  }
  issues.sort((left, right) => `${left.severity}/${left.metric}`.localeCompare(`${right.severity}/${right.metric}`));
  const status = issues.some(({ severity }) => severity === 'fail')
    ? 'fail'
    : issues.some(({ severity }) => severity === 'warn') ? 'warn' : 'pass';
  return {
    ...animation,
    status,
    metrics,
    issues,
    frameGeometry: inspected.map(({ bbox, visiblePixels, alphaCentroid, coreCentroid, bodyScale, groundContact }) => ({
      bbox,
      visiblePixels,
      alphaCentroid: { x: round(alphaCentroid.x), y: round(alphaCentroid.y) },
      coreCentroid: { x: round(coreCentroid.x), y: round(coreCentroid.y) },
      bodyScale: round(bodyScale),
      groundContact: { x: round(groundContact.x), y: round(groundContact.y) },
    })),
  };
};

const summarizeInventory = (inventory) => ({
  ...inventory.coverage,
  animationsByState: Object.fromEntries([...new Set(inventory.animations.map(({ state }) => state))]
    .sort()
    .map((state) => [state, inventory.animations.filter((animation) => animation.state === state).length])),
  animationIds: inventory.animations.map(({ id }) => id),
});

const symmetricRatio = (left, right) => {
  if (left <= 0 || right <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(left / right, right / left);
};

const representativeFrames = (from, to) => [
  from.frames[0],
  to.frames[0],
  from.frames.at(-1),
  to.frames.at(-1),
];

const scaleSensitiveStates = Object.freeze({
  'player-wolf': new Set(['attacking', 'eating', 'drinking']),
  'pack-wolf': new Set(['rest', 'feed']),
  prey: new Set(['resting', 'foraging', 'drinking']),
});

const transitionBaselineState = (family) => family === 'pack-wolf' ? 'pace-6' : 'idle';

const buildStateTransitions = (animations) => {
  const variants = new Map();
  for (const animation of animations) {
    const key = [animation.family, animation.subject, animation.direction, animation.carrying, animation.woundLevel].join('/');
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(animation);
  }

  const transitions = [];
  for (const variant of variants.values()) {
    const family = variant[0].family;
    const baseline = variant.find(({ state }) => state === transitionBaselineState(family));
    if (!baseline) continue;
    const fromVisibleArea = median(baseline.frameGeometry.map(({ visiblePixels }) => visiblePixels));
    const fromBodyScale = median(baseline.frameGeometry.map(({ bodyScale }) => bodyScale));
    const fromGround = median(baseline.frameGeometry.map(({ groundContact }) => groundContact.y));
    for (const target of variant) {
      if (target === baseline) continue;
      const toVisibleArea = median(target.frameGeometry.map(({ visiblePixels }) => visiblePixels));
      const toBodyScale = median(target.frameGeometry.map(({ bodyScale }) => bodyScale));
      const toGround = median(target.frameGeometry.map(({ groundContact }) => groundContact.y));
      const visibleAreaRatio = symmetricRatio(fromVisibleArea, toVisibleArea);
      const linearScaleRatio = Math.sqrt(visibleAreaRatio);
      const sensitive = scaleSensitiveStates[family]?.has(target.state) ?? false;
      const issues = [];
      if (sensitive && linearScaleRatio > STATE_TRANSITION_THRESHOLDS.hardLinearScaleRatio) {
        issues.push(issue(
          'fail',
          'linearScaleRatio',
          linearScaleRatio,
          STATE_TRANSITION_THRESHOLDS.hardLinearScaleRatio,
          'Alternating states change the apparent anatomical scale.',
        ));
      } else if (sensitive && linearScaleRatio > STATE_TRANSITION_THRESHOLDS.warningLinearScaleRatio) {
        issues.push(issue(
          'warn',
          'linearScaleRatio',
          linearScaleRatio,
          STATE_TRANSITION_THRESHOLDS.warningLinearScaleRatio,
          'Alternating states may show a subtle apparent scale change.',
        ));
      }
      const status = issues.some(({ severity }) => severity === 'fail')
        ? 'fail'
        : issues.some(({ severity }) => severity === 'warn') ? 'warn' : 'pass';
      transitions.push({
        id: ['state-transition', family, target.subject, `${baseline.state}-to-${target.state}`, target.direction, target.carrying ? 'carry' : 'plain', `wound-${target.woundLevel}`].join('/'),
        family,
        subject: target.subject,
        direction: target.direction,
        carrying: target.carrying,
        woundLevel: target.woundLevel,
        fromState: baseline.state,
        toState: target.state,
        scaleSensitive: sensitive,
        status,
        metrics: {
          fromMedianVisiblePixels: round(fromVisibleArea),
          toMedianVisiblePixels: round(toVisibleArea),
          visibleAreaRatio: round(visibleAreaRatio),
          linearScaleRatio: round(linearScaleRatio),
          bodyScaleRatio: round(symmetricRatio(fromBodyScale, toBodyScale)),
          medianGroundContactDeltaPx: round(Math.abs(fromGround - toGround)),
        },
        issues,
        sequenceStates: [baseline.state, target.state, baseline.state, target.state],
        frames: representativeFrames(baseline, target),
      });
    }
  }
  transitions.sort((left, right) => left.id.localeCompare(right.id));
  return transitions;
};

export const runAudit = ({ root = DEFAULT_ROOT, families } = {}) => {
  const preyAnimationContract = readPreyAnimationContract(root);
  const inventory = buildInventory(root);
  const selected = families?.length
    ? inventory.animations.filter(({ family, subject }) => families.includes(family) || families.includes(subject))
    : inventory.animations;
  const cache = new PngCache(root);
  const analysisOrder = [...selected].sort((left, right) => {
    const leftKey = `${left.frames[0].asset}/${left.woundLevel}/${left.id}`;
    const rightKey = `${right.frames[0].asset}/${right.woundLevel}/${right.id}`;
    return leftKey.localeCompare(rightKey);
  });
  const analyzed = analysisOrder.map((animation) => analyzeAnimation(animation, cache));
  analyzed.sort((left, right) => left.id.localeCompare(right.id));
  const idleByVariant = new Map(analyzed
    .filter(({ family, state }) => family === 'prey' && state === 'idle')
    .map((animation) => [
      `${animation.subject}/${animation.direction}/${animation.woundLevel}`,
      animation,
    ]));
  const groundedTransitionStates = new Set(['resting', 'foraging', 'drinking', 'retaliating']);
  for (const animation of analyzed) {
    if (animation.family !== 'prey' || !groundedTransitionStates.has(animation.state)) continue;
    const idle = idleByVariant.get(`${animation.subject}/${animation.direction}/${animation.woundLevel}`);
    if (!idle) continue;
    // Idle may be interrupted on either authored breathing phase. Needs and
    // threats can interrupt looping actions on any rendered phase, while
    // retaliation is locked until its one-shot animation completes.
    const transitionFrames = animation.state === 'retaliating'
      ? [animation.frameGeometry[0], animation.frameGeometry.at(-1)]
      : animation.frameGeometry;
    const transitionDeltas = idle.frameGeometry.flatMap((idleFrame) => transitionFrames.map((actionFrame) => (
      Math.abs(actionFrame.groundContact.y - idleFrame.groundContact.y)
    )));
    const maximumDelta = Math.max(...transitionDeltas);
    animation.metrics.idleTransitionGroundDeltaPx = round(maximumDelta);
    animation.metrics.idleTransitionComparisons = transitionDeltas.length;
    if (maximumDelta > preyAnimationContract.transitionLimits.groundContactY) {
      animation.issues.push(issue(
        'fail',
        'idleTransitionGroundDeltaPx',
        maximumDelta,
        preyAnimationContract.transitionLimits.groundContactY,
        'An action phase ground line does not match every same-direction idle phase.',
      ));
      animation.issues.sort((left, right) => `${left.severity}/${left.metric}`.localeCompare(`${right.severity}/${right.metric}`));
      animation.status = 'fail';
    }
  }
  const flattenIssues = (severity) => analyzed.flatMap((animation) => animation.issues
    .filter((entry) => entry.severity === severity)
    .map((entry) => ({ animationId: animation.id, ...entry })))
    .sort((left, right) => `${left.animationId}/${left.metric}`.localeCompare(`${right.animationId}/${right.metric}`));
  const hardFailures = flattenIssues('fail');
  const warnings = flattenIssues('warn');
  const stateTransitions = buildStateTransitions(analyzed);
  const stateTransitionHardFailures = stateTransitions.flatMap((transition) => transition.issues
    .filter(({ severity }) => severity === 'fail')
    .map((entry) => ({ transitionId: transition.id, ...entry })));
  const stateTransitionWarnings = stateTransitions.flatMap((transition) => transition.issues
    .filter(({ severity }) => severity === 'warn')
    .map((entry) => ({ transitionId: transition.id, ...entry })));
  return {
    schemaVersion: 2,
    contract: {
      runtime: 'Phaser 3.90 fixed-cell spritesheets and numeric frame sequences',
      alphaThreshold: ALPHA_THRESHOLD,
      coreAlphaThreshold: CORE_ALPHA_THRESHOLD,
      anchor: 'untrimmed fixed cell; alpha/core centroid plus lowest visible contact line',
      preyGroundTransitionLimitPx: preyAnimationContract.transitionLimits.groundContactY,
      preyGroundTransitionCoverage: 'all idle phases x all interruptible action phases; retaliation endpoints only',
      alternatingStateCoverage: 'every runtime state alternated against same-subject, same-direction, same-carry, same-wound idle (pack wolves use pace-6)',
      reportOrder: 'stable animation id; no wall-clock fields',
    },
    thresholds: THRESHOLDS,
    stateTransitionThresholds: STATE_TRANSITION_THRESHOLDS,
    inventory: summarizeInventory(inventory),
    selection: families?.length ? [...families].sort() : ['all'],
    summary: {
      animations: analyzed.length,
      framesPlayed: analyzed.reduce((sum, animation) => sum + animation.frames.length, 0),
      passing: analyzed.filter(({ status }) => status === 'pass').length,
      warnings: analyzed.filter(({ status }) => status === 'warn').length,
      failing: analyzed.filter(({ status }) => status === 'fail').length,
      hardFailureMetrics: hardFailures.length,
      warningMetrics: warnings.length,
      stateTransitions: stateTransitions.length,
      stateTransitionPassing: stateTransitions.filter(({ status }) => status === 'pass').length,
      stateTransitionWarnings: stateTransitions.filter(({ status }) => status === 'warn').length,
      stateTransitionFailing: stateTransitions.filter(({ status }) => status === 'fail').length,
    },
    hardFailures,
    warnings,
    stateTransitionHardFailures,
    stateTransitionWarnings,
    stateTransitions,
    animations: analyzed,
    limitations: [
      'Image metrics flag likely registration, pulsing, duplicate-pose, and loop-seam defects; they cannot prove anatomical correctness or that a gait semantically reads as walking.',
      'Ground contact is the lowest non-transparent pixel, so a baked shadow, tail, carried carcass, dirt, or extended limb can influence that metric.',
      'Only wound variants supported by the current runtime are composited: player wolf, deer, elk, and boar levels 1-3. Rabbit, Niva, and Torr expose healthy art only.',
      'The inventory is an explicit mirror of WildScene animation creation and should be updated with any runtime frame-contract change.',
      'Alternating-state scale gates apply only to equivalent full-body states; crouching, locomotion, lying down, burial effects, retaliation, and death remain visual-review-only because pose or VFX legitimately changes silhouette area.',
    ],
  };
};

const collectReviewAssets = (report) => {
  const specs = new Map();
  for (const animation of report.animations) {
    for (const frame of animation.frames) {
      specs.set(frame.asset, { frameWidth: frame.frameWidth, frameHeight: frame.frameHeight, wound: false });
      if (frame.woundAsset) specs.set(frame.woundAsset, {
        frameWidth: frame.frameWidth,
        frameHeight: frame.frameHeight,
        wound: true,
        sourceHeight: frame.woundSourceHeight,
      });
    }
  }
  return specs;
};

const makeReviewProxy = (image, spec, scale) => {
  const sourceColumns = Math.floor(image.width / spec.frameWidth);
  const sourceRows = Math.floor(image.height / spec.frameHeight);
  const targetCellWidth = Math.max(1, Math.round(spec.frameWidth * scale));
  const targetCellHeight = Math.max(1, Math.round(spec.frameHeight * scale));
  const output = new PNG({
    width: sourceColumns * targetCellWidth,
    height: sourceRows * targetCellHeight,
    colorType: 6,
  });
  for (let row = 0; row < sourceRows; row += 1) {
    for (let column = 0; column < sourceColumns; column += 1) {
      for (let y = 0; y < targetCellHeight; y += 1) {
        const sourceY = row * spec.frameHeight + Math.min(spec.frameHeight - 1, Math.floor(y * spec.frameHeight / targetCellHeight));
        for (let x = 0; x < targetCellWidth; x += 1) {
          const sourceX = column * spec.frameWidth + Math.min(spec.frameWidth - 1, Math.floor(x * spec.frameWidth / targetCellWidth));
          const sourceOffset = (sourceY * image.width + sourceX) * 4;
          const outputOffset = (((row * targetCellHeight + y) * output.width) + column * targetCellWidth + x) * 4;
          image.data.copy(output.data, outputOffset, sourceOffset, sourceOffset + 4);
        }
      }
    }
  }
  return {
    data: `data:image/png;base64,${PNG.sync.write(output, { colorType: 6 }).toString('base64')}`,
    cellWidth: targetCellWidth,
    cellHeight: targetCellHeight,
    columns: sourceColumns,
    rows: sourceRows,
    wound: spec.wound,
    sourceRows: spec.sourceHeight ? Math.floor(spec.sourceHeight / spec.frameHeight) : sourceRows,
  };
};

const escapeScriptJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

const buildHtml = (root, report, reviewScale) => {
  const specs = collectReviewAssets(report);
  const proxies = {};
  for (const [path, spec] of [...specs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    proxies[path] = makeReviewProxy(PNG.sync.read(readFileSync(resolve(root, path))), spec, reviewScale);
  }
  const reportJson = escapeScriptJson(report);
  const proxyJson = escapeScriptJson(proxies);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wildbound animal animation lab</title>
<style>
:root{color-scheme:dark;--bg:#0c1210;--panel:#151e19;--ink:#e8f0e9;--muted:#9eada2;--line:#304138;--pass:#62ce86;--warn:#f2bb55;--fail:#ff6b69}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#0b100e,#111a15);color:var(--ink);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}header{position:sticky;top:0;z-index:3;padding:16px 20px;background:#0c1210ee;border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}h1{font:700 22px/1.1 system-ui;margin:0 0 9px}.summary{display:flex;flex-wrap:wrap;gap:8px}.pill{padding:3px 8px;border:1px solid var(--line);border-radius:999px}.pass{color:var(--pass)}.warn{color:var(--warn)}.fail{color:var(--fail)}.controls{display:grid;grid-template-columns:minmax(220px,1fr) repeat(4,minmax(120px,auto));gap:8px;margin-top:12px}input,select{width:100%;border:1px solid var(--line);border-radius:6px;background:#111a15;color:var(--ink);padding:8px}main{padding:18px 20px}.notes{max-width:1100px;color:var(--muted);margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--pass);border-radius:8px;padding:10px;min-width:0}.card.warn{border-left-color:var(--warn);color:var(--ink)}.card.fail{border-left-color:var(--fail);color:var(--ink)}.card h2{font-size:13px;margin:0 0 5px;overflow-wrap:anywhere}.meta,.metrics{color:var(--muted);font-size:11px}.stage{display:flex;align-items:center;gap:10px;margin:8px 0}.checker{background-color:#d0d0c8;background-image:linear-gradient(45deg,#999 25%,transparent 25%),linear-gradient(-45deg,#999 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#999 75%),linear-gradient(-45deg,transparent 75%,#999 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;border:1px solid #4d5d53}.animation{max-width:180px;max-height:150px;width:auto;height:auto;image-rendering:auto}.contact{display:block;max-width:100%;height:auto;max-height:150px;overflow:auto}.issues{margin:6px 0 0;padding-left:18px;font-size:11px}.issues li{margin:2px 0}.hidden{display:none!important}@media(max-width:760px){.controls{grid-template-columns:1fr 1fr}.controls input{grid-column:1/-1}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>Wildbound animal animation lab</h1>
  <div class="summary"><span class="pill">${report.summary.animations} cycles</span><span class="pill">${report.summary.framesPlayed} runtime frames</span><span class="pill">${report.summary.stateTransitions} alternating transitions</span><span class="pill pass">${report.summary.passing} cycle pass</span><span class="pill warn">${report.summary.warnings} cycle warn</span><span class="pill fail">${report.summary.failing} cycle fail</span><span class="pill pass">${report.summary.stateTransitionPassing} transition pass</span><span class="pill warn">${report.summary.stateTransitionWarnings} transition warn</span><span class="pill fail">${report.summary.stateTransitionFailing} transition fail</span></div>
  <div class="controls"><input id="search" placeholder="Filter subject, state, direction…"><select id="view"><option value="transition">alternating states</option><option value="cycle">animation cycles</option><option value="">both views</option></select><select id="family"><option value="">all families</option></select><select id="status"><option value="">all statuses</option><option>fail</option><option>warn</option><option>pass</option></select><select id="wound"><option value="">all wounds</option><option value="0">healthy</option><option value="1">wound 1</option><option value="2">wound 2</option><option value="3">wound 3</option></select></div>
</header>
<main>
  <p class="notes">Alternating-state canvases switch between the baseline and target state at one shared display size; animation-cycle canvases play exact runtime order and cadence. Contact strips expose the compared endpoints. Orange is a sensitive curation warning; red crosses a tolerant hard limit. Metrics cannot judge anatomy or action meaning, so visually confirm gait, action recovery, silhouette identity, and intentional pose compression.</p>
  <div id="grid" class="grid"></div>
</main>
<script type="application/json" id="report">${reportJson}</script>
<script type="application/json" id="proxies">${proxyJson}</script>
<script>
const report=JSON.parse(document.querySelector('#report').textContent);const proxies=JSON.parse(document.querySelector('#proxies').textContent);const imageCache=new Map();const active=new Set();
const imageFor=(path)=>{if(imageCache.has(path))return imageCache.get(path);const image=new Image();image.src=proxies[path].data;imageCache.set(path,image);return image};
const ready=(image)=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true})});
function drawFrame(canvas,animation,index){const ref=animation.frames[index];const proxy=proxies[ref.asset];const image=imageFor(ref.asset);const column=ref.frame%proxy.columns;const row=Math.floor(ref.frame/proxy.columns);canvas.width=proxy.cellWidth;canvas.height=proxy.cellHeight;const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=false;context.drawImage(image,column*proxy.cellWidth,row*proxy.cellHeight,proxy.cellWidth,proxy.cellHeight,0,0,canvas.width,canvas.height);if(ref.woundAsset){const woundProxy=proxies[ref.woundAsset];const wound=imageFor(ref.woundAsset);const woundRow=(ref.woundLevel-1)*woundProxy.sourceRows+row;context.drawImage(wound,column*woundProxy.cellWidth,woundRow*woundProxy.cellHeight,woundProxy.cellWidth,woundProxy.cellHeight,0,0,canvas.width,canvas.height)}}
async function renderCard(card,animation){const allPaths=[...new Set(animation.frames.flatMap(frame=>[frame.asset,frame.woundAsset].filter(Boolean)))];await Promise.all(allPaths.map(path=>ready(imageFor(path))));const animationCanvas=card.querySelector('.animation');const contact=card.querySelector('.contact');const first=proxies[animation.frames[0].asset];contact.width=first.cellWidth*animation.frames.length;contact.height=first.cellHeight;const context=contact.getContext('2d');context.imageSmoothingEnabled=false;animation.frames.forEach((frame,index)=>{const scratch=document.createElement('canvas');drawFrame(scratch,animation,index);context.drawImage(scratch,index*first.cellWidth,0)});drawFrame(animationCanvas,animation,0);card.dataset.ready='1'}
const familySelect=document.querySelector('#family');[...new Set(report.animations.map(item=>item.family))].forEach(value=>familySelect.add(new Option(value,value)));
const grid=document.querySelector('#grid');for(const animation of report.animations){const card=document.createElement('article');card.className='card '+animation.status;card.dataset.view='cycle';card.dataset.search=[animation.id,animation.subject,animation.state,animation.direction].join(' ').toLowerCase();card.dataset.family=animation.family;card.dataset.status=animation.status;card.dataset.wound=String(animation.woundLevel);card.innerHTML='<h2>'+animation.id+'</h2><div class="meta">'+animation.frameRate+' fps · '+(animation.loop?'loop':'one-shot')+' · '+animation.frames.length+' frames</div><div class="stage"><canvas class="animation checker"></canvas><canvas class="contact checker"></canvas></div><div class="metrics">anchor α '+animation.metrics.alphaAnchorXRange+'/'+animation.metrics.alphaAnchorYRange+' · core '+animation.metrics.coreAnchorXRange+'/'+animation.metrics.coreAnchorYRange+' · area pulse '+animation.metrics.alphaAreaPulse+' · seam ×'+animation.metrics.loopSeamRatio+' · motion '+animation.metrics.semanticMotionScore+'</div>'+(animation.issues.length?'<ul class="issues">'+animation.issues.map(entry=>'<li class="'+entry.severity+'">'+entry.metric+': '+entry.value+' (limit '+entry.threshold+')</li>').join('')+'</ul>':'');grid.append(card);card._animation=animation}
for(const transition of report.stateTransitions){const card=document.createElement('article');card.className='card '+transition.status;card.dataset.view='transition';card.dataset.search=[transition.id,transition.subject,transition.fromState,transition.toState,transition.direction].join(' ').toLowerCase();card.dataset.family=transition.family;card.dataset.status=transition.status;card.dataset.wound=String(transition.woundLevel);card.innerHTML='<h2>'+transition.id+'</h2><div class="meta">2 fps alternation · '+(transition.scaleSensitive?'scale-gated':'visual review')+' · '+transition.frames.length+' endpoints</div><div class="stage"><canvas class="animation checker"></canvas><canvas class="contact checker"></canvas></div><div class="metrics">linear scale ×'+transition.metrics.linearScaleRatio+' · area ×'+transition.metrics.visibleAreaRatio+' · core minor axis ×'+transition.metrics.bodyScaleRatio+' · ground Δ'+transition.metrics.medianGroundContactDeltaPx+'px</div>'+(transition.issues.length?'<ul class="issues">'+transition.issues.map(entry=>'<li class="'+entry.severity+'">'+entry.metric+': '+entry.value+' (limit '+entry.threshold+')</li>').join('')+'</ul>':'');grid.append(card);card._animation={frames:transition.frames,frameRate:2,loop:true}}
const observer=new IntersectionObserver(entries=>entries.forEach(async entry=>{const card=entry.target;if(entry.isIntersecting){active.add(card);if(!card.dataset.ready)await renderCard(card,card._animation)}else active.delete(card)}),{rootMargin:'300px'});document.querySelectorAll('.card').forEach(card=>observer.observe(card));
function tick(now){for(const card of active){if(card.dataset.ready!=='1')continue;const animation=card._animation;const elapsed=Math.floor(now/(1000/animation.frameRate));const frame=animation.loop?elapsed%animation.frames.length:Math.min(elapsed,animation.frames.length-1);drawFrame(card.querySelector('.animation'),animation,frame)}requestAnimationFrame(tick)}requestAnimationFrame(tick);
function filter(){const query=document.querySelector('#search').value.trim().toLowerCase();const view=document.querySelector('#view').value;const family=familySelect.value;const status=document.querySelector('#status').value;const wound=document.querySelector('#wound').value;document.querySelectorAll('.card').forEach(card=>card.classList.toggle('hidden',!!((query&&!card.dataset.search.includes(query))||(view&&card.dataset.view!==view)||(family&&card.dataset.family!==family)||(status&&card.dataset.status!==status)||(wound&&card.dataset.wound!==wound))))}document.querySelectorAll('.controls input,.controls select').forEach(control=>control.addEventListener('input',filter));filter();
</script>
</body>
</html>\n`;
};

const parseArguments = (argv) => {
  const options = {
    root: DEFAULT_ROOT,
    output: undefined,
    html: true,
    inventoryOnly: false,
    stdout: false,
    failOnHard: false,
    reviewScale: 0.5,
    families: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = resolve(argv[++index]);
    else if (argument === '--output') options.output = resolve(argv[++index]);
    else if (argument === '--no-html') options.html = false;
    else if (argument === '--inventory-only') options.inventoryOnly = true;
    else if (argument === '--stdout') options.stdout = true;
    else if (argument === '--fail-on-hard') options.failOnHard = true;
    else if (argument === '--family') options.families = argv[++index].split(',').map((value) => value.trim()).filter(Boolean);
    else if (argument === '--review-scale') options.reviewScale = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isFinite(options.reviewScale) || options.reviewScale <= 0 || options.reviewScale > 1) {
    throw new Error('--review-scale must be greater than 0 and no greater than 1.');
  }
  if (!options.output) options.output = resolve(options.root, DEFAULT_OUTPUT);
  return options;
};

export const main = (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  if (options.inventoryOnly) {
    const payload = summarizeInventory(buildInventory(options.root));
    if (options.stdout) process.stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }
  const report = runAudit({ root: options.root, families: options.families });
  mkdirSync(options.output, { recursive: true });
  writeFileSync(resolve(options.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (options.html) writeFileSync(resolve(options.output, 'index.html'), buildHtml(options.root, report, options.reviewScale));
  if (options.stdout) process.stdout.write(`${JSON.stringify(report.summary)}\n`);
  else {
    const shownOutput = relative(options.root, options.output) || '.';
    process.stdout.write(`Animal animation audit: ${report.summary.passing} pass, ${report.summary.warnings} warn, ${report.summary.failing} fail (${report.summary.animations} cycles); ${report.summary.stateTransitionPassing} pass, ${report.summary.stateTransitionWarnings} warn, ${report.summary.stateTransitionFailing} fail (${report.summary.stateTransitions} alternating transitions).\n`);
    process.stdout.write(`Report: ${shownOutput}/report.json${options.html ? `\nReview: ${shownOutput}/index.html` : ''}\n`);
  }
  if (options.failOnHard && (report.hardFailures.length > 0 || report.stateTransitionHardFailures.length > 0)) process.exitCode = 2;
  return report;
};

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
