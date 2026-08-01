import { describe, expect, it } from 'vitest';
import {
  createPlayheadLagTracker,
  createPositionReportTracker,
  PLAYHEAD_LAG_WARN_CONSECUTIVE,
  PLAYHEAD_LAG_WARN_ROWS,
  trackPositionReport,
  updatePlayheadLagTracker,
} from '../utils/playheadLagMonitor';

describe('playheadLagMonitor', () => {
  it('warns after sustained high lag', () => {
    let tracker = createPlayheadLagTracker();
    let warning: string | null = null;
    const sample = 10;
    const smoothed = sample + PLAYHEAD_LAG_WARN_ROWS + 0.1;

    for (let i = 0; i < PLAYHEAD_LAG_WARN_CONSECUTIVE; i++) {
      const result = updatePlayheadLagTracker(tracker, sample, smoothed, i * 16);
      tracker = result.tracker;
      if (result.warning) warning = result.warning;
    }

    expect(warning).not.toBeNull();
    expect(String(warning)).toMatch(/sustained playhead lag/);
    expect(tracker.maxAbsLagRows).toBeGreaterThan(PLAYHEAD_LAG_WARN_ROWS);
  });

  it('resets consecutive counter when lag drops', () => {
    let tracker = createPlayheadLagTracker();
    const high = updatePlayheadLagTracker(tracker, 0, 3, 0);
    tracker = high.tracker;
    expect(tracker.consecutiveHighLag).toBe(1);

    const ok = updatePlayheadLagTracker(tracker, 10, 10.2, 16);
    expect(ok.tracker.consecutiveHighLag).toBe(0);
    expect(ok.warning).toBeNull();
  });

  it('tracks position reports near 60 Hz without flood warning', () => {
    let tracker = createPositionReportTracker(0);
    let warning: string | null = null;
    for (let i = 0; i < 60; i++) {
      const t = i * (1000 / 60);
      const result = trackPositionReport(tracker, t);
      tracker = result.tracker;
      if (result.warning) warning = result.warning;
    }
    expect(tracker.hz).toBeLessThanOrEqual(65);
    expect(warning).toBeNull();
  });

  it('warns on position report flood', () => {
    let tracker = createPositionReportTracker(0);
    let warning: string | null = null;
    for (let i = 0; i < 400; i++) {
      const t = i * (128 / 44100) * 1000;
      const result = trackPositionReport(tracker, t);
      tracker = result.tracker;
      if (result.warning) warning = result.warning;
    }
    expect(warning).not.toBeNull();
    expect(String(warning)).toMatch(/position report flood/);
  });
});
