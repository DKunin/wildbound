import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

interface WoundSheetManifest {
  file: string;
  source: string;
  width: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  pixelsByLevel: number[][];
  placementsByLevel: Array<Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    mirror: boolean;
    clip: [number, number, number, number];
  }>>;
  sha256: string;
}

interface WoundManifest {
  version: number;
  levels: number;
  spritesheets: WoundSheetManifest[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WOUND_ROOT = resolve(ROOT, 'public/assets/wounds-v1');
const WOLF_ROOT = resolve(ROOT, 'public/assets/player-wolf-v2');
const PREY_ROOT = resolve(ROOT, 'public/assets/prey-v2');
const ELK_ROOT = resolve(ROOT, 'public/assets/prey-v3');
const BOAR_ROOT = resolve(ROOT, 'public/assets/prey-v4');
const BALANCE_ROOT = resolve(ROOT, 'public/assets/balance-v1');
const BASELINE_PATH = resolve(ROOT, 'tests/fixtures/wounded-sprites-visual-baseline.json');
const manifest = JSON.parse(readFileSync(resolve(WOUND_ROOT, 'manifest.json'), 'utf8')) as WoundManifest;

const fileHash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const actualBaseline = {
  version: 1,
  manifest: fileHash(resolve(WOUND_ROOT, 'manifest.json')),
  spritesheets: Object.fromEntries(manifest.spritesheets.map(({ file }) => [file, fileHash(resolve(WOUND_ROOT, file))])),
};

if (process.env.UPDATE_WOUND_VISUAL_BASELINE === '1') {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(actualBaseline, null, 2)}\n`);
}

const sourcePath = (source: string): string => {
  if (source.startsWith('wolf-')) return resolve(WOLF_ROOT, source);
  if (source === 'deer-kick.png') return resolve(BALANCE_ROOT, source);
  if (source.startsWith('elk-')) return resolve(ELK_ROOT, source);
  if (source.startsWith('boar-')) return resolve(BOAR_ROOT, source);
  return resolve(PREY_ROOT, source);
};

const containmentSamples = new Set([
  'wolf-east-motion-wounds.png',
  'wolf-northeast-run-wounds.png',
  'wolf-north-rest-wounds.png',
  'wolf-northwest-action-wounds.png',
  'wolf-west-crouch-wounds.png',
  'wolf-southwest-motion-carry-wounds.png',
  'wolf-south-run-carry-wounds.png',
  'wolf-southeast-rest-carry-wounds.png',
  'wolf-east-crouch-carry-wounds.png',
  'wolf-south-bury-wounds.png',
  'deer-atlas-wounds.png',
  'deer-actions-wounds.png',
  'deer-kick-wounds.png',
  'elk-atlas-wounds.png',
  'elk-actions-wounds.png',
  'boar-atlas-wounds.png',
  'boar-actions-wounds.png',
]);
const directions = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'] as const;
const burialWolfPoseByFrame = [5, 6, 7, 8, 9, 8, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6] as const;

const cellHash = (image: PNG, frame: number, frameWidth: number, frameHeight: number): string => {
  const frameX = (frame % 4) * frameWidth;
  const frameY = Math.floor(frame / 4) * frameHeight;
  const hash = createHash('sha256');
  for (let y = 0; y < frameHeight; y += 1) {
    const start = ((frameY + y) * image.width + frameX) * 4;
    hash.update(image.data.subarray(start, start + frameWidth * 4));
  }
  return hash.digest('hex');
};

describe('baked wound spritesheets', () => {
  it('matches the reviewed all-action visual baseline', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(actualBaseline).toEqual(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  });

  it('covers every wolf, deer, elk, and boar sheet, frame, and wound level', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.levels).toBe(3);
    expect(manifest.spritesheets).toHaveLength(87);
    expect(new Set(manifest.spritesheets.map(({ file }) => file)).size).toBe(87);

    for (const sheet of manifest.spritesheets) {
      expect(existsSync(resolve(WOUND_ROOT, sheet.file)), sheet.file).toBe(true);
      expect(sheet.sha256, sheet.file).toBe(actualBaseline.spritesheets[sheet.file]);
      expect(sheet.width).toBeGreaterThanOrEqual(sheet.frameWidth * sheet.columns);
      expect(sheet.sourceHeight).toBe(sheet.frameHeight * sheet.rows);
      expect(sheet.pixelsByLevel).toHaveLength(3);
      expect(sheet.placementsByLevel).toHaveLength(3);
      for (const [level, pixels] of sheet.pixelsByLevel.entries()) {
        expect(pixels, sheet.file).toHaveLength(sheet.columns * sheet.rows);
        for (const count of pixels) expect(count, sheet.file).toBeGreaterThan(20);
        expect(sheet.placementsByLevel[level], sheet.file).toHaveLength(sheet.columns * sheet.rows);
        for (const placement of sheet.placementsByLevel[level]) {
          expect(placement.width, sheet.file).toBeGreaterThan(0);
          expect(placement.height, sheet.file).toBeGreaterThan(0);
          expect(placement.clip[2], sheet.file).toBe(sheet.frameWidth);
          expect(placement.clip[3], sheet.file).toBe(sheet.frameHeight);
        }
      }
    }
  });

  it('clips representative wounds into the animal silhouette rather than floating over it', () => {
    const samples = manifest.spritesheets.filter(({ file }) => containmentSamples.has(file));
    expect(samples.map(({ file }) => file).sort()).toEqual([...containmentSamples].sort());
    for (const sheet of samples) {
      const wounds = PNG.sync.read(readFileSync(resolve(WOUND_ROOT, sheet.file)));
      const source = PNG.sync.read(readFileSync(sourcePath(sheet.source)));
      expect(wounds.width).toBe(source.width);
      expect(wounds.height).toBe(source.height * 3);
      let visible = 0;
      for (let y = 0; y < wounds.height; y += 1) {
        const sourceY = y % source.height;
        for (let x = 0; x < wounds.width; x += 1) {
          const woundAlpha = wounds.data[(y * wounds.width + x) * 4 + 3];
          if (woundAlpha === 0) continue;
          visible += 1;
          expect(source.data[(sourceY * source.width + x) * 4 + 3], `${sheet.file} at ${x},${y}`).toBeGreaterThan(0);
        }
      }
      expect(visible, sheet.file).toBeGreaterThan(1_000);
    }
  });

  it('holds the completed burial pose after frame 7 and keeps wounds on one body anchor', () => {
    for (const direction of directions) {
      const sheet = manifest.spritesheets.find(({ source }) => source === `wolf-${direction}-bury.png`);
      expect(sheet, direction).toBeDefined();
      if (!sheet) continue;
      const wounds = PNG.sync.read(readFileSync(resolve(WOUND_ROOT, sheet.file)));
      const burial = PNG.sync.read(readFileSync(resolve(WOLF_ROOT, sheet.source)));
      const action = PNG.sync.read(readFileSync(resolve(WOLF_ROOT, `wolf-${direction}-action.png`)));
      const completedPoseHash = cellHash(burial, 7, sheet.frameWidth, sheet.frameHeight);
      for (let frame = 8; frame < sheet.columns * sheet.rows; frame += 1) {
        expect(cellHash(burial, frame, sheet.frameWidth, sheet.frameHeight), `${direction} burial frame ${frame}`).toBe(completedPoseHash);
      }
      for (let level = 0; level < 3; level += 1) {
        const placements = sheet.placementsByLevel[level];
        const anchor = {
          x: placements[0].x - placements[0].clip[0],
          y: placements[0].y - placements[0].clip[1],
          width: placements[0].width,
          height: placements[0].height,
          mirror: placements[0].mirror,
        };
        for (let frame = 0; frame < sheet.columns * sheet.rows; frame += 1) {
          const frameX = (frame % sheet.columns) * sheet.frameWidth;
          const frameY = Math.floor(frame / sheet.columns) * sheet.frameHeight;
          const placement = placements[frame];
          expect({
            x: placement.x - placement.clip[0],
            y: placement.y - placement.clip[1],
            width: placement.width,
            height: placement.height,
            mirror: placement.mirror,
          }, `${direction} level ${level + 1} frame ${frame} anchor`).toEqual(anchor);
          const actionFrame = burialWolfPoseByFrame[frame];
          const actionX = (actionFrame % sheet.columns) * sheet.frameWidth;
          const actionY = Math.floor(actionFrame / sheet.columns) * sheet.frameHeight;
          for (let y = 0; y < sheet.frameHeight; y += 1) {
            for (let x = 0; x < sheet.frameWidth; x += 1) {
              const woundY = level * sheet.sourceHeight + frameY + y;
              if (wounds.data[(woundY * wounds.width + frameX + x) * 4 + 3] === 0) continue;
              expect(
                action.data[((actionY + y) * action.width + actionX + x) * 4 + 3],
                `${direction} level ${level + 1} frame ${frame} at ${x},${y}`,
              ).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
});
