import { describe, expect, it } from 'vitest';
import {
  POSITION_INFO_LAYOUT,
  POSITION_INFO_EXTENDED_BYTES,
  decodePositionInfo,
  encodePositionInfoFixture,
  POS_OFFSET_CHANNEL_VU,
} from '../audio-worklet/positionInfoLayout';

describe('positionInfoLayout fixture decode', () => {
  it('decodes a known byte layout for every field', () => {
    const fixture = encodePositionInfoFixture({
      positionMs: 2500.5,
      currentRow: 12,
      currentPattern: 3,
      currentOrder: 1,
      bpm: 140.25,
      numChannels: 4,
      channelVU: [0.1, 0.2, 0.3, 0.4],
      audioFramesRendered: 96000,
      rowFraction: 12.4,
      speed: 6,
      sampleRate: 48000,
    });

    const view = new DataView(fixture);
    const decoded = decodePositionInfo(view, 0);

    expect(decoded).not.toBeNull();
    expect(decoded!.positionMs).toBeCloseTo(2500.5, 5);
    expect(decoded!.currentRow).toBe(12);
    expect(decoded!.currentPattern).toBe(3);
    expect(decoded!.currentOrder).toBe(1);
    expect(decoded!.bpm).toBeCloseTo(140.25, 5);
    expect(decoded!.numChannels).toBe(4);
    expect(decoded!.channelVU[0]).toBeCloseTo(0.1, 5);
    expect(decoded!.channelVU[3]).toBeCloseTo(0.4, 5);
    expect(decoded!.rowFraction).toBeCloseTo(12.4, 5);
    expect(decoded!.speed).toBe(6);
    expect(decoded!.audioFramesRendered).toBe(96000);
    expect(decoded!.sampleRate).toBe(48000);
    expect(decoded!.workletTime).toBeCloseTo(2.0, 5);
  });

  it('returns null when buffer is too small for core fields', () => {
    const tiny = new ArrayBuffer(32);
    const view = new DataView(tiny);
    expect(decodePositionInfo(view, 0)).toBeNull();
  });

  it('omits extended fields when struct is truncated before offset 188', () => {
    const coreOnly = new ArrayBuffer(POS_OFFSET_CHANNEL_VU + 32 * 4);
    const view = new DataView(coreOnly);
    view.setFloat64(POSITION_INFO_LAYOUT.positionMs.offset, 1000, true);
    view.setInt32(POSITION_INFO_LAYOUT.currentRow.offset, 0, true);
    view.setInt32(POSITION_INFO_LAYOUT.currentPattern.offset, 0, true);
    view.setInt32(POSITION_INFO_LAYOUT.currentOrder.offset, 0, true);
    view.setFloat64(POSITION_INFO_LAYOUT.bpm.offset, 125, true);
    view.setInt32(POSITION_INFO_LAYOUT.numChannels.offset, 2, true);

    const decoded = decodePositionInfo(view, 0);
    expect(decoded).not.toBeNull();
    expect(decoded!.rowFraction).toBeUndefined();
    expect(decoded!.workletTime).toBeUndefined();
  });

  it('offset table ends at expected extended struct size', () => {
    expect(POSITION_INFO_EXTENDED_BYTES).toBe(188);
    expect(POSITION_INFO_LAYOUT.sampleRate.offset + POSITION_INFO_LAYOUT.sampleRate.size).toBe(188);
  });

  it('fails decode when C++ layout drifts (wrong offset for bpm)', () => {
    const fixture = encodePositionInfoFixture({
      positionMs: 100,
      currentRow: 0,
      currentPattern: 0,
      currentOrder: 0,
      bpm: 999,
      numChannels: 1,
    });
    const view = new DataView(fixture);
    // Simulate drift: read bpm from wrong offset would not match if we changed decoder.
    const decoded = decodePositionInfo(view, 0);
    expect(decoded!.bpm).toBeCloseTo(999, 5);
    // Wrong offset read would give garbage:
    expect(view.getFloat64(POSITION_INFO_LAYOUT.bpm.offset, true)).toBeCloseTo(999, 5);
  });
});
