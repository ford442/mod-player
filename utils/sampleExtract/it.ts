import type { InstrumentInfo, InstrumentTable, SampleInfo } from '../../types/instruments';
import { WAVEFORM_POINTS } from '../../types/instruments';
import { downsamplePeaks } from './downsample';
import { MAX_SAMPLE_DECODE_BYTES } from './mod';

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

function readInt8Signed(byte: number): number {
  return byte < 128 ? byte : byte - 256;
}

export function isItModule(data: Uint8Array): boolean {
  if (data.byteLength < 0x30) return false;
  return (
    data[0] === 0x49 &&
    data[1] === 0x4d &&
    data[2] === 0x50 &&
    data[3] === 0x4d
  ); // IMPM
}

/**
 * IT214/IT215 bit-packed sample decompression (Schism/OpenMPT compatible).
 * Returns signed PCM frames as Int8Array or Int16Array.
 */
export function decompressItSample(
  data: Uint8Array,
  offset: number,
  compressedSize: number,
  numFrames: number,
  is16Bit: boolean,
  it215: boolean,
): Int8Array | Int16Array | null {
  if (offset + compressedSize > data.byteLength || numFrames <= 0) return null;

  const end = offset + compressedSize;
  let bitPos = offset * 8;

  const readBits = (n: number): number => {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byteIndex = bitPos >> 3;
      if (byteIndex >= end) return value;
      const bit = (data[byteIndex]! >> (bitPos & 7)) & 1;
      value |= bit << i;
      bitPos++;
    }
    return value;
  };

  if (is16Bit) {
    const out = new Int16Array(numFrames);
    let bitWidth = 17;
    let destPos = 0;

    while (destPos < numFrames) {
      let blockSize = Math.min(0x4000, numFrames - destPos);
      // Read bit width changes within block
      while (blockSize > 0) {
        if (bitWidth > 17 || bitWidth < 1) return null;

        if (bitWidth <= 6) {
          // Method A: short samples
          while (blockSize > 0) {
            let value = readBits(bitWidth);
            const border = (1 << (bitWidth - 1)) - 1;
            if (value === border) {
              // Change bit width
              const newWidth = readBits(4) + 1;
              bitWidth = newWidth < bitWidth ? newWidth : newWidth + 1;
              break;
            }
            // Sign-extend
            if (value & (1 << (bitWidth - 1))) {
              value |= ~((1 << bitWidth) - 1);
            }
            out[destPos++] = value;
            blockSize--;
            if (destPos >= numFrames) break;
          }
        } else if (bitWidth < 17) {
          while (blockSize > 0) {
            let value = readBits(bitWidth);
            const border = (0xffff >> (17 - bitWidth)) - 1;
            if (value > border) {
              const newWidth = (value - (border + 1) + 1) & 0x0f;
              bitWidth = newWidth < bitWidth ? newWidth : newWidth + 1;
              break;
            }
            if (value & (1 << (bitWidth - 1))) {
              value |= ~((1 << bitWidth) - 1);
            }
            out[destPos++] = value;
            blockSize--;
            if (destPos >= numFrames) break;
          }
        } else {
          // bitWidth === 17: raw
          while (blockSize > 0) {
            let value = readBits(16);
            if (value & 0x8000) value |= ~0xffff;
            out[destPos++] = value;
            blockSize--;
            if (destPos >= numFrames) break;
          }
        }
      }
    }

    // Integrate deltas
    let old = 0;
    let old2 = 0;
    for (let i = 0; i < numFrames; i++) {
      let v = out[i]! + old;
      out[i] = v;
      if (it215) {
        v += old2;
        out[i] = v;
        old2 = old;
      }
      old = out[i]!;
    }
    return out;
  }

  // 8-bit path
  const out = new Int8Array(numFrames);
  let destPos = 0;
  let bitWidth = 9;

  while (destPos < numFrames) {
    let blockSize = Math.min(0x8000, numFrames - destPos);
    while (blockSize > 0) {
      if (bitWidth > 9 || bitWidth < 1) return null;

      if (bitWidth < 7) {
        while (blockSize > 0) {
          let value = readBits(bitWidth);
          const border = (1 << (bitWidth - 1)) - 1;
          if (value === border) {
            const newWidth = readBits(3) + 1;
            bitWidth = newWidth < bitWidth ? newWidth : newWidth + 1;
            break;
          }
          if (value & (1 << (bitWidth - 1))) {
            value |= ~((1 << bitWidth) - 1);
          }
          out[destPos++] = value;
          blockSize--;
          if (destPos >= numFrames) break;
        }
      } else if (bitWidth < 9) {
        while (blockSize > 0) {
          let value = readBits(bitWidth);
          const border = (0xff >> (9 - bitWidth)) - 1;
          if (value > border) {
            const newWidth = (value - (border + 1) + 1) & 0x07;
            bitWidth = newWidth < bitWidth ? newWidth : newWidth + 1;
            break;
          }
          if (value & (1 << (bitWidth - 1))) {
            value |= ~((1 << bitWidth) - 1);
          }
          out[destPos++] = value;
          blockSize--;
          if (destPos >= numFrames) break;
        }
      } else {
        while (blockSize > 0) {
          let value = readBits(8);
          if (value & 0x80) value |= ~0xff;
          out[destPos++] = value;
          blockSize--;
          if (destPos >= numFrames) break;
        }
      }
    }
  }

  let old = 0;
  let old2 = 0;
  for (let i = 0; i < numFrames; i++) {
    let v = out[i]! + old;
    out[i] = ((v + 128) & 0xff) - 128;
    if (it215) {
      v = out[i]! + old2;
      out[i] = ((v + 128) & 0xff) - 128;
      old2 = old;
    }
    old = out[i]!;
  }
  return out;
}

function decodeUncompressedItPcm(
  data: Uint8Array,
  offset: number,
  numFrames: number,
  is16Bit: boolean,
  signed: boolean,
): Int8Array | Int16Array | null {
  if (is16Bit) {
    if (offset + numFrames * 2 > data.byteLength) return null;
    const out = new Int16Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      let v = readUint16LE(data, offset + i * 2);
      if (!signed) v = (v - 0x8000) & 0xffff;
      if (v >= 0x8000) v -= 0x10000;
      out[i] = v;
    }
    return out;
  }
  if (offset + numFrames > data.byteLength) return null;
  const out = new Int8Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    let v = data[offset + i] ?? 0;
    if (!signed) v = (v - 128) & 0xff;
    out[i] = readInt8Signed(v & 0xff);
  }
  return out;
}

export function extractItInstrumentTable(data: Uint8Array): InstrumentTable {
  if (!isItModule(data)) {
    return { format: 'unknown', instruments: [], samples: [] };
  }

  const ordNum = readUint16LE(data, 0x20);
  const insNum = readUint16LE(data, 0x22);
  const smpNum = readUint16LE(data, 0x24);
  const patNum = readUint16LE(data, 0x26);
  const flags = readUint16LE(data, 0x2c);
  const useInstruments = (flags & 0x04) !== 0;
  const cmwt = readUint16LE(data, 0x2a); // compatible with version

  let offset = 0xc0; // 192
  offset += ordNum;
  const insParas = offset;
  offset += insNum * 4;
  const smpParas = offset;
  offset += smpNum * 4;
  // pat paras follow but we don't need them for sample extract
  void patNum;
  void offset;

  const samples: SampleInfo[] = [];
  let decodedBytes = 0;

  for (let s = 0; s < smpNum; s++) {
    const hdrOff = readUint32LE(data, smpParas + s * 4);
    if (hdrOff === 0 || hdrOff + 0x50 > data.byteLength) {
      samples.push({
        index: s + 1,
        name: '',
        length: 0,
        loopStart: 0,
        loopEnd: 0,
        volume: 0,
        finetune: 0,
        transpose: 0,
        waveform: new Float32Array(WAVEFORM_POINTS),
      });
      continue;
    }

    const magic = readAscii(data, hdrOff, 4);
    if (magic !== 'IMPS') {
      samples.push({
        index: s + 1,
        name: '',
        length: 0,
        loopStart: 0,
        loopEnd: 0,
        volume: 0,
        finetune: 0,
        transpose: 0,
        waveform: new Float32Array(WAVEFORM_POINTS),
      });
      continue;
    }

    const sampleFlags = data[hdrOff + 0x12] ?? 0;
    const volume = data[hdrOff + 0x13] ?? 0;
    const name = readAscii(data, hdrOff + 0x14, 26);
    const cvt = data[hdrOff + 0x2e] ?? 0;
    const length = readUint32LE(data, hdrOff + 0x30);
    const loopBegin = readUint32LE(data, hdrOff + 0x34);
    const loopEnd = readUint32LE(data, hdrOff + 0x38);
    const samplePtr = readUint32LE(data, hdrOff + 0x48);

    const hasData = (sampleFlags & 0x01) !== 0;
    const is16Bit = (sampleFlags & 0x02) !== 0;
    const isCompressed = (sampleFlags & 0x08) !== 0;
    const signed = (cvt & 0x01) !== 0;
    // IT215 uses convert bit 4 on some docs; cmwt >= 0x215 is safer signal
    const it215 = cmwt >= 0x215 || (cvt & 0x04) !== 0;

    let waveform: Float32Array = new Float32Array(WAVEFORM_POINTS);
    const frameBytes = is16Bit ? 2 : 1;
    const pcmBytes = length * frameBytes;

    if (hasData && length > 0 && samplePtr > 0 && samplePtr < data.byteLength) {
      if (decodedBytes + pcmBytes <= MAX_SAMPLE_DECODE_BYTES) {
        let pcm: Int8Array | Int16Array | null = null;
        if (isCompressed) {
          // Compressed size is unknown a priori; use remaining file as upper bound
          const maxComp = data.byteLength - samplePtr;
          pcm = decompressItSample(data, samplePtr, maxComp, length, is16Bit, it215);
        } else {
          // Cvt bit0 = signed; older modules may omit it — treat as signed (IT default for Cvt=1).
          pcm = decodeUncompressedItPcm(data, samplePtr, length, is16Bit, signed);
        }
        if (pcm) {
          const peaks = downsamplePeaks(pcm);
          waveform = new Float32Array(peaks);
          decodedBytes += pcmBytes;
        }
      }
    }

    const doesLoop = (sampleFlags & 0x10) !== 0;

    samples.push({
      index: s + 1,
      name,
      length: pcmBytes,
      loopStart: doesLoop ? loopBegin * frameBytes : 0,
      loopEnd: doesLoop ? loopEnd * frameBytes : 0,
      volume,
      finetune: 0,
      transpose: 0,
      waveform,
    });
  }

  const instruments: InstrumentInfo[] = [];

  if (useInstruments && insNum > 0) {
    for (let i = 0; i < insNum; i++) {
      const hdrOff = readUint32LE(data, insParas + i * 4);
      if (hdrOff === 0 || hdrOff + 0x40 > data.byteLength) {
        instruments.push({ index: i + 1, name: '', sampleIndices: [], samples: [] });
        continue;
      }
      const magic = readAscii(data, hdrOff, 4);
      if (magic !== 'IMPI') {
        instruments.push({ index: i + 1, name: '', sampleIndices: [], samples: [] });
        continue;
      }
      const name = readAscii(data, hdrOff + 0x20, 26);
      const linked = new Set<number>();
      // Keyboard table at +0x40: 120 pairs (note, sample)
      for (let n = 0; n < 120; n++) {
        const sampleNo = data[hdrOff + 0x40 + n * 2 + 1] ?? 0;
        if (sampleNo > 0 && sampleNo <= samples.length) linked.add(sampleNo);
      }
      const sampleIndices = [...linked].sort((a, b) => a - b);
      instruments.push({
        index: i + 1,
        name,
        sampleIndices,
        samples: sampleIndices
          .map((idx) => samples[idx - 1])
          .filter((x): x is SampleInfo => x !== undefined),
      });
    }
  } else {
    // Sample-mode IT: 1:1 instruments
    for (const sample of samples) {
      instruments.push({
        index: sample.index,
        name: sample.name,
        sampleIndices: [sample.index],
        volume: sample.volume,
        samples: [sample],
      });
    }
  }

  return { format: 'it', instruments, samples };
}
