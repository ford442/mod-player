import type { InstrumentInfo, InstrumentTable, SampleInfo } from '../../types/instruments';
import { WAVEFORM_POINTS } from '../../types/instruments';
import { downsamplePeaks } from './downsample';
import { MAX_SAMPLE_DECODE_BYTES } from './mod';

const XM_ID = 'Extended Module: ';
const XM_HEADER_BASE = 60;

function readAscii(data: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const byte = data[offset + i];
    if (byte === undefined || byte === 0) break;
    if (byte >= 32 && byte < 127) out += String.fromCharCode(byte);
  }
  return out.trim();
}

function readUint16LE(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function readInt8(data: Uint8Array, offset: number): number {
  const v = data[offset] ?? 0;
  return v < 128 ? v : v - 256;
}

function verifyXmId(data: Uint8Array): boolean {
  if (data.byteLength < 38) return false;
  for (let i = 0; i < XM_ID.length; i++) {
    if (data[i] !== XM_ID.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Delta-decode XM sample data into signed PCM for downsampling.
 * 8-bit: Int8Array; 16-bit little-endian: Int16Array (length = byteLength/2).
 */
export function decodeXmDeltaPcm(
  data: Uint8Array,
  offset: number,
  byteLength: number,
  is16Bit: boolean,
): Int8Array | Int16Array {
  if (is16Bit) {
    const frames = Math.floor(byteLength / 2);
    const out = new Int16Array(frames);
    let old = 0;
    for (let i = 0; i < frames; i++) {
      const lo = data[offset + i * 2] ?? 0;
      const hi = data[offset + i * 2 + 1] ?? 0;
      let delta = lo | (hi << 8);
      if (delta >= 0x8000) delta -= 0x10000;
      old = (old + delta) | 0;
      // Clamp to int16
      out[i] = old > 32767 ? 32767 : old < -32768 ? -32768 : old;
    }
    return out;
  }

  const out = new Int8Array(byteLength);
  let old = 0;
  for (let i = 0; i < byteLength; i++) {
    let delta = data[offset + i] ?? 0;
    if (delta >= 128) delta -= 256;
    old = (old + delta) | 0;
    // Keep low 8 bits as signed
    out[i] = ((old + 128) & 0xff) - 128;
  }
  return out;
}

export function extractXmInstrumentTable(data: Uint8Array): InstrumentTable {
  if (!verifyXmId(data) || data.byteLength < XM_HEADER_BASE + 20) {
    return { format: 'unknown', instruments: [], samples: [] };
  }

  const headerSize = readUint32LE(data, XM_HEADER_BASE);
  if (headerSize < 20 || XM_HEADER_BASE + headerSize > data.byteLength) {
    return { format: 'unknown', instruments: [], samples: [] };
  }

  const numPatterns = readUint16LE(data, 70);
  const numInstruments = readUint16LE(data, 72);
  let offset = XM_HEADER_BASE + headerSize;

  // Skip pattern blocks
  for (let p = 0; p < numPatterns; p++) {
    if (offset + 9 > data.byteLength) {
      return { format: 'unknown', instruments: [], samples: [] };
    }
    const patHeaderSize = readUint32LE(data, offset);
    const packedSize = readUint16LE(data, offset + 7);
    if (patHeaderSize < 9) {
      return { format: 'unknown', instruments: [], samples: [] };
    }
    offset += patHeaderSize + packedSize;
    if (offset > data.byteLength) {
      return { format: 'unknown', instruments: [], samples: [] };
    }
  }

  const instruments: InstrumentInfo[] = [];
  const samples: SampleInfo[] = [];
  let decodedBytes = 0;
  let globalSampleIndex = 0;

  for (let i = 0; i < numInstruments; i++) {
    if (offset + 29 > data.byteLength) break;

    const instHeaderSize = readUint32LE(data, offset);
    if (instHeaderSize < 29 || offset + instHeaderSize > data.byteLength) break;

    const instName = readAscii(data, offset + 4, 22);
    const numSamples = readUint16LE(data, offset + 27);

    const sampleMap = new Set<number>();
    let sampleHeaderSize = 40;
    if (numSamples > 0 && instHeaderSize >= 33) {
      sampleHeaderSize = readUint32LE(data, offset + 29);
      if (sampleHeaderSize < 40) sampleHeaderSize = 40;
      // Keymap: 96 bytes at offset+33 → sample numbers 0-based within instrument
      if (instHeaderSize >= 33 + 96) {
        for (let k = 0; k < 96; k++) {
          const s = data[offset + 33 + k] ?? 0;
          if (s > 0 && s <= numSamples) sampleMap.add(s);
        }
      }
    }

    const instSamples: SampleInfo[] = [];
    const sampleIndices: number[] = [];
    let cursor = offset + instHeaderSize;

    // Read sample headers
    type Hdr = {
      length: number;
      loopStart: number;
      loopLength: number;
      volume: number;
      finetune: number;
      type: number;
      relativeNote: number;
      name: string;
    };
    const headers: Hdr[] = [];

    for (let s = 0; s < numSamples; s++) {
      if (cursor + sampleHeaderSize > data.byteLength) break;
      const length = readUint32LE(data, cursor);
      const loopStart = readUint32LE(data, cursor + 4);
      const loopLength = readUint32LE(data, cursor + 8);
      const volume = data[cursor + 12] ?? 0;
      const finetune = readInt8(data, cursor + 13);
      const type = data[cursor + 14] ?? 0;
      const relativeNote = readInt8(data, cursor + 16);
      const name = readAscii(data, cursor + 18, 22);
      headers.push({ length, loopStart, loopLength, volume, finetune, type, relativeNote, name });
      cursor += sampleHeaderSize;
    }

    // Sample PCM follows headers in order
    for (let s = 0; s < headers.length; s++) {
      const h = headers[s]!;
      globalSampleIndex += 1;
      const is16Bit = (h.type & 0x10) !== 0;
      const loopEnd = h.loopLength > 0 ? h.loopStart + h.loopLength : 0;
      let waveform: Float32Array = new Float32Array(WAVEFORM_POINTS);

      if (h.length > 0 && cursor + h.length <= data.byteLength) {
        if (decodedBytes + h.length <= MAX_SAMPLE_DECODE_BYTES) {
          const pcm = decodeXmDeltaPcm(data, cursor, h.length, is16Bit);
          const peaks = downsamplePeaks(pcm);
          waveform = new Float32Array(peaks);
          decodedBytes += h.length;
        }
        cursor += h.length;
      } else if (h.length > 0) {
        // Truncated — skip remaining
        break;
      }

      const sample: SampleInfo = {
        index: globalSampleIndex,
        name: h.name,
        length: h.length,
        loopStart: h.loopStart,
        loopEnd,
        volume: h.volume,
        finetune: h.finetune,
        transpose: h.relativeNote,
        waveform,
      };
      samples.push(sample);
      instSamples.push(sample);
      sampleIndices.push(globalSampleIndex);
    }

    // If keymap empty, all instrument samples are linked
    const linked =
      sampleMap.size > 0
        ? [...sampleMap]
            .sort((a, b) => a - b)
            .map((local) => sampleIndices[local - 1])
            .filter((x): x is number => x !== undefined)
        : sampleIndices;

    instruments.push({
      index: i + 1,
      name: instName,
      sampleIndices: linked.length ? linked : sampleIndices,
      samples: instSamples,
    });

    offset = cursor;
  }

  return { format: 'xm', instruments, samples };
}
