/**
 * Deterministic synthetic XM generator: `channels` voices all sounding a looped 16-bit saw+sine
 * sample at different pitches every row, across several patterns. Audible from row 0, heavy on
 * the resampler (which is what interpolation length changes) — used by the JS-engine benchmark
 * (scripts/bench-js-libopenmpt.mjs) and the worklet integration test as a real, audible XM
 * (public/test.xm renders as silence).
 */

/** Deterministic PRNG so the synthetic module (and its PCM hash) is stable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const enc = new TextEncoder();
const u16 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255);
const u32 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
const str = (s, n) => { const b = new Uint8Array(n); b.set(enc.encode(s).subarray(0, n)); return b; };

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return buf;
}

/**
 * One XM: header, `patterns` (each `{ rows, cells }`, cells = rows × channels × 5 raw XM bytes:
 * note, instrument, volume column, effect, parameter) and a single looped 16-bit saw+sine
 * instrument.
 */
function buildXm(title, channels, patterns) {
  const numPatterns = patterns.length;
  const parts = [];
  parts.push(str('Extended Module: ', 17), str(title, 20), Uint8Array.of(0x1a), str('bench', 20), u16(0x0104));
  const order = new Uint8Array(256);
  for (let i = 0; i < numPatterns; i++) order[i] = i;
  parts.push(u32(276), u16(numPatterns), u16(0), u16(channels), u16(numPatterns), u16(1), u16(1), u16(6), u16(125), order);

  for (const { rows, cells } of patterns) {
    parts.push(u32(9), Uint8Array.of(0), u16(rows), u16(cells.length), cells);
  }

  const smpLen = 8192; // samples
  const smp = new Int16Array(smpLen);
  for (let i = 0; i < smpLen; i++) {
    const ph = i / smpLen;
    smp[i] = Math.round(12000 * Math.sin(2 * Math.PI * ph) + 6000 * (2 * ph - 1));
  }
  const delta = new Int16Array(smpLen);
  let prev = 0;
  for (let i = 0; i < smpLen; i++) { delta[i] = (smp[i] - prev) << 16 >> 16; prev = smp[i]; }
  const smpBytes = new Uint8Array(delta.buffer);

  const instHdr = new Uint8Array(263);
  const dv = new DataView(instHdr.buffer);
  dv.setUint32(0, 263, true);
  dv.setUint16(27, 1, true); // num samples
  dv.setUint32(29, 40, true); // sample header size
  parts.push(instHdr);
  const sh = new Uint8Array(40);
  const sdv = new DataView(sh.buffer);
  sdv.setUint32(0, smpBytes.length, true);
  sdv.setUint32(4, 0, true); // loop start
  sdv.setUint32(8, smpBytes.length, true); // loop length
  sh[12] = 64; // volume
  sh[14] = 0x01 | 0x10; // forward loop, 16-bit
  sh[15] = 128; // pan
  parts.push(sh, smpBytes);

  return concat(parts);
}

/**
 * Worst-case-ish XM: `channels` voices all sounding a looped 16-bit saw+sine sample at
 * different pitches every row, several patterns. Heavy on the resampler, which is
 * exactly what interpolation length changes.
 */
export function synthXm(channels) {
  const rnd = mulberry32(0x5eed);
  const rows = 64;
  const numPatterns = 4;
  const patterns = [];
  for (let p = 0; p < numPatterns; p++) {
    const cells = new Uint8Array(rows * channels * 5);
    let o = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < channels; c++) {
        const retrig = r % 8 === 0 || rnd() < 0.15;
        cells[o++] = retrig ? 25 + Math.floor(rnd() * 48) : 0; // note
        cells[o++] = retrig ? 1 : 0; // instrument
        cells[o++] = retrig ? 0x30 + Math.floor(rnd() * 16) : 0; // volume column
        cells[o++] = 0;
        cells[o++] = 0;
      }
    }
    patterns.push({ rows, cells });
  }
  return buildXm('stress', channels, patterns);
}

/**
 * Rows of `synthCommandTestXm()`, 2 channels, 16 rows, one pattern. Raw XM cell bytes
 * (note, instrument, volume column, effect, parameter); the pattern-command mapping test
 * (tests/patternCommandMapping.test.ts) asserts what libopenmpt reads back for each. Channel 1
 * is empty except row 0, so default values leaking into untouched cells would show.
 *
 *   row  ch0 (XM text)                  what it exercises
 *   0    C-4 01 v40 A0F                 volume column "set volume 64" + volume-slide effect
 *   1    --- -- p?? 037                 volume column pan (byte 0xC8) + arpeggio (effect 0, param 0x37)
 *   2    E-4 02 --- C20                 set-volume effect (CMD_VOLUME)
 *   3    --- -- --- EC2                 MOD/XM Exy note cut (CMD_MODCMDEX, param 0xC2)
 *   4    --- -- v00 ---                 volume column "set volume 0" (the v00 note tail)
 *   5    --- -- vol-slide-up 5 ---      volume-column slide, 0..15 parameter
 *   6    === -- --- ---                 key off
 *   7    --- -- --- ?37                 effect byte with no XM meaning, parameter 0x37 (CMD_NONE with a parameter?)
 *   8    C-5 01 v20 000                 note + effect 0 with parameter 0 (no arpeggio)
 *   9    --- -- v64 ---                 volume column 0x50 (max set volume)
 */
export function synthCommandTestXm() {
  const channels = 2;
  const rows = 16;
  const cells = new Uint8Array(rows * channels * 5);
  const put = (row, ch, note, inst, vol, eff, param) => cells.set([note, inst, vol, eff, param], (row * channels + ch) * 5);
  put(0, 0, 49, 1, 0x50, 0x0a, 0x0f);
  put(0, 1, 61, 1, 0x00, 0x00, 0x00);
  put(1, 0, 0, 0, 0xc8, 0x00, 0x37);
  put(2, 0, 53, 2, 0x00, 0x0c, 0x20);
  put(3, 0, 0, 0, 0x00, 0x0e, 0xc2);
  put(4, 0, 0, 0, 0x10, 0x00, 0x00);
  put(5, 0, 0, 0, 0x75, 0x00, 0x00);
  put(6, 0, 97, 0, 0x00, 0x00, 0x00);
  put(7, 0, 0, 0, 0x00, 0x30, 0x37);
  put(8, 0, 61, 1, 0x30, 0x00, 0x00);
  put(9, 0, 0, 0, 0x50, 0x00, 0x00);
  return buildXm('command test', channels, [{ rows, cells }]);
}

/**
 * Tiny S3M for the `SCx` note cut (CMD_S3MCMDEX): 2 channels, 1 pattern, no instruments.
 *   row 0  C-4 01 v32 A07    row 1  --- -- --- SC3    row 2  --- -- --- G00 (unmapped here)
 */
export function synthCommandTestS3m() {
  const rows = 64;
  const pat = [];
  const cell = (ch, note, inst, vol, cmd, info) => {
    let what = ch;
    const body = [];
    if (note !== 255 || inst) { what |= 0x20; body.push(note, inst); }
    if (vol !== 255) { what |= 0x40; body.push(vol); }
    if (cmd) { what |= 0x80; body.push(cmd, info); }
    pat.push(what, ...body);
  };
  for (let r = 0; r < rows; r++) {
    if (r === 0) cell(0, 0x40, 1, 32, 1, 0x07); // C-4, A07
    if (r === 1) cell(0, 255, 0, 255, 19, 0xc3); // S = letter 19, SC3
    pat.push(0); // end of row
  }
  const patBytes = Uint8Array.from(pat);
  const header = new Uint8Array(0x60 + 2 /* orders */ + 2 /* pattern parapointer */);
  const dv = new DataView(header.buffer);
  header.set(str('command test', 28), 0);
  header[0x1c] = 0x1a;
  header[0x1d] = 16; // module
  dv.setUint16(0x20, 2, true); // orders
  dv.setUint16(0x22, 0, true); // instruments
  dv.setUint16(0x24, 1, true); // patterns
  dv.setUint16(0x28, 0x1320, true); // ScreamTracker 3.20
  dv.setUint16(0x2a, 2, true); // unsigned samples
  header.set(str('SCRM', 4), 0x2c);
  header[0x30] = 64; header[0x31] = 6; header[0x32] = 125; header[0x33] = 0xb0;
  header.fill(255, 0x40, 0x60); // channel settings: all disabled …
  header[0x40] = 0; header[0x41] = 8; // … except two (left / right)
  header[0x60] = 0; header[0x61] = 255; // order list: pattern 0, end marker
  const parapointer = Math.ceil((header.length) / 16);
  const padded = new Uint8Array(parapointer * 16);
  padded.set(header);
  new DataView(padded.buffer).setUint16(0x62, parapointer, true);
  return concat([padded, u16(patBytes.length + 2), patBytes]);
}
