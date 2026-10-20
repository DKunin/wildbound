// Rebuild with: node scripts/build-animal-audio.mjs /path/to/downloaded/sources
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve('public/assets/audio/animals');
mkdirSync(root, { recursive: true });
const sources = [
  ['wolf', 'mp3', 'b7628ba96ae11d5ba819fe801fee2a2337e885abca0fb649260793c9b4b3446e'],
  ['deer', 'mp3', 'd628ec9d08016638b70c38decc36d16d524595c0246355bb295539eebdb1e684'],
  ['elk', 'mp3', 'e51f21daa35f68ff6c570244e3b22532be5280704b0cdcb53baa30f01559d616'],
  ['rabbit', 'mp3', 'a858c0375eac0807f773366e5d4c8dc260bdb38b2427999b63b03a8b81a4bd40'],
  ['boar', 'ogg', '14b874678ef92e52168e1b96da4aee08e3c7e259d06337dd098e1eacaa25b370'],
];
if (!process.argv[2]) throw Error('Pass the source directory; see animals/CREDITS.md.');
for (const [name, extension, hash] of sources) {
  const path = resolve(process.argv[2], `${name}.${extension}`);
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw Error(`Source hash mismatch: ${name}`);
  // Exclude the deer's opening speech-like transient; retain a bounded call excerpt.
  const excerpt = name === 'deer' ? ['-ss', '3', '-t', '8'] : [];
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path, ...excerpt, '-af',
    'highpass=f=85,lowpass=f=9000,silenceremove=start_periods=1:start_threshold=-42dB,loudnorm=I=-22:TP=-3:LRA=9,afade=t=in:d=0.01,areverse,afade=t=in:d=0.04,areverse',
    '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', `${root}/${name}-call.wav`]);
}

// Recorded paws and hooves on grass, plus recorded small-animal ground Foley.
// No oscillators, synthetic impact transients, or human boot steps.
const stepSources = {
  paws: '443a9a2e2c924283aad68b8c220c17424c95e44f298e715b4d338196f9f7eb40',
  hooves: 'ff6137b74afae2441d1d7c83aacaaaa2f093324812467e42e1fda661a462666a',
  'small-animal': '3bfda19af98bc904a97c86d51bb1e0dab3d04799ac19cc09246772d64a0ba657',
};
for (const [name, hash] of Object.entries(stepSources)) {
  const bytes = readFileSync(resolve(process.argv[2], `${name}.mp3`));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Step source hash mismatch: ${name}`);
}
const profiles = {
  wolf: { source: 'paws', starts: [3.34, 3.76, 4.12], duration: .31, pitch: 1, peak: .3, cutoff: 7500 },
  rabbit: { source: 'small-animal', starts: [.27, 3.22, 8.84], duration: .42, pitch: 1.12, peak: .22, cutoff: 8000 },
  deer: { source: 'hooves', starts: [.22, 1.22, 2.00], duration: .32, pitch: 1.12, peak: .32, cutoff: 8000 },
  elk: { source: 'hooves', starts: [.60, 1.56, 2.84], duration: .34, pitch: .9, peak: .4, cutoff: 6500 },
  boar: { source: 'hooves', starts: [.22, 1.56, 2.58], duration: .34, pitch: .97, peak: .33, cutoff: 5500 },
};
for (const [species, profile] of Object.entries(profiles)) {
  for (const [index, start] of profile.starts.entries()) {
    const rate = 22050;
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', resolve(process.argv[2], `${profile.source}.mp3`),
      '-af',
      `atrim=start=${start}:duration=${profile.duration},asetpts=PTS-STARTPTS,highpass=f=100,lowpass=f=${profile.cutoff},aresample=${rate},asetrate=${Math.round(rate * profile.pitch)},aresample=${rate}`,
      '-ac', '1', '-f', 'f32le', '-']);
    const samples = pcm.length / 4;
    let peak = 0;
    for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(pcm.readFloatLE(i * 4)));
    if (peak < .0001) throw Error(`Empty step excerpt: ${species}/${index + 1}`);
    // Peak-normalize each isolated step without crushing its natural ground texture.
    const gain = profile.peak / peak;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) {
      const fade = Math.min(1, i / (rate * .005), (samples - 1 - i) / (rate * .025));
      const value = pcm.readFloatLE(i * 4) * gain * fade;
      wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
    }
    writeFileSync(`${root}/${species}-step-${index + 1}.wav`, wav);
  }
}
console.log('Built 5 calls/signals and 15 recorded movement excerpts.');
