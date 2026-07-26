import { describe, expect, it } from 'vitest';
import { circularPageStart, overlayActualRow } from '../utils/playheadPrediction';

describe('circularPaging', () => {
  it('computes page start from fractional playhead', () => {
    expect(circularPageStart(0, 64)).toBe(0);
    expect(circularPageStart(63.9, 64)).toBe(0);
    expect(circularPageStart(64, 64)).toBe(64);
    expect(circularPageStart(96.5, 64)).toBe(64);
  });

  it('maps overlay step indices to paged matrix rows', () => {
    expect(overlayActualRow(0, 64, 64)).toBe(63);
    expect(overlayActualRow(0, 0, 64)).toBe(0);
    expect(overlayActualRow(16, 64, 64)).toBe(63);
    expect(overlayActualRow(32, 32.5, 64)).toBe(32);
  });
});
