/**
 * #492: the shared position ring (audio-worklet/positionRing.ts) and its main-thread consumer
 * (utils/positionRingConsumer.ts). The consumer must leave the engine's refs exactly as the
 * `position`-message path does for the same reports.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  F_AUDIO_TIME,
  F_BPM,
  F_NUM_VU,
  F_ORDER,
  F_POSITION_SECONDS,
  F_ROW,
  F_ROW_FRACTION,
  F_SAMPLE_RATE,
  F_SAMPLES_WRITTEN,
  F_SPEED,
  POSITION_RING_BYTES,
  POSITION_RING_SLOTS,
  PositionRingReader,
  canUsePositionRing,
  createPositionRingBuffer,
} from '../audio-worklet/positionRing';
import { PositionRingWriter } from '../audio-worklet/positionRingWriter';
import { MAX_VU_CHANNELS, WORKLET_TO_MAIN } from '../audio-worklet/workletProtocolConstants';
import { dispatchWorkletToMainMessage } from '../audio-worklet/jsWorkletDispatch';
import { parseWorkletToMainMessage } from '../audio-worklet/protocol';
import { createPositionRingConsumer } from '../utils/positionRingConsumer';
import type { ChannelShadowState, PatternMatrix } from '../types';

interface Report {
  order: number;
  row: number;
  rowFraction: number;
  positionSeconds: number;
  bpm: number;
  speed: number;
  audioTime: number;
  samplesWritten: number;
  sampleRate: number;
  vu: number[];
}

function report(i: number, overrides: Partial<Report> = {}): Report {
  return {
    order: Math.floor(i / 64),
    row: i % 64,
    rowFraction: (i % 64) + 0.4,
    positionSeconds: i * 0.12,
    bpm: 125,
    speed: 6,
    audioTime: 10 + i / 60,
    samplesWritten: 128,
    sampleRate: 48000,
    vu: [0.1 * (i % 7), 0.5, 0.02, 0.9],
    ...overrides,
  };
}

/** What openmpt-processor.ts does when a ring is attached. */
function write(writer: PositionRingWriter, r: Report): void {
  writer.begin();
  const f = writer.fields;
  const o = writer.fieldOffset;
  f[o + F_ORDER] = r.order;
  f[o + F_ROW] = r.row;
  f[o + F_ROW_FRACTION] = r.rowFraction;
  f[o + F_POSITION_SECONDS] = r.positionSeconds;
  f[o + F_BPM] = r.bpm;
  f[o + F_SPEED] = r.speed;
  f[o + F_AUDIO_TIME] = r.audioTime;
  f[o + F_SAMPLES_WRITTEN] = r.samplesWritten;
  f[o + F_SAMPLE_RATE] = r.sampleRate;
  f[o + F_NUM_VU] = r.vu.length;
  for (let c = 0; c < r.vu.length; c++) writer.vu[writer.vuOffset + c] = r.vu[c]!;
  writer.commit();
}

function readAll(reader: PositionRingReader): number[] {
  const rows: number[] = [];
  while (reader.next()) rows.push(reader.sample.index);
  return rows;
}

describe('position ring', () => {
  it('round-trips a report, VU included', () => {
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const reader = new PositionRingReader(buffer);
    expect(reader.next()).toBe(false);
    write(writer, report(3, { vu: new Array(MAX_VU_CHANNELS).fill(0).map((_, c) => c / 100) }));
    expect(reader.next()).toBe(true);
    expect(reader.sample).toMatchObject({ index: 0, order: 0, row: 3, rowFraction: 3.4, bpm: 125, speed: 6, numVu: 64 });
    expect(reader.sample.audioTime).toBeCloseTo(10.05);
    expect(reader.vu[63]).toBeCloseTo(0.63);
    expect(reader.next()).toBe(false);
  });

  it('delivers reports in order, then reports caught up', () => {
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const reader = new PositionRingReader(buffer);
    for (let i = 0; i < 5; i++) write(writer, report(i));
    expect(readAll(reader)).toEqual([0, 1, 2, 3, 4]);
    write(writer, report(5));
    expect(readAll(reader)).toEqual([5]);
    expect(reader.dropped).toBe(0);
  });

  it('a reader more than a ring behind skips to the newest SLOTS reports and counts the rest dropped', () => {
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const reader = new PositionRingReader(buffer);
    for (let i = 0; i < 20; i++) write(writer, report(i));
    expect(readAll(reader)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(reader.dropped).toBe(20 - POSITION_RING_SLOTS);
  });

  it('never returns a slot that is being overwritten (odd seqlock), and never a lapped one', () => {
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const reader = new PositionRingReader(buffer);
    for (let i = 0; i < POSITION_RING_SLOTS; i++) write(writer, report(i));
    // The writer starts lapping slot 0 (report 8) and is mid-write when the reader looks.
    writer.begin();
    expect(readAll(reader)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(reader.dropped).toBe(1);
    // It finishes: report 8 is visible now.
    writer.commit();
    expect(readAll(reader)).toEqual([8]);
  });

  it('resync drops what is buffered', () => {
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const reader = new PositionRingReader(buffer);
    write(writer, report(0));
    write(writer, report(1));
    reader.resync();
    expect(reader.next()).toBe(false);
    write(writer, report(2));
    expect(readAll(reader)).toEqual([2]);
  });

  it('a reader attached late starts at the present, not at old reports', () => {
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    write(writer, report(0));
    const reader = new PositionRingReader(buffer);
    expect(reader.next()).toBe(false);
  });

  it('rejects a buffer that is too small, and is off without cross-origin isolation', () => {
    expect(() => new PositionRingReader(new SharedArrayBuffer(POSITION_RING_BYTES - 8))).toThrow(RangeError);
    expect(canUsePositionRing()).toBe(false); // node: no crossOriginIsolated
  });
});

function engineRefs(node: AudioWorkletNode | null = null) {
  const ref = <T,>(current: T) => ({ current });
  const channelStates: ChannelShadowState[] = Array.from({ length: 4 }, () => ({
    volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0,
  }));
  return {
    audioWorkletNodeRef: ref<AudioWorkletNode | null>(node),
    channelStatesRef: ref(channelStates),
    pendingSeekRef: ref<{ order: number; row: number; timestamp: number } | null>(null),
    seekAcknowledgedRef: ref(true),
    isPausedRef: ref(false),
    workletOrderRef: ref(0),
    workletRowRef: ref(0),
    workletTimeRef: ref(0),
    workletTimestampRef: ref(0),
    lastWorkletUpdateRef: ref(0),
    workletBpmRef: ref(125),
    workletSpeedRef: ref(6),
    workletRowsPerSecRef: ref(8.33),
    workletPositionSampleRef: ref<import('../utils/playheadPrediction').WorkletPositionSample | null>(null),
    patternMatricesRef: ref<(PatternMatrix | null)[]>([{ numRows: 64 } as PatternMatrix, { numRows: 32 } as PatternMatrix]),
    workletModuleTokenRef: ref(1),
    lastWorkletModuleTokenSentRef: ref(1),
    spFallbackTriggered: ref(false),
  };
}

type EngineRefsLike = ReturnType<typeof engineRefs>;

/** The comparable state a position report leaves behind. */
function snapshot(refs: EngineRefsLike) {
  return {
    sample: { ...refs.workletPositionSampleRef.current },
    order: refs.workletOrderRef.current,
    row: refs.workletRowRef.current,
    time: refs.workletTimeRef.current,
    timestamp: refs.workletTimestampRef.current,
    rowsPerSec: refs.workletRowsPerSecRef.current,
    bpm: refs.workletBpmRef.current,
    speed: refs.workletSpeedRef.current,
    pendingSeek: refs.pendingSeekRef.current,
    // The ring carries VU as Float32 (the precision the GPU uses); the message path as doubles.
    vu: refs.channelStatesRef.current.map((c) => [Math.fround(c.volume), c.trigger]),
  };
}

describe('position ring consumer', () => {
  it('leaves the refs exactly as the position-message path does, report for report', () => {
    const node = {} as AudioWorkletNode;
    const viaRing = engineRefs(node);
    const viaMessages = engineRefs();
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const consumer = createPositionRingConsumer(buffer, node, viaRing, () => {});

    for (let i = 0; i < 90; i++) {
      // A tempo slide and an order change on the way, so the row-rate estimate really moves.
      const r = report(i, { bpm: 125 + i, speed: i > 60 ? 5 : 6 });
      write(writer, r);
      if (i % 3 === 2) consumer.drain(); // a frame sees several reports at once
      const message = parseWorkletToMainMessage(structuredClone({
        type: WORKLET_TO_MAIN.position, order: r.order, row: r.row, rowFraction: r.rowFraction,
        positionSeconds: r.positionSeconds, bpm: r.bpm, speed: r.speed, audioTime: r.audioTime,
        workletTime: r.audioTime, samplesWritten: r.samplesWritten, sampleRate: r.sampleRate, channelVU: r.vu,
      }));
      if (!message.ok) throw new Error(message.error);
      dispatchWorkletToMainMessage({ refs: viaMessages, message: message.message, audioContextCurrentTime: 0 });
      if (i % 3 === 2) expect(snapshot(viaRing)).toEqual(snapshot(viaMessages));
    }
    expect(consumer.stats()).toEqual({ samples: 90, dropped: 0 });
  });

  it('acknowledges a pending seek, keeps the meters dark while paused, and reports the render', () => {
    const node = {} as AudioWorkletNode;
    const refs = engineRefs(node);
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const onRender = vi.fn();
    const consumer = createPositionRingConsumer(buffer, node, refs, onRender);

    refs.pendingSeekRef.current = { order: 0, row: 9, timestamp: 0 };
    refs.seekAcknowledgedRef.current = false;
    write(writer, report(9));
    expect(consumer.drain()).toBe(1);
    expect(refs.pendingSeekRef.current).toBeNull();
    expect(refs.seekAcknowledgedRef.current).toBe(true);
    expect(onRender).toHaveBeenCalledTimes(1);

    refs.isPausedRef.current = true;
    write(writer, report(10, { vu: [1, 1, 1, 1] }));
    consumer.drain();
    expect(refs.channelStatesRef.current.map((c) => c.volume)).toEqual([0, 0, 0, 0]);

    expect(consumer.drain()).toBe(0); // nothing new: no render report
    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it('does nothing once another node replaced the one writing it', () => {
    const node = {} as AudioWorkletNode;
    const refs = engineRefs(node);
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const consumer = createPositionRingConsumer(buffer, node, refs, () => {});
    refs.audioWorkletNodeRef.current = {} as AudioWorkletNode;
    write(writer, report(1));
    expect(consumer.drain()).toBe(0);
    expect(refs.workletPositionSampleRef.current).toBeNull();
  });

  it('never makes the sample being written the one the row-rate estimate compares against', () => {
    const node = {} as AudioWorkletNode;
    const refs = engineRefs(node);
    const buffer = createPositionRingBuffer();
    const writer = new PositionRingWriter(buffer);
    const consumer = createPositionRingConsumer(buffer, node, refs, () => {});
    const seen = new Set<unknown>();
    for (let i = 0; i < 6; i++) {
      const before = refs.workletPositionSampleRef.current;
      write(writer, report(i));
      consumer.drain();
      expect(refs.workletPositionSampleRef.current).not.toBe(before);
      seen.add(refs.workletPositionSampleRef.current);
    }
    expect(seen.size).toBe(2); // two preallocated samples, alternating
  });
});
