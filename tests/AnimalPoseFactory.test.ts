import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import preyAnimationContract from '../src/game/data/prey-animation-contract.json';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CELL_SIZE = preyAnimationContract.cellSize;
const DIRECTIONS = preyAnimationContract.directions;
const ACTION_STATES = ['resting', 'foraging', 'drinking'] as const;

const outputs = [
  'public/assets/prey-v2/rabbit-atlas.png',
  'public/assets/prey-v2/rabbit-actions.png',
  'public/assets/prey-v2/deer-atlas.png',
  'public/assets/prey-v2/deer-actions.png',
  'public/assets/prey-v3/elk-atlas.png',
  'public/assets/prey-v3/elk-actions.png',
  'public/assets/prey-v4/boar-atlas.png',
  'public/assets/prey-v4/boar-actions.png',
  'public/assets/prey-v4/boar-charge.png',
  'art-source/prey-actions-v2/build-manifest.json',
] as const;

const outputSnapshot = (): Record<string, { hash: string; mtimeMs: number; size: number }> => Object.fromEntries(
  outputs.map((relativePath) => {
    const absolutePath = resolve(ROOT, relativePath);
    const bytes = readFileSync(absolutePath);
    const stat = statSync(absolutePath);
    return [relativePath, {
      hash: createHash('sha256').update(bytes).digest('hex'),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    }];
  }),
);

const frameHash = (atlas: PNG, frame: number, columns: number): string => {
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const cell = new PNG({ width: CELL_SIZE, height: CELL_SIZE });
  cell.data.fill(0);
  PNG.bitblt(
    atlas,
    cell,
    column * CELL_SIZE,
    row * CELL_SIZE,
    CELL_SIZE,
    CELL_SIZE,
    0,
    0,
  );
  return createHash('sha256').update(cell.data).digest('hex');
};

const visiblePixels = (atlas: PNG, frame: number, columns: number): number => {
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  let visible = 0;
  for (let y = row * CELL_SIZE; y < (row + 1) * CELL_SIZE; y += 1) {
    for (let x = column * CELL_SIZE; x < (column + 1) * CELL_SIZE; x += 1) {
      if (atlas.data[(y * atlas.width + x) * 4 + 3] > 16) visible += 1;
    }
  }
  return visible;
};

const groundContactY = (atlas: PNG, frame: number, columns: number): number => {
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  let ground = -1;
  for (let y = 0; y < CELL_SIZE; y += 1) {
    for (let x = 0; x < CELL_SIZE; x += 1) {
      const atlasX = column * CELL_SIZE + x;
      const atlasY = row * CELL_SIZE + y;
      if (atlas.data[(atlasY * atlas.width + atlasX) * 4 + 3] > 16) ground = y;
    }
  }
  return ground;
};

describe('animal pose factory', () => {
  it('defines complete four-phase action loops and dedicated retaliation artwork', () => {
    expect(preyAnimationContract.version).toBe(2);
    expect(DIRECTIONS).toEqual([
      'east', 'northeast', 'north', 'northwest',
      'west', 'southwest', 'south', 'southeast',
    ]);
    expect(Object.keys(preyAnimationContract.species)).toEqual(['rabbit', 'deer', 'elk', 'boar']);
    expect(preyAnimationContract.species.deer.retaliationAsset).toBe('deer-kick');
    expect(preyAnimationContract.species.boar.retaliationAsset).toBe('boar-charge');
    expect(preyAnimationContract.species.rabbit.retaliationAsset).toBeNull();
    expect(preyAnimationContract.species.elk.retaliationAsset).toBeNull();

    for (const [index, state] of ACTION_STATES.entries()) {
      const definition = preyAnimationContract.states[state];
      expect(definition.sheet).toBe('actions');
      expect(definition.layout).toBe('phaseRows');
      expect(definition.rows).toEqual([0, 1, 2, 3].map((phase) => index * 4 + phase));
      expect(definition.minFrames).toBe(4);
      expect(definition.minUniquePoses).toBeGreaterThanOrEqual(3);
      expect(definition.repeat).toBe(-1);
    }
  });

  it('builds 12-row action sheets with four visible, distinct poses per direction', () => {
    for (const [species, definition] of Object.entries(preyAnimationContract.species)) {
      const path = resolve(ROOT, `public/assets/${definition.assetRoot}/${species}-actions.png`);
      const atlas = PNG.sync.read(readFileSync(path));
      expect([atlas.width, atlas.height], species).toEqual([DIRECTIONS.length * CELL_SIZE, 12 * CELL_SIZE]);

      for (const [directionIndex, direction] of DIRECTIONS.entries()) {
        for (const state of ACTION_STATES) {
          const rows = preyAnimationContract.states[state].rows;
          const frames = rows.map((row) => row * DIRECTIONS.length + directionIndex);
          expect(frames.map((frame) => visiblePixels(atlas, frame, DIRECTIONS.length)).every((count) => count > 0), `${species}/${direction}/${state}`).toBe(true);
          expect(new Set(frames.map((frame) => frameHash(atlas, frame, DIRECTIONS.length))).size, `${species}/${direction}/${state}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('builds four unique directional boar charge poses', () => {
    const atlas = PNG.sync.read(readFileSync(resolve(ROOT, 'public/assets/prey-v4/boar-charge.png')));
    expect([atlas.width, atlas.height]).toEqual([4 * CELL_SIZE, DIRECTIONS.length * CELL_SIZE]);
    for (const [directionIndex, direction] of DIRECTIONS.entries()) {
      const frames = [0, 1, 2, 3].map((phase) => directionIndex * 4 + phase);
      expect(frames.map((frame) => visiblePixels(atlas, frame, 4)).every((count) => count > 0), direction).toBe(true);
      expect(new Set(frames.map((frame) => frameHash(atlas, frame, 4))).size, direction).toBe(4);
    }
  });

  it('normalizes both idle phases for every interruptible action transition', () => {
    const transitionLimit = preyAnimationContract.transitionLimits.groundContactY;
    for (const [species, definition] of Object.entries(preyAnimationContract.species)) {
      const movementPath = resolve(ROOT, `public/assets/${definition.assetRoot}/${species}-atlas.png`);
      const actionPath = resolve(ROOT, `public/assets/${definition.assetRoot}/${species}-actions.png`);
      const movement = PNG.sync.read(readFileSync(movementPath));
      const actions = PNG.sync.read(readFileSync(actionPath));

      for (const [directionIndex, direction] of DIRECTIONS.entries()) {
        const idleGrounds = [0, 1].map((row) => groundContactY(
          movement,
          row * DIRECTIONS.length + directionIndex,
          DIRECTIONS.length,
        ));
        expect(new Set(idleGrounds).size, `${species}/${direction}/idle`).toBe(1);

        for (const state of ACTION_STATES) {
          const actionGrounds = preyAnimationContract.states[state].rows.map((row) => groundContactY(
            actions,
            row * DIRECTIONS.length + directionIndex,
            DIRECTIONS.length,
          ));
          for (const idleGround of idleGrounds) {
            for (const actionGround of actionGrounds) {
              expect(
                Math.abs(idleGround - actionGround),
                `${species}/${direction}/${state}: idle ${idleGround}, action ${actionGround}`,
              ).toBeLessThanOrEqual(transitionLimit);
            }
          }
        }
      }
    }
  });

  it('records the normalized encoded movement bytes in the factory manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(
      ROOT,
      'art-source/prey-actions-v2/build-manifest.json',
    ), 'utf8')) as { species: Record<string, { movement: string; movementSha256: string }> };

    for (const [species, entry] of Object.entries(manifest.species)) {
      const movementBytes = readFileSync(resolve(ROOT, entry.movement));
      expect(entry.movementSha256, species).toBe(createHash('sha256').update(movementBytes).digest('hex'));
    }
  });

  it('passes deterministic --check without modifying generated outputs', () => {
    expect(outputs).toHaveLength(10);
    const before = outputSnapshot();
    const first = spawnSync(process.execPath, ['scripts/build-animal-action-atlases.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(first.status, first.stderr || first.stdout).toBe(0);
    expect(outputSnapshot()).toEqual(before);

    const second = spawnSync(process.execPath, ['scripts/build-animal-action-atlases.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(outputSnapshot()).toEqual(before);
  }, 30_000);
});
