import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Download the CC0 originals listed in CREDITS.md into the supplied directory.
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-forest-audio.mjs /path/to/originals (requires ffmpeg)');
const output = fileURLToPath(new URL('../public/assets/audio/', import.meta.url));
const hashes = {
  'wind1.wav': 'a2856f794fbf77e05f8241dc4adeade7f62fa21c3c9dc49f7725b6c6218060c3',
  'park_ambience_river.wav': 'da0c0c9b1249a83a1611cc116d5737b0864a8db9f45f1ae8dcc079d0f7c0bbbf',
  'birds-isaiah658_0.ogg': '359e4e3f9da9d75aac64cede511c7e3ef8b461f9d9f8c230f8f80e44c4b3e35f',
  '751473_801011-hq.mp3': '94d8015169027ae21efdb88c7ed54b410cd516f9d59a9b6ac9cba0d073ae6def',
};
for (const [file, expected] of Object.entries(hashes)) {
  const hash = createHash('sha256').update(readFileSync(resolve(source, file))).digest('hex');
  if (hash !== expected) throw new Error(`Source checksum mismatch: ${file}`);
}
mkdirSync(output, { recursive: true });
const clips = [
  { key: 'forest', file: 'wind1.wav', start: 8, duration: 26, loop: true },
  { key: 'water', file: 'park_ambience_river.wav', start: 12, duration: 26, loop: true },
  { key: 'foliage', file: '751473_801011-hq.mp3', start: 35, duration: 26, loop: true },
  { key: 'gust', file: 'wind1.wav', start: 40, duration: 9 },
  ...[1, 2, 3].map((number, index) => ({ key: `bird-${number}`, file: 'birds-isaiah658_0.ogg', start: 2 + index * 9, duration: 6 })),
];
for (const clip of clips) {
  const base = `highpass=f=${clip.key === 'foliage' ? 450 : 100},lowpass=f=${clip.key === 'forest' ? 4500 : 9500},loudnorm=I=-23:TP=-3:LRA=9,aresample=22050,aformat=channel_layouts=mono`;
  // Rotate the overlap into the end of the file: middle -> tail/head crossfade -> middle.
  // Unlike a fade to silence, this retains constant energy across the playback wrap.
  const filter = clip.loop
    ? `[0:a]${base},asplit=3[a][b][c];[a]atrim=start=2:end=24,asetpts=PTS-STARTPTS[mid];[b]atrim=start=24:end=26,asetpts=PTS-STARTPTS[tail];[c]atrim=start=0:end=2,asetpts=PTS-STARTPTS[head];[tail][head]acrossfade=d=2:c1=qsin:c2=qsin[seam];[mid][seam]concat=n=2:v=0:a=1,afade=t=in:d=0.005,afade=t=out:st=23.995:d=0.005[out]`
    : `[0:a]${base},afade=t=in:d=0.6,afade=t=out:st=${clip.duration - 1.2}:d=1.2[out]`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(clip.start), '-t', String(clip.duration),
    '-i', resolve(source, clip.file), '-filter_complex', filter, '-map', '[out]', '-ar', '22050', '-ac', '1',
    '-c:a', 'pcm_s16le', resolve(output, `${clip.key}.wav`)], { stdio: 'inherit' });
}
console.log(`Built ${clips.length} nature clips (22.05 kHz mono PCM).`);
