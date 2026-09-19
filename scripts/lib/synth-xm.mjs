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

/**
 * Worst-case-ish XM: `channels` voices all sounding a looped 16-bit saw+sine sample at
 * different pitches every row, several patterns. Heavy on the resampler, which is
 * exactly what interpolation length changes.
 */
export function synthXm(channels) {
  const rnd = mulberry32(0x5eed);
  const rows = 64;
  const numPatterns = 4;
  const enc = new TextEncoder();
  const parts = [];
  const u16 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255);
  const u32 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const str = (s, n) => { const b = new Uint8Array(n); b.set(enc.encode(s).subarray(0, n)); return b; };

  parts.push(str('Extended Module: ', 17), str('stress', 20), Uint8Array.of(0x1a), str('bench', 20), u16(0x0104));
  const order = new Uint8Array(256);
  for (let i = 0; i < numPatterns; i++) order[i] = i;
  parts.push(u32(276), u16(numPatterns), u16(0), u16(channels), u16(numPatterns), u16(1), u16(1), u16(6), u16(125), order);

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

  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return buf;
}
