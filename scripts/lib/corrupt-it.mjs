/**
 * Deterministic "corrupt sample" Impulse Tracker module (#491).
 *
 * One order, one empty pattern and one IT 2.15-compressed 8-bit sample whose
 * compressed block is far too short for the declared length. libopenmpt's IT
 * decompressor reads past the end of that block, throws BitReader::eof and
 * catches it internally ("Truncated IT sample block") — a normal, recoverable
 * load. That catch only exists at runtime when the wasm was linked with
 * exception catching: in a no-catch build the throw is an abort(), which in the
 * native engine kills the worklet. Used by the host harness (cpp/host/).
 */

const SAMPLE_LENGTH = 4096;

export function corruptIt215Sample() {
  const enc = new TextEncoder();
  const ordNum = 2;
  const insNum = 0;
  const smpNum = 1;
  const patNum = 1;

  const headerSize = 0xc0;
  const ordersOff = headerSize;
  const smpPtrOff = ordersOff + ordNum + insNum * 4;
  const patPtrOff = smpPtrOff + smpNum * 4;
  const sampleHeaderOff = patPtrOff + patNum * 4;
  const sampleDataOff = sampleHeaderOff + 0x50;
  // uint16 block size + the block itself: 4 bytes cannot hold 4096 samples.
  const block = Uint8Array.of(0xff, 0x7f, 0x3f, 0x1f);
  const total = sampleDataOff + 2 + block.length;

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  const str = (off, s, n) => buf.set(enc.encode(s).subarray(0, n), off);

  str(0x00, 'IMPM', 4);
  str(0x04, 'corrupt it215 sample', 26);
  dv.setUint16(0x1e, 0x1004, true); // pattern highlight
  dv.setUint16(0x20, ordNum, true);
  dv.setUint16(0x22, insNum, true);
  dv.setUint16(0x24, smpNum, true);
  dv.setUint16(0x26, patNum, true);
  dv.setUint16(0x28, 0x0215, true); // Cwt/v: Impulse Tracker 2.15
  dv.setUint16(0x2a, 0x0215, true); // Cmwt: IT 2.15 compression
  dv.setUint16(0x2c, 0x0009, true); // stereo + linear slides
  buf[0x30] = 128; // global volume
  buf[0x31] = 48; // mixing volume
  buf[0x32] = 6; // initial speed
  buf[0x33] = 125; // initial tempo
  buf[0x34] = 128; // stereo separation
  for (let ch = 0; ch < 64; ch++) {
    buf[0x40 + ch] = ch < 4 ? 32 : 32 | 0x80; // 4 enabled channels
    buf[0x80 + ch] = 64;
  }
  buf[ordersOff] = 0;
  buf[ordersOff + 1] = 255; // end of song
  dv.setUint32(smpPtrOff, sampleHeaderOff, true);
  dv.setUint32(patPtrOff, 0, true); // offset 0 = empty 64-row pattern

  // IMPS sample header
  str(sampleHeaderOff, 'IMPS', 4);
  str(sampleHeaderOff + 0x04, 'corrupt.raw', 12);
  buf[sampleHeaderOff + 0x11] = 64; // global volume
  buf[sampleHeaderOff + 0x12] = 0x01 | 0x08; // sample present + compressed (8-bit)
  buf[sampleHeaderOff + 0x13] = 64; // default volume
  str(sampleHeaderOff + 0x14, 'truncated compressed block', 26);
  buf[sampleHeaderOff + 0x2e] = 0x01 | 0x04; // signed + IT 2.15 delta
  buf[sampleHeaderOff + 0x2f] = 32;
  dv.setUint32(sampleHeaderOff + 0x30, SAMPLE_LENGTH, true);
  dv.setUint32(sampleHeaderOff + 0x3c, 8363, true); // C5 speed
  dv.setUint32(sampleHeaderOff + 0x48, sampleDataOff, true);

  dv.setUint16(sampleDataOff, block.length, true);
  buf.set(block, sampleDataOff + 2);
  return buf;
}
