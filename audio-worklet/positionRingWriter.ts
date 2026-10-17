/**
 * The audio-thread side of the shared position ring (#492; layout and reader: positionRing.ts).
 * Separate module so the main chunk, which only reads, does not carry it. DOM-free; bundled into
 * public/worklets/openmpt-worklet.js.
 */
import { MAX_VU_CHANNELS } from './workletProtocolConstants';
import { F_INDEX, H_WRITE_COUNT, POSITION_RING_SLOTS, SEQ_BASE, SLOT_FIELDS, views } from './positionRing';

export class PositionRingWriter {
  /** Fill `fields[fieldOffset + F_*]` and `vu[vuOffset + channel]` between begin() and commit(). */
  readonly fields: Float64Array;
  readonly vu: Float32Array;
  fieldOffset = 0;
  vuOffset = 0;
  private readonly header: Int32Array;
  private writeCount = 0;
  private slot = 0;
  private seq = 0;

  constructor(buffer: SharedArrayBuffer) {
    const v = views(buffer);
    this.header = v.header;
    this.fields = v.fields;
    this.vu = v.vu;
    this.writeCount = Atomics.load(this.header, H_WRITE_COUNT);
  }

  /** Claim the next slot (marks it odd = being written). */
  begin(): void {
    this.slot = this.writeCount & (POSITION_RING_SLOTS - 1);
    this.seq = Atomics.load(this.header, SEQ_BASE + this.slot);
    Atomics.store(this.header, SEQ_BASE + this.slot, (this.seq + 1) | 0);
    this.fieldOffset = this.slot * SLOT_FIELDS;
    this.vuOffset = this.slot * MAX_VU_CHANNELS;
    this.fields[this.fieldOffset + F_INDEX] = this.writeCount;
  }

  /** Publish the slot filled since begin(). */
  commit(): void {
    Atomics.store(this.header, SEQ_BASE + this.slot, (this.seq + 2) | 0);
    this.writeCount = (this.writeCount + 1) | 0;
    Atomics.store(this.header, H_WRITE_COUNT, this.writeCount);
  }
}

