import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyPatternBoundaryEvent,
  emptyPatternDiagSnapshot,
  GPU_MATRIX_WARN_MS,
  isPatternDiagEnabled,
  PATTERN_DIAG_MAX_EVENTS,
  recordPatternBoundaryEvent,
  resetPatternDiagCache,
  seedPatternDiag,
  type PatternBoundaryEvent,
} from '../utils/patternBoundaryDiag';
import { mergeAudioDiag } from '../utils/audioDiagOptions';
import { WORKLET_TO_MAIN } from '../audio-worklet/workletProtocolConstants';

const ROOT = join(__dirname, '..');

function event(partial: Partial<PatternBoundaryEvent> & Pick<PatternBoundaryEvent, 'kind' | 'ms'>): PatternBoundaryEvent {
  return { at: 0, ...partial };
}

describe('patternBoundaryDiag', () => {
  afterEach(() => {
    resetPatternDiagCache();
    window.location.search = '';
    delete window.__PATTERN_DIAG__;
  });

  it('is off by default', () => {
    window.location.search = '';
    resetPatternDiagCache();
    expect(isPatternDiagEnabled()).toBe(false);
  });

  it('turns on with ?patternDiag=1 or ?audioDiag=1', () => {
    window.location.search = '?patternDiag=1';
    resetPatternDiagCache();
    expect(isPatternDiagEnabled()).toBe(true);

    window.location.search = '?audioDiag=1';
    resetPatternDiagCache();
    expect(isPatternDiagEnabled()).toBe(true);
  });

  it('tracks worst-case GPU / UI / native costs', () => {
    let snap = emptyPatternDiagSnapshot();
    snap = applyPatternBoundaryEvent(snap, event({ kind: 'gpu-matrix', ms: 3, path: 'compute', shader: 'patternv0.30b.wgsl' }));
    snap = applyPatternBoundaryEvent(snap, event({ kind: 'gpu-matrix', ms: 12, path: 'compute', shader: 'patternv0.30b.wgsl' }));
    snap = applyPatternBoundaryEvent(snap, event({ kind: 'order-change-ui', ms: 1.5, engine: 'worklet' }));
    snap = applyPatternBoundaryEvent(snap, event({ kind: 'native-pattern-read', ms: 20, channels: 32 }));

    expect(snap.lastGpuMatrixMs).toBe(12);
    expect(snap.maxGpuMatrixMs).toBe(12);
    expect(snap.maxGpuMatrixMs).toBeGreaterThan(GPU_MATRIX_WARN_MS);
    expect(snap.lastPath).toBe('compute');
    expect(snap.lastShader).toBe('patternv0.30b.wgsl');
    expect(snap.maxOrderChangeUiMs).toBe(1.5);
    expect(snap.maxNativeReadMs).toBe(20);
    expect(snap.lastEngine).toBe('worklet');
  });

  it('caps the event log at PATTERN_DIAG_MAX_EVENTS', () => {
    let snap = emptyPatternDiagSnapshot();
    for (let i = 0; i < PATTERN_DIAG_MAX_EVENTS + 5; i++) {
      snap = applyPatternBoundaryEvent(snap, event({ kind: 'gpu-matrix', ms: 1, at: i }));
    }
    expect(snap.events).toHaveLength(PATTERN_DIAG_MAX_EVENTS);
    expect(snap.events[0]?.at).toBe(5);
    expect(snap.events[PATTERN_DIAG_MAX_EVENTS - 1]?.at).toBe(PATTERN_DIAG_MAX_EVENTS + 4);
  });

  it('recordPatternBoundaryEvent is a no-op when disabled', () => {
    window.location.search = '';
    resetPatternDiagCache();
    recordPatternBoundaryEvent(event({ kind: 'gpu-matrix', ms: 50 }));
    expect(window.__PATTERN_DIAG__).toBeUndefined();
  });

  it('seedPatternDiag writes an empty snapshot when enabled', () => {
    window.location.search = '?audioDiag=1';
    resetPatternDiagCache();
    seedPatternDiag();
    expect(window.__PATTERN_DIAG__).toBeDefined();
    expect(window.__PATTERN_DIAG__?.events).toEqual([]);
  });

  it('recordPatternBoundaryEvent writes window.__PATTERN_DIAG__ when enabled', () => {
    window.location.search = '?patternDiag=1';
    resetPatternDiagCache();
    recordPatternBoundaryEvent(event({ kind: 'gpu-matrix', ms: 9, path: 'compute' }));
    expect(window.__PATTERN_DIAG__?.maxGpuMatrixMs).toBe(9);
    expect(window.__PATTERN_DIAG__?.lastPath).toBe('compute');
  });
});

describe('mergeAudioDiag', () => {
  it('keeps a session-max process() time and last slow quantum', () => {
    const first = mergeAudioDiag(undefined, {
      type: WORKLET_TO_MAIN.audioDiag,
      budgetMs: 2.9,
      quanta: 6,
      avgProcessMs: 2,
      maxProcessMs: 8,
      overruns: 1,
      wraps: 0,
      wrapMaxProcessMs: 1,
      wrapOverruns: 0,
      order: 2,
      row: 34,
      slowMs: 8,
      slowOrder: 2,
      slowRow: 34,
      pcmEnabled: false,
      audioLite: false,
    });
    expect(first.sessionMaxProcessMs).toBe(8);
    expect(first.lastSlowRow).toBe(34);
    expect(first.pcmEnabled).toBe(false);

    const second = mergeAudioDiag(first, {
      type: WORKLET_TO_MAIN.audioDiag,
      budgetMs: 2.9,
      quanta: 6,
      avgProcessMs: 1,
      maxProcessMs: 3,
      overruns: 0,
      wraps: 1,
      wrapMaxProcessMs: 0,
      wrapOverruns: 0,
      order: 3,
      row: 0,
      slowMs: 3,
      slowOrder: 3,
      slowRow: 0,
    });
    expect(second.sessionMaxProcessMs).toBe(8);
    expect(second.wraps).toBe(1);
    expect(second.lastSlowRow).toBe(0);
  });

  it('accumulates wrap-N history and callback-gap / heap fields', () => {
    const first = mergeAudioDiag(undefined, {
      type: WORKLET_TO_MAIN.audioDiag,
      budgetMs: 2.9,
      quanta: 6,
      avgProcessMs: 1.2,
      maxProcessMs: 3,
      overruns: 0,
      wraps: 1,
      wrapMaxProcessMs: 3,
      wrapOverruns: 0,
      order: 0,
      row: 0,
      wrapProcessMs: [3],
      maxCallbackGapMs: 1.5,
      heapBytes: 16_777_216,
      heapMoves: 1,
      playingChannels: 4,
    });
    expect(first.wrapProcessMs).toEqual([3]);
    expect(first.maxCallbackGapMs).toBe(1.5);
    expect(first.heapBytes).toBe(16_777_216);
    expect(first.playingChannels).toBe(4);

    const second = mergeAudioDiag(first, {
      type: WORKLET_TO_MAIN.audioDiag,
      budgetMs: 2.9,
      quanta: 6,
      avgProcessMs: 1.1,
      maxProcessMs: 4,
      overruns: 0,
      wraps: 1,
      wrapMaxProcessMs: 4,
      wrapOverruns: 0,
      order: 1,
      row: 0,
      wrapProcessMs: [3, 4],
      maxCallbackGapMs: 0.2,
      heapMoves: 1,
      playingChannels: 4,
    });
    expect(second.wrapProcessMs).toEqual([3, 4]);
    expect(second.wrapProcessMs?.[0]).toBe(3);
    expect(second.maxCallbackGapMs).toBe(1.5);
    expect(second.heapMoves).toBe(1);
  });
});

describe('pattern-boundary diag is wired into the order-change path', () => {
  it('records GPU matrix rebuild and order-change UI', () => {
    const renderer = readFileSync(join(ROOT, 'src/renderers/webgpu/WebGPURenderer.ts'), 'utf8');
    const updateUi = readFileSync(join(ROOT, 'hooks/libOpenMPT/createUpdateUI.ts'), 'utf8');
    const native = readFileSync(join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts'), 'utf8');
    expect(renderer).toContain("kind: 'gpu-matrix'");
    expect(renderer).toContain('recordPatternBoundaryEvent');
    expect(updateUi).toContain("kind: 'order-change-ui'");
    // Order-change cell walks were removed (shared-heap stall).
    expect(native).not.toContain("kind: 'native-pattern-read'");
  });
});
