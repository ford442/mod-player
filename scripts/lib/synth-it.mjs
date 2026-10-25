/**
 * Deterministic synthetic IT generator (sample mode, no instruments): up to 64 channels, every
 * voice retriggering a looped 16-bit saw+sine sample. Two knobs:
 *
 *   channels     — mixer load (the SIMD bench renders a 64-channel IT, scripts/bench-js-libopenmpt.mjs)
 *   sampleFrames — file size: four samples of this many 16-bit frames, so `4 << 20` frames is a
 *                  ~32 MiB file and `2 << 20` ≈ 16 MiB. That is the "large module" the create-off-the-
 *                  audio-thread checks load while another module plays (#513).
 *
 * Uncompressed samples (no IT215 packing), so libopenmpt's create cost is copy + convert + the
 * song-length scan — the same work a real large IT costs.
 */

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

const NUM_SAMPLES = 4;
const HEADER_BYTES = 192;
const SAMPLE_HEADER_BYTES = 80;

/**
 * @param {number} channels 1..64
 * @param {{ sampleFrames?: number, patterns?: number, rows?: number, seed?: number }} [opts]
 */
export function synthIt(channels, opts = {}) {
  if (!(channels >= 1 && channels <= 64)) throw new Error(`synthIt: channels must be 1..64, got ${channels}`);
  const sampleFrames = opts.sampleFrames ?? 8192;
  const numPatterns = opts.patterns ?? 4;
  const rows = opts.rows ?? 64;
  const rnd = mulberry32(opts.seed ?? 0x17);
  const enc = new TextEncoder();

  // ── Patterns (packed) ──────────────────────────────────────────────
  const patterns = [];
  for (let p = 0; p < numPatterns; p++) {
    const bytes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < channels; c++) {
        if (!(r % 8 === 0 || rnd() < 0.15)) continue;
        bytes.push((c + 1) | 0x80, 0x01 | 0x02 | 0x04); // channel + mask: note, sample, volume
        bytes.push(36 + Math.floor(rnd() * 48), 1 + Math.floor(rnd() * NUM_SAMPLES), 32 + Math.floor(rnd() * 32));
      }
      bytes.push(0); // end of row
    }
    const data = Uint8Array.from(bytes);
    const hdr = new Uint8Array(8);
    const dv = new DataView(hdr.buffer);
    dv.setUint16(0, data.length, true);
    dv.setUint16(2, rows, true);
    patterns.push(hdr, data);
  }

  // ── Layout ─────────────────────────────────────────────────────────
  const ordNum = numPatterns + 1; // trailing 255 = end of song
  const offsetTableBytes = ordNum + 4 * NUM_SAMPLES + 4 * numPatterns;
  const sampleHeadersAt = HEADER_BYTES + offsetTableBytes;
  const patternsAt = sampleHeadersAt + NUM_SAMPLES * SAMPLE_HEADER_BYTES;
  const patternBytes = patterns.reduce((n, p) => n + p.length, 0);
  const sampleDataAt = patternsAt + patternBytes;
  const sampleDataBytes = sampleFrames * 2;
  const total = sampleDataAt + NUM_SAMPLES * sampleDataBytes;

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf.set(enc.encode('IMPM'), 0);
  buf.set(enc.encode('synthetic stress'), 4);
  dv.setUint16(0x1e, 0x1004, true); // PHiligt
  dv.setUint16(0x20, ordNum, true);
  dv.setUint16(0x22, 0, true); // instruments
  dv.setUint16(0x24, NUM_SAMPLES, true);
  dv.setUint16(0x26, numPatterns, true);
  dv.setUint16(0x28, 0x0214, true); // Cwt/v
  dv.setUint16(0x2a, 0x0214, true); // Cmwt
  dv.setUint16(0x2c, 0x01 | 0x08, true); // stereo, linear slides (sample mode: bit 2 clear)
  buf[0x30] = 128; // global volume
  buf[0x31] = 48; // mix volume
  buf[0x32] = 6; // speed
  buf[0x33] = 125; // tempo
  buf[0x34] = 128; // separation
  for (let c = 0; c < 64; c++) {
    buf[0x40 + c] = c < channels ? (c % 2 ? 16 : 48) : 32 | 0x80; // pan; unused channels disabled
    buf[0x80 + c] = 64; // channel volume
  }

  let o = HEADER_BYTES;
  for (let p = 0; p < numPatterns; p++) buf[o++] = p;
  buf[o++] = 255;
  for (let s = 0; s < NUM_SAMPLES; s++, o += 4) dv.setUint32(o, sampleHeadersAt + s * SAMPLE_HEADER_BYTES, true);
  let patOff = patternsAt;
  for (let p = 0; p < numPatterns; p++, o += 4) {
    dv.setUint32(o, patOff, true);
    patOff += patterns[2 * p].length + patterns[2 * p + 1].length;
  }

  for (let s = 0; s < NUM_SAMPLES; s++) {
    const h = sampleHeadersAt + s * SAMPLE_HEADER_BYTES;
    buf.set(enc.encode('IMPS'), h);
    buf[h + 0x11] = 64; // global volume
    buf[h + 0x12] = 0x01 | 0x02 | 0x10; // has data, 16-bit, loop
    buf[h + 0x13] = 64; // default volume
    buf.set(enc.encode(`voice ${s + 1}`), h + 0x14);
    buf[h + 0x2e] = 0x01; // signed samples
    dv.setUint32(h + 0x30, sampleFrames, true); // length
    dv.setUint32(h + 0x34, 0, true); // loop begin
    dv.setUint32(h + 0x38, sampleFrames, true); // loop end
    dv.setUint32(h + 0x3c, 8363 * (s + 1), true); // C5 speed
    dv.setUint32(h + 0x48, sampleDataAt + s * sampleDataBytes, true); // sample pointer
  }

  o = patternsAt;
  for (const p of patterns) { buf.set(p, o); o += p.length; }

  // A short cycle repeated across the whole sample: deterministic and cheap to generate even at 16 MiB.
  const period = 512;
  const cycle = new Int16Array(period);
  for (let i = 0; i < period; i++) {
    const ph = i / period;
    cycle[i] = Math.round(12000 * Math.sin(2 * Math.PI * ph) + 6000 * (2 * ph - 1));
  }
  const cycleBytes = new Uint8Array(cycle.buffer);
  for (let s = 0; s < NUM_SAMPLES; s++) {
    const base = sampleDataAt + s * sampleDataBytes;
    for (let f = 0; f < sampleFrames; f += period) {
      const n = Math.min(period, sampleFrames - f) * 2;
      buf.set(cycleBytes.subarray(0, n), base + f * 2);
    }
  }
  return buf;
}
