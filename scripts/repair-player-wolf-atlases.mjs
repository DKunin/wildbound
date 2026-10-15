import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const FRAME_WIDTH = 346;
const FRAME_HEIGHT = 284;
const ALPHA_THRESHOLD = 38;
const MIN_COMPONENT_AREA = 100;
const CELL_MARGIN = 4;
const directions = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
const atlasKinds = ['motion', 'run', 'rest', 'action'];

const args = process.argv.slice(2);
const sourceFlag = args.indexOf('--source');
const outputFlag = args.indexOf('--output');
if (sourceFlag < 0 || outputFlag < 0 || !args[sourceFlag + 1] || !args[outputFlag + 1]) {
  throw new Error('Usage: node scripts/repair-player-wolf-atlases.mjs --source <asset-dir> --output <directory>');
}

const sourceRoot = resolve(args[sourceFlag + 1]);
const outputRoot = resolve(args[outputFlag + 1]);
mkdirSync(outputRoot, { recursive: true });

const findComponents = (image) => {
  const size = image.width * image.height;
  const occupied = new Uint8Array(size);
  for (let pixel = 0; pixel < size; pixel += 1) {
    if (image.data[pixel * 4 + 3] >= ALPHA_THRESHOLD) occupied[pixel] = 1;
  }

  const labels = new Int16Array(size).fill(-1);
  const queue = new Int32Array(size);
  const components = [];
  for (let start = 0; start < size; start += 1) {
    if (!occupied[start] || labels[start] >= 0) continue;
    const id = components.length;
    let head = 0;
    let tail = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    labels[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= image.width || nextY < 0 || nextY >= image.height) continue;
          const next = nextY * image.width + nextX;
          if (!occupied[next] || labels[next] >= 0) continue;
          labels[next] = id;
          queue[tail++] = next;
        }
      }
    }
    const area = tail;
    components.push({ id, area, minX, minY, maxX, maxY, centroidX: sumX / area, centroidY: sumY / area });
  }
  return { components: components.filter((component) => component.area >= MIN_COMPONENT_AREA), labels };
};

const splitCluster = (members, image) => {
  const cellCounts = new Array(16).fill(0);
  const cellX = new Array(16).fill(0);
  const cellY = new Array(16).fill(0);
  for (const pixel of members) {
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    const column = Math.max(0, Math.min(3, Math.floor(x / FRAME_WIDTH)));
    const row = Math.max(0, Math.min(3, Math.floor(y / FRAME_HEIGHT)));
    const cell = row * 4 + column;
    cellCounts[cell] += 1;
    cellX[cell] += x;
    cellY[cell] += y;
  }
  const seeds = cellCounts
    .map((count, cell) => ({ count, cell }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 2)
    .map(({ count, cell }) => ({ x: cellX[cell] / count, y: cellY[cell] / count }));
  const assignments = new Uint8Array(members.length);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = [{ x: 0, y: 0, count: 0 }, { x: 0, y: 0, count: 0 }];
    members.forEach((pixel, index) => {
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      const firstDistance = (x - seeds[0].x) ** 2 + (y - seeds[0].y) ** 2;
      const secondDistance = (x - seeds[1].x) ** 2 + (y - seeds[1].y) ** 2;
      const assignment = secondDistance < firstDistance ? 1 : 0;
      assignments[index] = assignment;
      sums[assignment].x += x;
      sums[assignment].y += y;
      sums[assignment].count += 1;
    });
    for (let cluster = 0; cluster < 2; cluster += 1) {
      if (sums[cluster].count === 0) continue;
      seeds[cluster].x = sums[cluster].x / sums[cluster].count;
      seeds[cluster].y = sums[cluster].y / sums[cluster].count;
    }
  }
  return [0, 1].map((cluster) => members.filter((_pixel, index) => assignments[index] === cluster));
};

const describeCluster = (members, image) => {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (const pixel of members) {
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  return { members, area: members.length, minX, minY, maxX, maxY, centroidX: sumX / members.length, centroidY: sumY / members.length };
};

const buildPixelOwners = (image, clusters) => {
  const owner = new Int16Array(image.width * image.height).fill(-1);
  const queue = new Int32Array(owner.length);
  let head = 0;
  let tail = 0;
  clusters.forEach((cluster, clusterIndex) => {
    for (const pixel of cluster.members) {
      owner[pixel] = clusterIndex;
      queue[tail++] = pixel;
    }
  });
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= image.width || nextY < 0 || nextY >= image.height) continue;
        const next = nextY * image.width + nextX;
        if (owner[next] >= 0 || image.data[next * 4 + 3] === 0) continue;
        owner[next] = owner[pixel];
        queue[tail++] = next;
      }
    }
  }
  return owner;
};

const extractSprites = (image, fileName) => {
  const { components, labels } = findComponents(image);
  const largeComponents = components.filter((component) => component.area >= 5_000);
  const selectedIds = new Set(largeComponents.map((component) => component.id));
  const membersById = new Map(largeComponents.map((component) => [component.id, []]));
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const id = labels[pixel];
    if (selectedIds.has(id)) membersById.get(id).push(pixel);
  }
  let clusters = largeComponents.map((component) => describeCluster(membersById.get(component.id), image));
  while (clusters.length < 16) {
    const largest = clusters.reduce((best, cluster, index) => cluster.area > clusters[best].area ? index : best, 0);
    const [first, second] = splitCluster(clusters[largest].members, image);
    clusters.splice(largest, 1, describeCluster(first, image), describeCluster(second, image));
  }
  clusters = [...clusters].sort((left, right) => right.area - left.area).slice(0, 16);
  if (clusters.length !== 16) throw new Error(`${fileName}: expected 16 wolf silhouettes, found ${clusters.length}`);
  const owner = buildPixelOwners(image, clusters);
  const sprites = new Array(16);

  clusters.forEach((component, componentIndex) => {
    const column = Math.max(0, Math.min(3, Math.floor(component.centroidX / FRAME_WIDTH)));
    const row = Math.max(0, Math.min(3, Math.floor(component.centroidY / FRAME_HEIGHT)));
    const frame = row * 4 + column;
    if (sprites[frame]) throw new Error(`${fileName}: two silhouettes map to frame ${frame}`);
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = component.minY; y <= component.maxY; y += 1) {
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const sourcePixel = y * image.width + x;
        if (owner[sourcePixel] !== componentIndex) continue;
        const targetPixel = (y - component.minY) * width + x - component.minX;
        image.data.copy(pixels, targetPixel * 4, sourcePixel * 4, sourcePixel * 4 + 4);
      }
    }
    sprites[frame] = { width, height, pixels };
  });
  if (sprites.some((sprite) => !sprite)) throw new Error(`${fileName}: silhouettes do not cover every frame`);
  return sprites;
};

const bilinearSample = (sprite, x, y, channel) => {
  const x0 = Math.max(0, Math.min(sprite.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(sprite.height - 1, Math.floor(y)));
  const x1 = Math.min(sprite.width - 1, x0 + 1);
  const y1 = Math.min(sprite.height - 1, y0 + 1);
  const xWeight = x - Math.floor(x);
  const yWeight = y - Math.floor(y);
  const read = (sampleX, sampleY) => sprite.pixels[(sampleY * sprite.width + sampleX) * 4 + channel];
  const top = read(x0, y0) * (1 - xWeight) + read(x1, y0) * xWeight;
  const bottom = read(x0, y1) * (1 - xWeight) + read(x1, y1) * xWeight;
  return top * (1 - yWeight) + bottom * yWeight;
};

const resizeSprite = (sprite, scale) => {
  const width = Math.max(1, Math.round(sprite.width * scale));
  const height = Math.max(1, Math.round(sprite.height * scale));
  if (width === sprite.width && height === sprite.height) return sprite;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) / scale - 0.5;
      const sourceY = (y + 0.5) / scale - 0.5;
      const alpha = bilinearSample(sprite, sourceX, sourceY, 3);
      const targetOffset = (y * width + x) * 4;
      pixels[targetOffset + 3] = Math.round(alpha);
      if (alpha <= 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[targetOffset + channel] = Math.round(bilinearSample(sprite, sourceX, sourceY, channel));
      }
    }
  }
  return { width, height, pixels };
};

const opaqueArea = (sprite) => {
  let area = 0;
  for (let pixel = 0; pixel < sprite.width * sprite.height; pixel += 1) {
    if (sprite.pixels[pixel * 4 + 3] >= ALPHA_THRESHOLD) area += 1;
  }
  return area;
};

const normalizeEastDrinkingScale = (sprites) => {
  const drinkingFrames = sprites.slice(10, 16);
  const targetArea = Math.max(...drinkingFrames.map(opaqueArea));
  return sprites.map((sprite, frame) => {
    if (frame < 10) return sprite;
    const area = opaqueArea(sprite);
    return resizeSprite(sprite, Math.sqrt(targetArea / area));
  });
};

const writeAtlas = (sourceImage, sprites, scale, direction, outputPath) => {
  const output = new PNG({ width: sourceImage.width, height: sourceImage.height, colorType: 6 });
  output.data.fill(0);
  sprites.forEach((sourceSprite, frame) => {
    const sprite = resizeSprite(sourceSprite, scale);
    const cellX = (frame % 4) * FRAME_WIDTH;
    const cellY = Math.floor(frame / 4) * FRAME_HEIGHT;
    const targetX = cellX + Math.round((FRAME_WIDTH - sprite.width) / 2);
    const targetY = cellY + (direction === 'north' ? CELL_MARGIN : FRAME_HEIGHT - CELL_MARGIN - sprite.height);
    for (let y = 0; y < sprite.height; y += 1) {
      const sourceStart = y * sprite.width * 4;
      const targetStart = ((targetY + y) * output.width + targetX) * 4;
      sprite.pixels.copy(output.data, targetStart, sourceStart, sourceStart + sprite.width * 4);
    }
  });
  writeFileSync(outputPath, PNG.sync.write(output));
};

const reports = [];
for (const direction of directions) {
  const atlases = atlasKinds.map((atlasKind) => {
    const fileName = `wolf-${direction}-${atlasKind}.png`;
    const image = PNG.sync.read(readFileSync(resolve(sourceRoot, fileName)));
    return { fileName, image, sprites: extractSprites(image, fileName) };
  });
  if (direction === 'east') {
    const actionAtlas = atlases.find((atlas) => atlas.fileName === 'wolf-east-action.png');
    if (actionAtlas) actionAtlas.sprites = normalizeEastDrinkingScale(actionAtlas.sprites);
  }
  const allSprites = atlases.flatMap((atlas) => atlas.sprites);
  const maxWidth = Math.max(...allSprites.map((sprite) => sprite.width));
  const maxHeight = Math.max(...allSprites.map((sprite) => sprite.height));
  const scale = Math.min(1, (FRAME_WIDTH - CELL_MARGIN * 2) / maxWidth, (FRAME_HEIGHT - CELL_MARGIN * 2) / maxHeight);
  for (const atlas of atlases) {
    writeAtlas(atlas.image, atlas.sprites, scale, direction, resolve(outputRoot, atlas.fileName));
  }
  reports.push(`${direction}: ${atlasKinds.length * 16} complete silhouettes, scale ${(scale * 100).toFixed(1)}%`);
}

console.log(`Repacked ${directions.length * atlasKinds.length * 16} frames into ${outputRoot}`);
for (const report of reports) console.log(report);
