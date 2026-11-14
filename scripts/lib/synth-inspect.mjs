/**
 * Deterministic fixtures for the module-inspection shim (wasm/xasm_inspect.cpp,
 * tests/wasm/moduleInspect.test.ts): a ProTracker MOD, a multi-sample-instrument XM with envelopes
 * and a keymap split, and an S3M with two samples. Every header value the test checks is written
 * from the exported SPEC objects, so the test asserts against what the synth wrote — not against
 * what libopenmpt happens to return.
 */

const enc = new TextEncoder();

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return buf;
}
const str = (s, n) => { const b = new Uint8Array(n); b.set(enc.encode(s).subarray(0, n)); return b; };
const u16le = (v) => Uint8Array.of(v & 255, (v >> 8) & 255);
const u32le = (v) => Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
const u16be = (v) => Uint8Array.of((v >> 8) & 255, v & 255);

/** A full-scale 8-bit sine of `frames` frames (period 64 frames): peaks ±127/128. */
function sine8(frames) {
  const out = new Int8Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.round(127 * Math.sin((2 * Math.PI * i) / 64));
  return out;
}
/** A 16-bit ramp from −16384 to +16383 over `frames` frames (monotonic: peaks are predictable). */
function ramp16(frames) {
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.round(-16384 + (32767 * i) / Math.max(1, frames - 1));
  return out;
}

// ── MOD ──────────────────────────────────────────────────────────────

/** Samples 1..3 of `synthInspectMod()` (the other 28 are empty). Lengths / loops in frames (8-bit). */
export const MOD_SPEC = Object.freeze({
  channels: 4,
  samples: Object.freeze([
    { name: 'mod sine looped', frames: 2048, loopStart: 512, loopLength: 1024, volume: 48, finetune: 3 },
    { name: 'mod one-shot', frames: 1000, loopStart: 0, loopLength: 0, volume: 64, finetune: -2 },
    { name: 'mod name only', frames: 0, loopStart: 0, loopLength: 0, volume: 0, finetune: 0 },
  ]),
});

export function synthInspectMod() {
  const parts = [str('inspect mod', 20)];
  for (let i = 0; i < 31; i++) {
    const s = MOD_SPEC.samples[i];
    const h = new Uint8Array(30);
    if (s) {
      h.set(str(s.name, 22), 0);
      h.set(u16be(s.frames >> 1), 22);
      h[24] = s.finetune & 0x0f;
      h[25] = s.volume;
      h.set(u16be(s.loopStart >> 1), 26);
      h.set(u16be(s.loopLength > 0 ? s.loopLength >> 1 : 1), 28);
    } else {
      h.set(u16be(1), 28);
    }
    parts.push(h);
  }
  const orders = new Uint8Array(128);
  parts.push(Uint8Array.of(1, 127), orders, enc.encode('M.K.'));
  const pattern = new Uint8Array(64 * MOD_SPEC.channels * 4);
  // Row 0: C-2 (period 428) with sample 1 on channel 0, sample 2 on channel 1.
  pattern.set([0x01, 0xac, 0x00, 0x00], 0);
  pattern.set([0x01, 0xac, 0x20, 0x00], 4);
  parts.push(pattern);
  for (const s of MOD_SPEC.samples) if (s.frames) parts.push(new Uint8Array(sine8(s.frames).buffer));
  return concat(parts);
}

// ── XM ───────────────────────────────────────────────────────────────

/**
 * `synthInstrumentXm()`: instrument 1 has two samples split across the keyboard, a volume envelope
 * (sustain + loop) and a panning envelope; instrument 2 one sample and no envelope. XM keeps samples
 * per instrument; libopenmpt numbers them globally in instrument order (1, 2, then 3).
 * Lengths / loops in frames.
 */
export const XM_SPEC = Object.freeze({
  channels: 2,
  instruments: Object.freeze([
    {
      name: 'split keys',
      // XM keymap: 96 entries, one per note C-0..B-7, local sample index. Notes below `splitNote`
      // (0-based key index) play local sample 0, the rest local sample 1.
      splitNote: 48,
      volumeEnvelope: { points: [[0, 64], [10, 48], [30, 32], [60, 0]], sustain: 1, loopStart: 1, loopEnd: 2, flags: 0x01 | 0x02 | 0x04 },
      panningEnvelope: { points: [[0, 32], [20, 64]], sustain: 0, loopStart: 0, loopEnd: 0, flags: 0x01 },
      fadeOut: 512,
      samples: [
        { name: 'low sine 8-bit', frames: 4096, loopStart: 1024, loopLength: 2048, loopType: 1, is16Bit: false, volume: 40, finetune: -16, relativeNote: 12, pan: 64 },
        { name: 'high ramp 16-bit', frames: 3000, loopStart: 0, loopLength: 3000, loopType: 2, is16Bit: true, volume: 64, finetune: 8, relativeNote: -5, pan: 200 },
      ],
    },
    {
      name: 'plain',
      splitNote: 96,
      volumeEnvelope: null,
      panningEnvelope: null,
      fadeOut: 0,
      samples: [
        { name: 'plain one-shot', frames: 777, loopStart: 0, loopLength: 0, loopType: 0, is16Bit: false, volume: 20, finetune: 0, relativeNote: 0, pan: 128 },
      ],
    },
  ]),
});

function xmSampleBytes(s) {
  const pcm = s.is16Bit ? ramp16(s.frames) : sine8(s.frames);
  const delta = s.is16Bit ? new Int16Array(s.frames) : new Int8Array(s.frames);
  let prev = 0;
  for (let i = 0; i < s.frames; i++) {
    const d = pcm[i] - prev;
    delta[i] = s.is16Bit ? (d << 16) >> 16 : (d << 24) >> 24;
    prev = pcm[i];
  }
  return new Uint8Array(delta.buffer);
}

function xmEnvelope(dv, at, env) {
  if (!env) return;
  env.points.forEach(([tick, value], i) => {
    dv.setUint16(at + 4 * i, tick, true);
    dv.setUint16(at + 4 * i + 2, value, true);
  });
}

export function synthInstrumentXm() {
  const { channels } = XM_SPEC;
  const parts = [];
  parts.push(str('Extended Module: ', 17), str('inspect xm', 20), Uint8Array.of(0x1a), str('synth', 20), u16le(0x0104));
  const order = new Uint8Array(256);
  parts.push(u32le(276), u16le(1), u16le(0), u16le(channels), u16le(1), u16le(XM_SPEC.instruments.length), u16le(1), u16le(6), u16le(125), order);

  const rows = 16;
  const cells = new Uint8Array(rows * channels * 5);
  cells.set([25, 1, 0, 0, 0], 0); // C-2, instrument 1 (low split)
  cells.set([73, 1, 0, 0, 0], 5); // C-6, instrument 1 (high split)
  cells.set([49, 2, 0, 0, 0], 4 * channels * 5); // C-4, instrument 2
  parts.push(u32le(9), Uint8Array.of(0), u16le(rows), u16le(cells.length), cells);

  for (const ins of XM_SPEC.instruments) {
    const hdr = new Uint8Array(263);
    const dv = new DataView(hdr.buffer);
    dv.setUint32(0, 263, true);
    hdr.set(str(ins.name, 22), 4);
    dv.setUint16(27, ins.samples.length, true);
    dv.setUint32(29, 40, true);
    for (let k = 0; k < 96; k++) hdr[33 + k] = k < ins.splitNote ? 0 : Math.min(1, ins.samples.length - 1);
    xmEnvelope(dv, 129, ins.volumeEnvelope);
    xmEnvelope(dv, 177, ins.panningEnvelope);
    hdr[225] = ins.volumeEnvelope?.points.length ?? 0;
    hdr[226] = ins.panningEnvelope?.points.length ?? 0;
    hdr[227] = ins.volumeEnvelope?.sustain ?? 0;
    hdr[228] = ins.volumeEnvelope?.loopStart ?? 0;
    hdr[229] = ins.volumeEnvelope?.loopEnd ?? 0;
    hdr[230] = ins.panningEnvelope?.sustain ?? 0;
    hdr[231] = ins.panningEnvelope?.loopStart ?? 0;
    hdr[232] = ins.panningEnvelope?.loopEnd ?? 0;
    hdr[233] = ins.volumeEnvelope?.flags ?? 0;
    hdr[234] = ins.panningEnvelope?.flags ?? 0;
    dv.setUint16(239, ins.fadeOut, true);
    parts.push(hdr);
    const datas = [];
    for (const s of ins.samples) {
      const bps = s.is16Bit ? 2 : 1;
      const sh = new Uint8Array(40);
      const sdv = new DataView(sh.buffer);
      sdv.setUint32(0, s.frames * bps, true);
      sdv.setUint32(4, s.loopStart * bps, true);
      sdv.setUint32(8, s.loopLength * bps, true);
      sh[12] = s.volume;
      sdv.setInt8(13, s.finetune);
      sh[14] = s.loopType | (s.is16Bit ? 0x10 : 0);
      sh[15] = s.pan;
      sdv.setInt8(16, s.relativeNote);
      sh.set(str(s.name, 22), 18);
      parts.push(sh);
      datas.push(xmSampleBytes(s));
    }
    parts.push(...datas);
  }
  return concat(parts);
}

// ── S3M ──────────────────────────────────────────────────────────────

/** Two S3M samples (8-bit unsigned in the file). Lengths / loops in frames. */
export const S3M_SPEC = Object.freeze({
  samples: Object.freeze([
    { name: 's3m looped', file: 'LOOP.SMP', frames: 1200, loopStart: 200, loopEnd: 1000, loop: true, volume: 50, c2spd: 16726 },
    { name: 's3m one-shot', file: 'SHOT.SMP', frames: 640, loopStart: 0, loopEnd: 0, loop: false, volume: 64, c2spd: 8363 },
  ]),
});

export function synthSampleS3m() {
  const rows = 64;
  const pat = [];
  for (let r = 0; r < rows; r++) {
    if (r === 0) pat.push(0x20, 0x40, 1); // ch 0: C-4, sample 1
    if (r === 8) pat.push(0x20 | 1, 0x40, 2); // ch 1: C-4, sample 2
    pat.push(0);
  }
  const patBytes = concat([u16le(pat.length + 2), Uint8Array.from(pat)]);
  const nSmp = S3M_SPEC.samples.length;
  const ordNum = 2;
  const headerLen = 0x60 + ordNum + 2 * nSmp + 2;
  const headerParas = Math.ceil(headerLen / 16);
  const smpHdrPara = headerParas;
  const patPara = smpHdrPara + nSmp * 5; // 80-byte sample headers = 5 paragraphs each
  const patParas = Math.ceil(patBytes.length / 16);
  let dataPara = patPara + patParas;

  const header = new Uint8Array(headerParas * 16);
  const dv = new DataView(header.buffer);
  header.set(str('inspect s3m', 28), 0);
  header[0x1c] = 0x1a;
  header[0x1d] = 16;
  dv.setUint16(0x20, ordNum, true);
  dv.setUint16(0x22, nSmp, true);
  dv.setUint16(0x24, 1, true);
  dv.setUint16(0x28, 0x1320, true);
  dv.setUint16(0x2a, 2, true); // unsigned samples
  header.set(str('SCRM', 4), 0x2c);
  header[0x30] = 64; header[0x31] = 6; header[0x32] = 125; header[0x33] = 0xb0;
  header.fill(255, 0x40, 0x60);
  header[0x40] = 0; header[0x41] = 8;
  header[0x60] = 0; header[0x61] = 255;
  for (let i = 0; i < nSmp; i++) dv.setUint16(0x60 + ordNum + 2 * i, smpHdrPara + 5 * i, true);
  dv.setUint16(0x60 + ordNum + 2 * nSmp, patPara, true);

  const smpHeaders = new Uint8Array(nSmp * 80);
  const sdv = new DataView(smpHeaders.buffer);
  const datas = [];
  S3M_SPEC.samples.forEach((s, i) => {
    const o = i * 80;
    smpHeaders[o] = 1;
    smpHeaders.set(str(s.file, 12), o + 1);
    smpHeaders[o + 0x0d] = (dataPara >> 16) & 255;
    sdv.setUint16(o + 0x0e, dataPara & 0xffff, true);
    sdv.setUint32(o + 0x10, s.frames, true);
    sdv.setUint32(o + 0x14, s.loopStart, true);
    sdv.setUint32(o + 0x18, s.loopEnd, true);
    smpHeaders[o + 0x1c] = s.volume;
    smpHeaders[o + 0x1f] = s.loop ? 1 : 0;
    sdv.setUint32(o + 0x20, s.c2spd, true);
    smpHeaders.set(str(s.name, 28), o + 0x30);
    smpHeaders.set(str('SCRS', 4), o + 0x4c);
    const pcm = sine8(s.frames);
    const data = new Uint8Array(Math.ceil(s.frames / 16) * 16);
    for (let f = 0; f < s.frames; f++) data[f] = (pcm[f] + 128) & 255;
    datas.push(data);
    dataPara += data.length / 16;
  });
  const patPadded = new Uint8Array(patParas * 16);
  patPadded.set(patBytes);
  return concat([header, smpHeaders, patPadded, ...datas]);
}
