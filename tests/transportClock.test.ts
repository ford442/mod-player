import { describe, expect, it } from 'vitest';
import {
  predictPlayheadFromSample,
  type WorkletPositionSample,
} from '../utils/playheadPrediction';
import {
  createPauseClock,
  deriveTransportState,
  effectiveHeardTime,
  mediaSessionPlaybackState,
  playShouldResume,
  rebaseSampleForResume,
  silenceChannelStates,
} from '../utils/transportClock';

const RPS = 8; // rows per second

function sample(overrides: Partial<WorkletPositionSample> = {}): WorkletPositionSample {
  return {
    order: 0,
    row: 4,
    rowInt: 4,
    positionSeconds: 1,
    workletTime: 10,
    bpm: 125,
    speed: 6,
    ...overrides,
  };
}

describe('transport state helpers', () => {
  it('derives stopped / playing / paused from the two flags', () => {
    expect(deriveTransportState(false, false)).toBe('stopped');
    expect(deriveTransportState(true, false)).toBe('playing');
    expect(deriveTransportState(false, true)).toBe('paused');
  });

  it('maps paused to mediaSession "paused", never "none" (which would dismiss the OS media card)', () => {
    expect(mediaSessionPlaybackState('playing')).toBe('playing');
    expect(mediaSessionPlaybackState('paused')).toBe('paused');
    expect(mediaSessionPlaybackState('stopped')).toBe('none');
  });

  it('play() resumes while paused, except for an explicit module (re)load', () => {
    expect(playShouldResume(true)).toBe(true);
    expect(playShouldResume(true, {})).toBe(true);
    expect(playShouldResume(true, { forceModuleLoad: true })).toBe(false);
    expect(playShouldResume(false)).toBe(false);
    expect(playShouldResume(false, { forceModuleLoad: true })).toBe(false);
  });

  it('silences channel levels in place', () => {
    const channels = [{ volume: 0.9, trigger: 1 }, { volume: 0.2, trigger: 0 }];
    silenceChannelStates(channels);
    expect(channels).toEqual([{ volume: 0, trigger: 0 }, { volume: 0, trigger: 0 }]);
  });
});

describe('effectiveHeardTime', () => {
  it('is the identity when the transport never paused (normal playback is unchanged)', () => {
    expect(effectiveHeardTime(12.5, createPauseClock())).toBe(12.5);
  });

  it('is capped at the pause instant while paused, so the playhead stops following a silent clock', () => {
    const clock = { pausedAt: 10.5, resumedAt: null };
    expect(effectiveHeardTime(10.2, clock)).toBe(10.2); // still hearing audio already in flight
    expect(effectiveHeardTime(10.5, clock)).toBe(10.5);
    expect(effectiveHeardTime(99, clock)).toBe(10.5);
  });

  it('is floored at the resume instant after a resume, until the ear catches up', () => {
    const clock = { pausedAt: null, resumedAt: 30 };
    expect(effectiveHeardTime(29.98, clock)).toBe(30); // new audio not heard yet: hold, don't go backwards
    expect(effectiveHeardTime(30.4, clock)).toBe(30.4);
  });
});

describe('rebaseSampleForResume', () => {
  it('carries the position the engine stopped at, stamped with the resume instant', () => {
    // Paused 0.5 s after the sample: 4 + 0.5 * 8 = row 8, song position 1.5 s.
    const rebased = rebaseSampleForResume(sample(), RPS, 10.5, 30);
    expect(rebased.row).toBeCloseTo(8);
    expect(rebased.rowInt).toBe(8);
    expect(rebased.positionSeconds).toBeCloseTo(1.5);
    expect(rebased.workletTime).toBe(30);
    // Everything else about the sample is preserved.
    expect(rebased.order).toBe(0);
    expect(rebased.bpm).toBe(125);
    expect(rebased.speed).toBe(6);
  });

  it('does not mutate the stale sample', () => {
    const stale = sample();
    rebaseSampleForResume(stale, RPS, 10.5, 30);
    expect(stale).toEqual(sample());
  });
});

describe('pause → resume playhead continuity', () => {
  const pausedAt = 10.5;
  const resumeAt = 30; // a 19.5 s pause
  const stale = sample();

  const shown = (s: WorkletPositionSample, heard: number, clock: Parameters<typeof effectiveHeardTime>[1]) =>
    predictPlayheadFromSample(s, effectiveHeardTime(heard, clock), RPS);

  it('holds the paused position however long the pause lasts', () => {
    const clock = { pausedAt, resumedAt: null };
    const atStop = shown(stale, pausedAt, clock).playheadRow;
    expect(atStop).toBeCloseTo(8);
    expect(shown(stale, 11, clock).playheadRow).toBeCloseTo(atStop);
    expect(shown(stale, 29, clock).playheadRow).toBeCloseTo(atStop);
  });

  it('shows the paused position on the first frame after resume, then advances from it', () => {
    const heldRow = shown(stale, 29, { pausedAt, resumedAt: null }).playheadRow;
    const rebased = rebaseSampleForResume(stale, RPS, pausedAt, resumeAt);
    const clock = { pausedAt: null, resumedAt: resumeAt };

    // First frame after resume: heard time is still ~one output latency behind the resume instant.
    const first = shown(rebased, resumeAt - 0.02, clock);
    expect(first.playheadRow).toBeCloseTo(heldRow);
    expect(first.positionSeconds).toBeCloseTo(1.5);
    expect(first.dtSec).toBe(0);

    // A quarter second later: advanced by 0.25 s of audio.
    expect(shown(rebased, resumeAt + 0.25, clock).playheadRow).toBeCloseTo(heldRow + 0.25 * RPS);
  });

  it('would jump forward by the extrapolation window without the rebase (why it exists)', () => {
    // Resuming on the stale sample: dt is clamped at +2 s, i.e. 16 rows of phantom playhead.
    const naive = predictPlayheadFromSample(stale, resumeAt, RPS).playheadRow;
    expect(naive - 8).toBeGreaterThan(5);
  });
});
