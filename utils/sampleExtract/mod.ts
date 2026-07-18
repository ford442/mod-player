import type { InstrumentTable, SampleInfo } from '../../types/instruments';
import { downsamplePeaks } from './downsample';

const MOD_TITLE_OFFSET = 0;
const MOD_SAMPLE_INFO_OFFSET = 20;
const MOD_NUM_SAMPLES = 31;
const MOD_SAMPLE_HEADER_SIZE = 30;
const MOD_SONG_LENGTH_OFFSET = 950;
const MOD_ORDER_OFFSET = 952;
const MOD_SIGNATURE_OFFSET = 1080;
const MOD_HEADER_SIZE = 1084;

/** Skip decoding when total PCM would exceed this budget (worker-side). */
export const MAX_SAMPLE_DECODE_BYTES = 32 * 1024 * 1024;

const MOD_SIGNATURES_4CH = new Set(['M.K.', 'M!K!', 'FLT4', '4CHN']);
const MOD_SIGNATURES_6CH = new Set(['6CHN']);
const MOD_SIGNATURES_8CH = new Set(['FLT8', '8CHN']);

function readAscii(data: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const byte = data[offset + i];
    if (byte === undefined || byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

function readUint16BE(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readInt8(data: Uint8Array, offset: number): number {
  const v = data[offset] ?? 0;
  return v < 128 ? v : v - 256;
}

function channelsFromSignature(sig: string): number | null {
  if (MOD_SIGNATURES_4CH.has(sig)) return 4;
  if (MOD_SIGNATURES_6CH.has(sig)) return 6;
  if (MOD_SIGNATURES_8CH.has(sig)) return 8;
  return null;
}

export function isProTrackerMod(data: Uint8Array): boolean {
  if (data.byteLength < MOD_HEADER_SIZE) return false;
  const sig = readAscii(data, MOD_SIGNATURE_OFFSET, 4);
  return channelsFromSignature(sig) !== null;
}

function sampleDataOffset(data: Uint8Array, channels: number): number {
  const songLength = data[MOD_SONG_LENGTH_OFFSET] ?? 0;
  let maxPattern = 0;
  const orderCount = Math.min(songLength, 128);
  for (let i = 0; i < orderCount; i++) {
    const pat = data[MOD_ORDER_OFFSET + i] ?? 0;
    if (pat > maxPattern) maxPattern = pat;
  }
  const numPatterns = maxPattern + 1;
  return MOD_HEADER_SIZE + numPatterns * 64 * channels * 4;
}

function readSampleHeader(data: Uint8Array, sampleIndex: number): Omit<SampleInfo, 'waveform'> {
  const base = MOD_SAMPLE_INFO_OFFSET + sampleIndex * MOD_SAMPLE_HEADER_SIZE;
  const lengthWords = readUint16BE(data, base + 22);
  const lengthBytes = lengthWords * 2;
  const loopStartWords = readUint16BE(data, base + 26);
  const loopLenWords = readUint16BE(data, base + 28);
  const loopStart = loopStartWords * 2;
  const loopEnd = loopLenWords > 0 ? loopStart + loopLenWords * 2 : 0;

  return {
    index: sampleIndex + 1,
    name: readAscii(data, base, 22).trim(),
    length: lengthBytes,
    loopStart,
    loopEnd,
    volume: data[base + 25] ?? 0,
    finetune: readInt8(data, base + 24),
    transpose: 0,
  };
}

/**
 * Extract ProTracker-style MOD sample metadata + downsampled waveforms from raw file bytes.
 */
export function extractModInstrumentTable(data: Uint8Array): InstrumentTable {
  if (!isProTrackerMod(data)) {
    return { format: 'unknown', instruments: [], samples: [] };
  }

  const sig = readAscii(data, MOD_SIGNATURE_OFFSET, 4);
  const channels = channelsFromSignature(sig);
  if (!channels) {
    return { format: 'unknown', instruments: [], samples: [] };
  }

  let pcmOffset = sampleDataOffset(data, channels);
  let decodedBytes = 0;
  const samples: SampleInfo[] = [];

  for (let i = 0; i < MOD_NUM_SAMPLES; i++) {
    const header = readSampleHeader(data, i);
    let waveform: Float32Array = new Float32Array(256);

    if (header.length > 0 && pcmOffset + header.length <= data.byteLength) {
      if (decodedBytes + header.length <= MAX_SAMPLE_DECODE_BYTES) {
        const pcm = new Int8Array(header.length);
        for (let b = 0; b < header.length; b++) {
          // ProTracker stores 8-bit samples as unsigned offset binary (128 = silence).
          pcm[b] = (data[pcmOffset + b] ?? 128) - 128;
        }
        const peaks = downsamplePeaks(pcm);
        waveform = new Float32Array(peaks);
        decodedBytes += header.length;
      }
      pcmOffset += header.length;
    }

    samples.push({ ...header, waveform });
  }

  const instruments = samples.map((sample) => ({
    index: sample.index,
    name: sample.name,
    sampleIndices: [sample.index],
    volume: sample.volume,
    samples: [sample],
  }));

  return {
    format: 'mod',
    instruments,
    samples,
  };
}

export function readModTitle(data: Uint8Array): string {
  return readAscii(data, MOD_TITLE_OFFSET, 20).trim();
}
