/**
 * Deterministic synthetic Impulse Tracker module for engine benchmarks (#491 Phase 3).
 *
 * `channels` (up to 64) channels, all sounding a looped 16-bit saw+sine sample at different
 * pitches, re-triggered on most rows, with vibrato and volume-column work on top — every voice is
 * live all the time, so the mixer runs `channels` resampled voices per quantum. Sample mode (no
 * instruments), 4 patterns × 64 rows, ~31 s per song loop. IT rather than XM because #491 asks for
 * a 64-channel IT (XM tops out at 32 channels in FastTracker 2).
 */

/** Same PRNG as synth-xm.mjs, so the stress pattern is stable run to run. */
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
 * @param {number} [channels]  1..64 live channels
 * @param {{ sampleFrames?: number }} [options]  sampleFrames: length of the one looped 16-bit
 *   sample (default 8192). A long one (e.g. 1 << 24 frames = 32 MiB) makes a module whose parse is
 *   dominated by sample loading — the "big upload" case for load / track-change measurements.
 */
export function synthIt(channels = 64, options = {}) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 64) throw new Error('synthIt: 1..64 channels');
  const rnd = mulberry32(0x17);
  const rows = 64;
  const numPatterns = 4;
  const ordNum = numPatterns + 1;
  const smpLen = options.sampleFrames ?? 8192;

  // ── patterns (IT packed format) ──
  const patterns = [];
  for (let p = 0; p < numPatterns; p++) {
    const body = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < channels; c++) {
        const retrig = r % 8 === 0 || rnd() < 0.2;
        if (retrig) {
          body.push((c + 1) | 0x80, 0x01 | 0x02 | 0x04 | 0x08); // channel + mask: note, sample, volume, command
          body.push(36 + Math.floor(rnd() * 48)); // note C-3..B-6
          body.push(1); // sample 1
          body.push(32 + Math.floor(rnd() * 33)); // volume column 32..64
          body.push(8, 0x40 | Math.floor(rnd() * 8)); // H (vibrato) 4x
        } else {
          body.push((c + 1) | 0x80, 0x08); // command only
          body.push(8, 0x40 | Math.floor(rnd() * 8));
        }
      }
      body.push(0); // end of row
    }
    const data = Uint8Array.from(body);
    const hdr = new Uint8Array(8);
    const hv = new DataView(hdr.buffer);
    hv.setUint16(0, data.length, true);
    hv.setUint16(2, rows, true);
    patterns.push({ hdr, data });
  }

  // ── sample: looped 16-bit saw + sine ──
  const smp = new Int16Array(smpLen);
  for (let i = 0; i < smpLen; i++) {
    const ph = (i % 8192) / 8192; // one 8192-frame cycle, repeated for long samples
    smp[i] = Math.round(10000 * Math.sin(2 * Math.PI * ph) + 5000 * (2 * ph - 1));
  }
  const smpBytes = new Uint8Array(smp.buffer);

  // ── layout ──
  const enc = new TextEncoder();
  const headerSize = 0xc0;
  const ordersOff = headerSize;
  const smpPtrOff = ordersOff + ordNum;
  const patPtrOff = smpPtrOff + 4;
  const sampleHeaderOff = patPtrOff + numPatterns * 4;
  let cursor = sampleHeaderOff + 0x50;
  const sampleDataOff = cursor;
  cursor += smpBytes.length;
  const patOffs = patterns.map((pt) => {
    const at = cursor;
    cursor += pt.hdr.length + pt.data.length;
    return at;
  });

  const buf = new Uint8Array(cursor);
  const dv = new DataView(buf.buffer);
  const str = (off, s, n) => buf.set(enc.encode(s).subarray(0, n), off);
  str(0x00, 'IMPM', 4);
  str(0x04, `stress ${channels}ch`, 26);
  dv.setUint16(0x1e, 0x1004, true);
  dv.setUint16(0x20, ordNum, true);
  dv.setUint16(0x22, 0, true); // instruments: none (sample mode)
  dv.setUint16(0x24, 1, true);
  dv.setUint16(0x26, numPatterns, true);
  dv.setUint16(0x28, 0x0214, true);
  dv.setUint16(0x2a, 0x0214, true);
  dv.setUint16(0x2c, 0x0009, true); // stereo + linear slides
  buf[0x30] = 128; // global volume
  buf[0x31] = 32; // mixing volume (headroom for 64 voices)
  buf[0x32] = 6; // speed
  buf[0x33] = 125; // tempo
  buf[0x34] = 128; // separation
  for (let ch = 0; ch < 64; ch++) {
    buf[0x40 + ch] = ch < channels ? (ch * 64) / 63 : 32 | 0x80; // spread pan, others disabled
    buf[0x80 + ch] = 64;
  }
  for (let o = 0; o < numPatterns; o++) buf[ordersOff + o] = o;
  buf[ordersOff + numPatterns] = 255;
  dv.setUint32(smpPtrOff, sampleHeaderOff, true);
  patOffs.forEach((off, i) => dv.setUint32(patPtrOff + i * 4, off, true));

  str(sampleHeaderOff, 'IMPS', 4);
  str(sampleHeaderOff + 0x04, 'sawsine.raw', 12);
  buf[sampleHeaderOff + 0x11] = 64; // global volume
  buf[sampleHeaderOff + 0x12] = 0x01 | 0x02 | 0x10; // present, 16-bit, loop
  buf[sampleHeaderOff + 0x13] = 64; // default volume
  str(sampleHeaderOff + 0x14, 'saw + sine', 26);
  buf[sampleHeaderOff + 0x2e] = 0x01; // signed
  buf[sampleHeaderOff + 0x2f] = 32;
  dv.setUint32(sampleHeaderOff + 0x30, smpLen, true);
  dv.setUint32(sampleHeaderOff + 0x34, 0, true); // loop begin
  dv.setUint32(sampleHeaderOff + 0x38, smpLen, true); // loop end
  dv.setUint32(sampleHeaderOff + 0x3c, 22050, true); // C5 speed
  dv.setUint32(sampleHeaderOff + 0x48, sampleDataOff, true);
  buf.set(smpBytes, sampleDataOff);

  patterns.forEach((pt, i) => {
    buf.set(pt.hdr, patOffs[i]);
    buf.set(pt.data, patOffs[i] + pt.hdr.length);
  });
  return buf;
}
