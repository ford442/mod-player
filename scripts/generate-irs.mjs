#!/usr/bin/env node
/**
 * Room impulse responses for the FX rack (#453).
 *
 *   npm run gen:irs     synthesize (scripts/lib/ir-synth.mjs), encode with
 *                       ffmpeg/libopus → public/ir/{id}.opus, write
 *                       audio/fx/room/ir-manifest.generated.json
 *   npm run verify:irs  (no ffmpeg) every manifest entry's file exists with
 *                       the recorded hash/size, and its sourceHash still
 *                       matches the synth spec — i.e. nobody changed the spec
 *                       without regenerating.
 *
 * Opus encoding isn't bit-reproducible across libopus builds, so the committed
 * .opus files are the source of truth; regenerate on purpose only.
 * `sourceHash` hashes the spec + synth version, not PCM, so the check doesn't
 * depend on Math.exp agreeing to the last ulp across Node versions.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IR_IDS, IR_SPECS, IR_SYNTH_VERSION, synthIr } from './lib/ir-synth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/ir');
const MANIFEST = join(ROOT, 'audio/fx/room/ir-manifest.generated.json');
const SAMPLE_RATE = 48000;
const BITRATE = '160k';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function sourceHash(id) {
  return sha256(JSON.stringify({ v: IR_SYNTH_VERSION, sampleRate: SAMPLE_RATE, spec: IR_SPECS[id] })).slice(0, 16);
}

/** 32-bit float stereo WAV (WAVE_FORMAT_IEEE_FLOAT). */
function floatWav(channels, sampleRate) {
  const frames = channels[0].length;
  const data = Buffer.alloc(frames * channels.length * 4);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels.length; c++) data.writeFloatLE(channels[c][i], (i * channels.length + c) * 4);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(channels.length, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels.length * 4, 28);
  header.writeUInt16LE(channels.length * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function generate() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(dirname(MANIFEST), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'xasm-irs-'));
  const manifest = {};
  try {
    for (const id of IR_IDS) {
      const wav = join(tmp, `${id}.wav`);
      const file = `${id}.opus`;
      writeFileSync(wav, floatWav(synthIr(id, SAMPLE_RATE), SAMPLE_RATE));
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', wav,
        '-c:a', 'libopus', '-b:a', BITRATE, '-application', 'audio',
        '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
        join(OUT_DIR, file),
      ]);
      const bytes = readFileSync(join(OUT_DIR, file));
      manifest[id] = {
        file,
        version: sha256(bytes).slice(0, 10),
        bytes: bytes.length,
        durationSeconds: IR_SPECS[id].seconds,
        channels: 2,
        sampleRate: SAMPLE_RATE,
        sourceHash: sourceHash(id),
      };
      console.log(`✅ ${file}: ${bytes.length} bytes (${IR_SPECS[id].seconds} s)`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✅ ${MANIFEST.replace(ROOT + '/', '')}`);
}

function check() {
  const problems = [];
  if (!existsSync(MANIFEST)) {
    console.error(`❌ missing ${MANIFEST}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const id of IR_IDS) {
    const entry = manifest[id];
    if (!entry) {
      problems.push(`${id}: not in the manifest`);
      continue;
    }
    if (entry.sourceHash !== sourceHash(id)) problems.push(`${id}: synth spec changed — run npm run gen:irs`);
    const path = join(OUT_DIR, entry.file);
    if (!existsSync(path)) {
      problems.push(`${id}: ${entry.file} is missing`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== entry.bytes) problems.push(`${id}: size ${bytes.length} ≠ manifest ${entry.bytes}`);
    if (sha256(bytes).slice(0, 10) !== entry.version) problems.push(`${id}: content hash ≠ manifest version`);
    if (bytes.subarray(0, 4).toString('latin1') !== 'OggS') problems.push(`${id}: not an Ogg stream`);
  }
  for (const id of Object.keys(manifest)) if (!IR_IDS.includes(id)) problems.push(`${id}: in the manifest but not in IR_SPECS`);
  if (problems.length) {
    for (const p of problems) console.error(`❌ ${p}`);
    process.exit(1);
  }
  console.log(`verify-irs OK: ${IR_IDS.length} IRs match the manifest and the synth spec`);
}

if (process.argv.includes('--check')) check();
else generate();
