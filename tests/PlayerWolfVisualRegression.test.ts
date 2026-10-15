import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const ALPHA_THRESHOLD = 38;
const MIN_COMPONENT_AREA = 100;
const MAX_DETACHED_SHARE = 0.02;
const MAX_EDGE_SHARE = 0;
const MAX_ANCHOR_STEP_PX = 12;
const MIN_AREA_RATIO = 0.65;
const MAX_AREA_RATIO = 1.35;
const MIN_ACTION_AREA_RATIO = 0.85;
const MAX_ACTION_AREA_RATIO = 1.15;
const MAX_ACTION_SCALE_STEP = 1.12;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'public/assets/player-wolf-v2');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/player-wolf-animation-visual-baseline.json');

const directions = [
  'east', 'northeast', 'north', 'northwest',
  'west', 'southwest', 'south', 'southeast',
] as const;

type Direction = typeof directions[number];
type AtlasKind = 'motion' | 'run' | 'rest' | 'action';

interface AnimationSpec {
  atlas: AtlasKind;
  frames: number[];
  name: string;
}

interface FrameMetrics {
  anchor: [number, number];
  bbox: [number, number, number, number];
  components: number[];
  detachedShare: number;
  edgeShare: number;
  hash: string;
  opaquePixels: number;
}

interface VisualBaseline {
  animations: Record<string, FrameMetrics[]>;
  atlas: { alphaThreshold: number; frameHeight: number; frameWidth: number };
  version: number;
}

const animationSpecs: AnimationSpec[] = [
  { name: 'walk', atlas: 'motion', frames: [0, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'idle', atlas: 'motion', frames: [8, 9, 10, 11, 12, 13, 14, 15] },
  { name: 'run', atlas: 'run', frames: Array.from({ length: 16 }, (_, index) => index) },
  { name: 'lay-down', atlas: 'rest', frames: [0, 1, 2, 3, 4, 5] },
  { name: 'rest-breathe', atlas: 'rest', frames: [6, 7] },
  { name: 'rest-micro-ear', atlas: 'rest', frames: [6, 8, 6, 7] },
  { name: 'rest-micro-head', atlas: 'rest', frames: [6, 9, 7, 6] },
  { name: 'get-up', atlas: 'rest', frames: [10, 11, 12, 13, 14, 15] },
  { name: 'attack', atlas: 'action', frames: [0, 1, 2, 3, 4] },
  { name: 'eat', atlas: 'action', frames: [5, 6, 7, 8, 9] },
  { name: 'drink', atlas: 'action', frames: [10, 11, 12, 13, 14, 15] },
];

const imageCache = new Map<string, PNG>();
const metricsCache = new Map<string, FrameMetrics>();

const atlasPath = (direction: Direction, atlas: AtlasKind): string =>
  resolve(ASSET_ROOT, `wolf-${direction}-${atlas}.png`);

const readAtlas = (path: string): PNG => {
  const cached = imageCache.get(path);
  if (cached) return cached;
  const image = PNG.sync.read(readFileSync(path));
  imageCache.set(path, image);
  return image;
};

const framePixels = (image: PNG, frame: number): Buffer => {
  const result = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 4);
  const sourceX = (frame % 4) * FRAME_WIDTH;
  const sourceY = Math.floor(frame / 4) * FRAME_HEIGHT;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    image.data.copy(result, y * FRAME_WIDTH * 4, sourceStart, sourceStart + FRAME_WIDTH * 4);
  }
  return result;
};

const analyzeFrame = (direction: Direction, atlas: AtlasKind, frame: number): FrameMetrics => {
  const cacheKey = `${direction}-${atlas}-${frame}`;
  const cached = metricsCache.get(cacheKey);
  if (cached) return cached;

  const pixels = framePixels(readAtlas(atlasPath(direction, atlas)), frame);
  const occupied = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  let minX = FRAME_WIDTH;
  let minY = FRAME_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  let edgePixels = 0;

  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const pixel = y * FRAME_WIDTH + x;
      if (pixels[pixel * 4 + 3] < ALPHA_THRESHOLD) continue;
      occupied[pixel] = 1;
      opaquePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === FRAME_WIDTH - 1 || y === FRAME_HEIGHT - 1) edgePixels += 1;
    }
  }

  if (opaquePixels === 0) throw new Error(`${cacheKey} has no visible pixels`);

  const visited = new Uint8Array(occupied.length);
  const components: number[] = [];
  const queue = new Int32Array(occupied.length);
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const pixel = queue[head++];
      area += 1;
      const x = pixel % FRAME_WIDTH;
      const y = Math.floor(pixel / FRAME_WIDTH);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= FRAME_WIDTH || nextY < 0 || nextY >= FRAME_HEIGHT) continue;
          const next = nextY * FRAME_WIDTH + nextX;
          if (!occupied[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (area >= MIN_COMPONENT_AREA) components.push(area);
  }
  components.sort((left, right) => right - left);
  const significantArea = components.reduce((sum, area) => sum + area, 0);
  const detachedShare = significantArea > 0 ? (significantArea - (components[0] ?? 0)) / significantArea : 0;
  const centerX = (minX + maxX) / 2;
  const anchorY = direction === 'north' ? minY : maxY;

  const metrics: FrameMetrics = {
    anchor: [centerX, anchorY],
    bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
    components,
    detachedShare: Number(detachedShare.toFixed(5)),
    edgeShare: Number((edgePixels / opaquePixels).toFixed(5)),
    hash: createHash('sha256').update(pixels).digest('hex'),
    opaquePixels,
  };
  metricsCache.set(cacheKey, metrics);
  return metrics;
};

const collectBaseline = (): VisualBaseline => {
  const animations: Record<string, FrameMetrics[]> = {};
  for (const direction of directions) {
    for (const animation of animationSpecs) {
      animations[`${direction}-${animation.name}`] = animation.frames.map((frame) =>
        analyzeFrame(direction, animation.atlas, frame));
    }
  }
  return {
    version: 1,
    atlas: { frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT, alphaThreshold: ALPHA_THRESHOLD },
    animations,
  };
};

const actual = collectBaseline();
if (process.env.UPDATE_WOLF_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
}

describe('player wolf animation visual regressions', () => {
  it('matches the reviewed frame-by-frame visual baseline', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const expected = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as VisualBaseline;
    expect(actual).toEqual(expected);
  });

  it('keeps every animation anatomically connected', () => {
    const failures: string[] = [];
    for (const [animation, frames] of Object.entries(actual.animations)) {
      frames.forEach((frame, index) => {
        if (frame.detachedShare > MAX_DETACHED_SHARE) {
          failures.push(`${animation}[${index}] detached ${(frame.detachedShare * 100).toFixed(1)}%`);
        }
        if (frame.edgeShare > MAX_EDGE_SHARE) {
          failures.push(`${animation}[${index}] touches atlas edge ${(frame.edgeShare * 100).toFixed(2)}%`);
        }
      });
    }
    expect(failures).toEqual([]);
  });

  it('prevents frame-to-frame anchor jumps and silhouette collapse', () => {
    const failures: string[] = [];
    for (const [animation, frames] of Object.entries(actual.animations)) {
      const medianArea = [...frames].sort((left, right) => left.opaquePixels - right.opaquePixels)[Math.floor(frames.length / 2)].opaquePixels;
      frames.forEach((frame, index) => {
        const areaRatio = frame.opaquePixels / medianArea;
        if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) {
          failures.push(`${animation}[${index}] area ratio ${areaRatio.toFixed(2)}`);
        }
        if (index === 0) return;
        const previous = frames[index - 1];
        const anchorStep = Math.hypot(frame.anchor[0] - previous.anchor[0], frame.anchor[1] - previous.anchor[1]);
        if (anchorStep > MAX_ANCHOR_STEP_PX) {
          failures.push(`${animation}[${index - 1}->${index}] anchor step ${anchorStep.toFixed(1)}px`);
        }
      });
    }
    expect(failures).toEqual([]);
  });

  it('keeps one-shot action scale continuous between adjacent frames', () => {
    const failures: string[] = [];
    for (const [animation, frames] of Object.entries(actual.animations)) {
      if (!animation.endsWith('-attack') && !animation.endsWith('-eat') && !animation.endsWith('-drink')) continue;
      const medianArea = [...frames]
        .sort((left, right) => left.opaquePixels - right.opaquePixels)[Math.floor(frames.length / 2)].opaquePixels;
      frames.forEach((frame, index) => {
        const areaRatio = frame.opaquePixels / medianArea;
        if (areaRatio < MIN_ACTION_AREA_RATIO || areaRatio > MAX_ACTION_AREA_RATIO) {
          failures.push(`${animation}[${index}] action area ratio ${areaRatio.toFixed(2)}`);
        }
        if (index === 0) return;
        const previous = frames[index - 1];
        const previousScale = Math.sqrt(previous.bbox[2] * previous.bbox[3]);
        const currentScale = Math.sqrt(frame.bbox[2] * frame.bbox[3]);
        const scaleStep = Math.max(previousScale / currentScale, currentScale / previousScale);
        if (scaleStep > MAX_ACTION_SCALE_STEP) {
          failures.push(`${animation}[${index - 1}->${index}] scale step ${scaleStep.toFixed(2)}`);
        }
      });
    }
    expect(failures).toEqual([]);
  });

  it('keeps ground anchors continuous when entering and leaving rest', () => {
    const failures: string[] = [];
    for (const direction of directions) {
      const transitions = [
        ['idle', -1, 'lay-down', 0],
        ['lay-down', -1, 'rest-breathe', 0],
        ['rest-breathe', -1, 'get-up', 0],
        ['get-up', -1, 'idle', 0],
      ] as const;
      for (const [fromName, fromIndex, toName, toIndex] of transitions) {
        const fromFrames = actual.animations[`${direction}-${fromName}`];
        const toFrames = actual.animations[`${direction}-${toName}`];
        const from = fromFrames[fromIndex < 0 ? fromFrames.length + fromIndex : fromIndex];
        const to = toFrames[toIndex];
        const step = Math.hypot(from.anchor[0] - to.anchor[0], from.anchor[1] - to.anchor[1]);
        if (step > MAX_ANCHOR_STEP_PX) failures.push(`${direction} ${fromName}->${toName} anchor step ${step.toFixed(1)}px`);
      }
    }
    expect(failures).toEqual([]);
  });
});
