import { describe, expect, it } from 'vitest';
import {
  parseSeekBarTime,
  counterFingerprint,
  countersAdvanced,
  checkAudioDiag,
  checkWrapOverrunDelta,
} from '../scripts/lib/audio-smoke-counters.mjs';
import { classifyAudioConsole } from '../scripts/lib/audio-smoke-config.mjs';

describe('audioSmokeCounters', () => {
  it('parseSeekBarTime parses M:SS', () => {
    expect(parseSeekBarTime('0:05')).toBe(5);
    expect(parseSeekBarTime('1:30')).toBe(90);
    expect(parseSeekBarTime('bad')).toBeNull();
  });

  it('countersAdvanced detects positionSec movement', () => {
    const before = { positionSec: 1, order: 0, row: 4, rowFraction: 4.1, isPlaying: true, audioEngine: 'worklet', audioContextState: 'running' };
    const after = { positionSec: 3, order: 0, row: 4, rowFraction: 4.1, isPlaying: true, audioEngine: 'worklet', audioContextState: 'running' };
    expect(countersAdvanced(before, after).advanced).toBe(true);
  });

  it('countersAdvanced detects rowFraction movement', () => {
    const before = { positionSec: null, order: 0, row: 4, rowFraction: 4.0, isPlaying: true, audioEngine: 'worklet', audioContextState: 'running' };
    const after = { positionSec: null, order: 0, row: 4, rowFraction: 6.5, isPlaying: true, audioEngine: 'worklet', audioContextState: 'running' };
    expect(countersAdvanced(before, after).advanced).toBe(true);
  });

  it('countersAdvanced fails when frozen', () => {
    const frozen = { positionSec: 2, order: 0, row: 8, rowFraction: 8.0, isPlaying: true, audioEngine: 'worklet', audioContextState: 'running' };
    expect(countersAdvanced(frozen, frozen).advanced).toBe(false);
    expect(counterFingerprint(frozen)).toContain('p:2');
  });

  it('checkAudioDiag fails on wrapOverruns', () => {
    expect(checkAudioDiag({ wrapOverruns: 0 }).ok).toBe(true);
    expect(checkAudioDiag({ wrapOverruns: 1 }).ok).toBe(false);
  });

  it('checkWrapOverrunDelta only fails on increases during a window', () => {
    expect(checkWrapOverrunDelta(1, { wrapOverruns: 1 }).ok).toBe(true);
    expect(checkWrapOverrunDelta(1, { wrapOverruns: 2 }).ok).toBe(false);
  });
});

describe('classifyAudioConsole', () => {
  it('flags worklet errors and runaway ended loops', () => {
    const single = classifyAudioConsole(['[PLAY] Worklet reported module ended']);
    expect(single.failures).toHaveLength(0);

    const runaway = classifyAudioConsole([
      '[PLAY] Worklet reported module ended',
      '[PLAY] Worklet reported module ended',
      '[PLAY] Worklet reported module ended',
    ], { maxEndedPerPhase: 2 });
    expect(runaway.failures.length).toBeGreaterThan(0);

    const err = classifyAudioConsole(['[PLAY] Worklet error: init failed']);
    expect(err.failures.length).toBe(1);
  });
});
