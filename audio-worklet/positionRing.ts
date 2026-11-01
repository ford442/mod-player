/**
 * Shared-memory position + VU ring between the JS AudioWorklet and the main thread (#492).
 *
 * When the page is crossOriginIsolated, the main thread allocates this SharedArrayBuffer and hands
 * it to the worklet (`setPositionRing`). From then on the worklet writes its ~60 Hz position report
 * here instead of posting a `position` message, and the main thread drains it from the UI loop —
 * no message object, no structured clone, no zod parse, no `channelVU` array copy per report.
 * Without isolation the postMessage path stays.
 *
 * Layout (one buffer):
 *
 *   Int32   header[0]          magic
 *   Int32   header[1]          writeCount — reports written so far (wraps at 2^31; compared with `| 0`)
 *   Int32   seq[SLOTS]         per-slot seqlock: odd while the slot is being written
 *   Float64 fields[SLOTS × 12] per slot: the report's index + its fields (F_* below)
 *   Float32 vu[SLOTS × 64]     per slot: channel VU
 *
 * Writer (audio thread, positionRingWriter.ts — a module of its own so it never ships in the main
 * chunk): `begin()` marks the slot odd and returns its offsets; the caller fills the typed arrays;
 * `commit()` marks it even and publishes writeCount. Reader (main thread): `next()`
 * copies the oldest unread report into preallocated scratch (`sample`, `vu`) and checks the slot's
 * seq did not change and its stored index is the one expected (a lapped slot holds a newer report and
 * counts as dropped). A reader that fell more than SLOTS behind skips to the newest SLOTS reports.
 *
 * Neither side allocates per report. DOM-free; bundled into public/worklets/openmpt-worklet.js.
 */
import { MAX_VU_CHANNELS } from './workletProtocolConstants';

/** Reports buffered: 8 × 16.7 ms ≈ 133 ms of slack for a busy main thread. Power of two. */
export const POSITION_RING_SLOTS = 8;

const MAGIC = 0x52494e47; // 'RING'
const H_MAGIC = 0;
/** @internal shared with positionRingWriter.ts */
export const H_WRITE_COUNT = 1;
/** @internal */
export const SEQ_BASE = 2;
const HEADER_INTS = SEQ_BASE + POSITION_RING_SLOTS;

/** Float64 fields per slot. */
export const F_INDEX = 0;
export const F_ORDER = 1;
export const F_ROW = 2;
/** NaN when the report had none. */
export const F_ROW_FRACTION = 3;
export const F_POSITION_SECONDS = 4;
export const F_BPM = 5;
export const F_SPEED = 6;
export const F_AUDIO_TIME = 7;
export const F_SAMPLES_WRITTEN = 8;
export const F_SAMPLE_RATE = 9;
export const F_NUM_VU = 10;
/** @internal Float64 fields per slot (padded). */
export const SLOT_FIELDS = 12;

const FIELDS_BYTE_OFFSET = Math.ceil((HEADER_INTS * 4) / 8) * 8;
const VU_BYTE_OFFSET = FIELDS_BYTE_OFFSET + POSITION_RING_SLOTS * SLOT_FIELDS * 8;

export const POSITION_RING_BYTES = VU_BYTE_OFFSET + POSITION_RING_SLOTS * MAX_VU_CHANNELS * 4;

/** True when this realm can share memory with the other side (crossOriginIsolated + SAB + Atomics). */
export function canUsePositionRing(): boolean {
  return typeof SharedArrayBuffer === 'function'
    && typeof Atomics === 'object'
    && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export function createPositionRingBuffer(): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(POSITION_RING_BYTES);
  Atomics.store(new Int32Array(buffer, 0, HEADER_INTS), H_MAGIC, MAGIC);
  return buffer;
}

/** @internal Typed views over a ring buffer. */
export function views(buffer: SharedArrayBuffer) {
  if (buffer.byteLength < POSITION_RING_BYTES) {
    throw new RangeError(`position ring needs ${POSITION_RING_BYTES} bytes, got ${buffer.byteLength}`);
  }
  return {
    header: new Int32Array(buffer, 0, HEADER_INTS),
    fields: new Float64Array(buffer, FIELDS_BYTE_OFFSET, POSITION_RING_SLOTS * SLOT_FIELDS),
    vu: new Float32Array(buffer, VU_BYTE_OFFSET, POSITION_RING_SLOTS * MAX_VU_CHANNELS),
  };
}

/** One report, as read by PositionRingReader.next() (preallocated; numeric fields only). */
export interface PositionRingSample {
  index: number;
  order: number;
  row: number;
  rowFraction: number;
  positionSeconds: number;
  bpm: number;
  speed: number;
  audioTime: number;
  samplesWritten: number;
  sampleRate: number;
  numVu: number;
}

const MAX_READ_ATTEMPTS = 4;

/** Main-thread side. */
export class PositionRingReader {
  /** The report `next()` last returned true for. Overwritten by every `next()`. */
  readonly sample: PositionRingSample = {
    index: 0, order: 0, row: 0, rowFraction: 0, positionSeconds: 0, bpm: 0, speed: 0,
    audioTime: 0, samplesWritten: 0, sampleRate: 0, numVu: 0,
  };
  /** Its channel VU (`sample.numVu` valid entries). */
  readonly vu = new Float32Array(MAX_VU_CHANNELS);
  /** Reports read / lost to a lap or to falling more than SLOTS behind. */
  read = 0;
  dropped = 0;
  private readonly header: Int32Array;
  private readonly fields: Float64Array;
  private readonly ringVu: Float32Array;
  private nextIndex: number;

  constructor(buffer: SharedArrayBuffer) {
    const v = views(buffer);
    this.header = v.header;
    this.fields = v.fields;
    this.ringVu = v.vu;
    this.nextIndex = Atomics.load(this.header, H_WRITE_COUNT);
  }

  /** Forget everything written so far (a restart: the old reports are stale). */
  resync(): void {
    this.nextIndex = Atomics.load(this.header, H_WRITE_COUNT);
  }

  /** Copy the oldest unread report into `sample` / `vu`. False when caught up. */
  next(): boolean {
    for (;;) {
      const written = Atomics.load(this.header, H_WRITE_COUNT);
      const behind = (written - this.nextIndex) | 0;
      if (behind <= 0) return false;
      if (behind > POSITION_RING_SLOTS) {
        this.dropped += behind - POSITION_RING_SLOTS;
        this.nextIndex = (written - POSITION_RING_SLOTS) | 0;
      }
      const index = this.nextIndex;
      this.nextIndex = (index + 1) | 0;
      if (this.readSlot(index)) {
        this.read++;
        return true;
      }
      this.dropped++;
    }
  }

  private readSlot(index: number): boolean {
    const slot = index & (POSITION_RING_SLOTS - 1);
    const seqIndex = SEQ_BASE + slot;
    const f = slot * SLOT_FIELDS;
    const v = slot * MAX_VU_CHANNELS;
    const fields = this.fields;
    const s = this.sample;
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
      const before = Atomics.load(this.header, seqIndex);
      if ((before & 1) !== 0) continue; // being written right now
      s.index = fields[f + F_INDEX]!;
      s.order = fields[f + F_ORDER]!;
      s.row = fields[f + F_ROW]!;
      s.rowFraction = fields[f + F_ROW_FRACTION]!;
      s.positionSeconds = fields[f + F_POSITION_SECONDS]!;
      s.bpm = fields[f + F_BPM]!;
      s.speed = fields[f + F_SPEED]!;
      s.audioTime = fields[f + F_AUDIO_TIME]!;
      s.samplesWritten = fields[f + F_SAMPLES_WRITTEN]!;
      s.sampleRate = fields[f + F_SAMPLE_RATE]!;
      const numVu = Math.min(fields[f + F_NUM_VU]! | 0, MAX_VU_CHANNELS);
      s.numVu = numVu;
      for (let c = 0; c < numVu; c++) this.vu[c] = this.ringVu[v + c]!;
      if (Atomics.load(this.header, seqIndex) !== before) continue; // torn: retry
      // A lapped slot holds a newer report (index + k·SLOTS): this one is gone.
      return (s.index | 0) === index;
    }
    return false;
  }
}
