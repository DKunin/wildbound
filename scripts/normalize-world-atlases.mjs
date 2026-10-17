import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const FRAME_SIZE = 313;
const GRID_SIZE = 4;
const TARGET_SIZE = FRAME_SIZE * GRID_SIZE;
const SOURCE_SIZE = TARGET_SIZE + 2;
const ALPHA_THRESHOLD = 16;
const MIN_COMPONENT_AREA = 4;
const ATTACH_RADIUS = 6;
const FRAME_MARGIN = 1;

const root = resolve(import.meta.dirname, '..');
const atlases = [
  { path: 'public/assets/terrain-overlays-v3.png', ownership: false },
  { path: 'public/assets/obstacle-atlas-v3.png', ownership: true },
  {
    path: 'public/assets/terrain-features-v4.png',
    ownership: true,
    mirrors: ['art-source/terrain-v4/terrain-features-source.png'],
  },
  { path: 'public/assets/water-tiles-v3.png', ownership: false },
];

const roundedEdges = (size) => Array.from(
  { length: GRID_SIZE + 1 },
  (_value, index) => Math.floor((2 * index * size + GRID_SIZE) / (2 * GRID_SIZE)),
);

const cellIndexAt = (x, y, xEdges, yEdges) => {
  let column = GRID_SIZE - 1;
  let row = GRID_SIZE - 1;
  for (let index = 1; index < GRID_SIZE; index += 1) {
    if (x < xEdges[index]) {
      column = index - 1;
      break;
    }
  }
  for (let index = 1; index < GRID_SIZE; index += 1) {
    if (y < yEdges[index]) {
      row = index - 1;
      break;
    }
  }
  return row * GRID_SIZE + column;
};

const copyRuntimeArea = (source) => {
  const output = new PNG({ width: TARGET_SIZE, height: TARGET_SIZE, colorType: 6 });
  output.data.fill(0);
  for (let y = 0; y < TARGET_SIZE; y += 1) {
    source.data.copy(
      output.data,
      y * TARGET_SIZE * 4,
      y * source.width * 4,
      (y * source.width + TARGET_SIZE) * 4,
    );
  }
  return output;
};

const assignPixelOwners = (source, xEdges, yEdges) => {
  const pixelCount = source.width * source.height;
  const owners = new Int16Array(pixelCount).fill(-1);
  const visited = new Uint8Array(pixelCount);
  const cells = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      cells[y * source.width + x] = cellIndexAt(x, y, xEdges, yEdges);
    }
  }

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || source.data[start * 4 + 3] <= ALPHA_THRESHOLD) continue;
    let head = 0;
    let tail = 0;
    const pixelsPerCell = new Uint32Array(GRID_SIZE * GRID_SIZE);
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const pixel = queue[head++];
      pixelsPerCell[cells[pixel]] += 1;
      const x = pixel % source.width;
      const y = Math.floor(pixel / source.width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= source.width || nextY < 0 || nextY >= source.height) continue;
          const next = nextY * source.width + nextX;
          if (visited[next] || source.data[next * 4 + 3] <= ALPHA_THRESHOLD) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail < MIN_COMPONENT_AREA) continue;
    let owner = 0;
    for (let cell = 1; cell < pixelsPerCell.length; cell += 1) {
      if (pixelsPerCell[cell] > pixelsPerCell[owner]) owner = cell;
    }
    for (let index = 0; index < tail; index += 1) owners[queue[index]] = owner;
  }

  let head = 0;
  let tail = 0;
  const distance = new Uint8Array(pixelCount).fill(255);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (owners[pixel] < 0) continue;
    distance[pixel] = 0;
    queue[tail++] = pixel;
  }
  while (head < tail) {
    const pixel = queue[head++];
    if (distance[pixel] >= ATTACH_RADIUS) continue;
    const x = pixel % source.width;
    const y = Math.floor(pixel / source.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= source.width || nextY < 0 || nextY >= source.height) continue;
        const next = nextY * source.width + nextX;
        if (owners[next] >= 0 || source.data[next * 4 + 3] === 0) continue;
        owners[next] = owners[pixel];
        distance[next] = distance[pixel] + 1;
        queue[tail++] = next;
      }
    }
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (owners[pixel] < 0 && source.data[pixel * 4 + 3] > 0) owners[pixel] = cells[pixel];
  }
  return owners;
};

const repackOwnedFrames = (source) => {
  const xEdges = roundedEdges(source.width);
  const yEdges = roundedEdges(source.height);
  const owners = assignPixelOwners(source, xEdges, yEdges);
  const bounds = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => ({
    minX: source.width,
    minY: source.height,
    maxX: -1,
    maxY: -1,
  }));

  for (let pixel = 0; pixel < owners.length; pixel += 1) {
    const owner = owners[pixel];
    if (owner < 0 || source.data[pixel * 4 + 3] <= ALPHA_THRESHOLD) continue;
    const x = pixel % source.width;
    const y = Math.floor(pixel / source.width);
    const box = bounds[owner];
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }

  const output = new PNG({ width: TARGET_SIZE, height: TARGET_SIZE, colorType: 6 });
  output.data.fill(0);
  const shifts = bounds.map((box, frame) => {
    if (box.maxX < box.minX || box.maxY < box.minY) throw new Error(`Frame ${frame} has no visible artwork`);
    const solidWidth = box.maxX - box.minX + 1;
    const solidHeight = box.maxY - box.minY + 1;
    const innerSize = FRAME_SIZE - FRAME_MARGIN * 2;
    if (solidWidth > innerSize || solidHeight > innerSize) {
      throw new Error(`Frame ${frame} is ${solidWidth}x${solidHeight}; it does not fit the ${innerSize}px safe area`);
    }
    const column = frame % GRID_SIZE;
    const row = Math.floor(frame / GRID_SIZE);
    const preferredX = box.minX - xEdges[column];
    const preferredY = box.minY - yEdges[row];
    const targetX = Math.max(FRAME_MARGIN, Math.min(preferredX, FRAME_SIZE - FRAME_MARGIN - solidWidth));
    const targetY = Math.max(FRAME_MARGIN, Math.min(preferredY, FRAME_SIZE - FRAME_MARGIN - solidHeight));
    return {
      x: column * FRAME_SIZE + targetX - box.minX,
      y: row * FRAME_SIZE + targetY - box.minY,
    };
  });

  for (let pixel = 0; pixel < owners.length; pixel += 1) {
    const owner = owners[pixel];
    if (owner < 0 || source.data[pixel * 4 + 3] === 0) continue;
    const sourceX = pixel % source.width;
    const sourceY = Math.floor(pixel / source.width);
    const targetX = sourceX + shifts[owner].x;
    const targetY = sourceY + shifts[owner].y;
    const column = owner % GRID_SIZE;
    const row = Math.floor(owner / GRID_SIZE);
    const left = column * FRAME_SIZE + FRAME_MARGIN;
    const top = row * FRAME_SIZE + FRAME_MARGIN;
    if (targetX < left || targetX >= left + FRAME_SIZE - FRAME_MARGIN * 2) continue;
    if (targetY < top || targetY >= top + FRAME_SIZE - FRAME_MARGIN * 2) continue;
    const sourceOffset = pixel * 4;
    const targetOffset = (targetY * TARGET_SIZE + targetX) * 4;
    source.data.copy(output.data, targetOffset, sourceOffset, sourceOffset + 4);
  }
  return output;
};

for (const atlas of atlases) {
  const path = resolve(root, atlas.path);
  const source = PNG.sync.read(readFileSync(path));
  if (![TARGET_SIZE, SOURCE_SIZE].includes(source.width) || ![TARGET_SIZE, SOURCE_SIZE].includes(source.height)) {
    throw new Error(`${atlas.path} is ${source.width}x${source.height}; expected ${TARGET_SIZE} or ${SOURCE_SIZE}`);
  }
  const normalized = atlas.ownership ? repackOwnedFrames(source) : copyRuntimeArea(source);
  const encoded = PNG.sync.write(normalized);
  writeFileSync(path, encoded);
  for (const mirror of atlas.mirrors ?? []) writeFileSync(resolve(root, mirror), encoded);
  console.log(`${atlas.path}: ${source.width}x${source.height} -> ${TARGET_SIZE}x${TARGET_SIZE}`);
}
