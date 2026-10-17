import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

const root = resolve(import.meta.dirname, '..');
const assets = [
  { source: 'public/assets/ground-base-v2.png', output: 'public/assets/ground-base-v3.png' },
  { source: 'public/assets/terrain-tiles-v2.png', output: 'public/assets/terrain-tiles-v3.png' },
  { source: 'public/assets/terrain-overlays-v2.png', output: 'public/assets/terrain-overlays-v3.png' },
  { source: 'public/assets/obstacle-atlas-v2.png', output: 'public/assets/obstacle-atlas-v3.png' },
  {
    source: 'public/assets/terrain-features-v3.png',
    output: 'public/assets/terrain-features-v4.png',
    mirrors: ['art-source/terrain-v4/terrain-features-source.png'],
  },
  { source: 'public/assets/water-tiles-v2.png', output: 'public/assets/water-tiles-v3.png' },
  { source: 'public/assets/forest-world.png', output: 'public/assets/forest-world-v2.png' },
];

const SATURATION = 0.68;
const CONTRAST = 0.92;
const BRIGHTNESS = 0.96;

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

const quietChannel = (channel, luma) => {
  const desaturated = luma + (channel - luma) * SATURATION;
  return clampByte(((desaturated - 128) * CONTRAST + 128) * BRIGHTNESS);
};

for (const asset of assets) {
  const sourcePath = resolve(root, asset.source);
  const source = PNG.sync.read(readFileSync(sourcePath));
  const output = new PNG({ width: source.width, height: source.height, colorType: source.colorType });

  for (let offset = 0; offset < source.data.length; offset += 4) {
    const red = source.data[offset];
    const green = source.data[offset + 1];
    const blue = source.data[offset + 2];
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    output.data[offset] = quietChannel(red, luma);
    output.data[offset + 1] = quietChannel(green, luma);
    output.data[offset + 2] = quietChannel(blue, luma);
    output.data[offset + 3] = source.data[offset + 3];
  }

  const encoded = PNG.sync.write(output, { colorType: source.colorType });
  const destinations = [asset.output, ...(asset.mirrors ?? [])];
  for (const destination of destinations) {
    const destinationPath = resolve(root, destination);
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, encoded);
  }
  console.log(`${asset.source} -> ${asset.output} (${source.width}x${source.height})`);
}
