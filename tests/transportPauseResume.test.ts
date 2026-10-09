/**
 * Transport state machine: stopped → playing → paused → playing → paused → stopped, driven through the
 * real createStopMusic / createPauseMusic / createResumeMusic with hand-built refs and a mock worklet
 * port. Plus the UI loop's playhead behaviour across a pause (createUpdateUI) — the part that, left
 * naive, extrapolates over a silent engine and jumps forward on resume.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_TO_WORKLET } from '../audio-worklet/workletProtocolConstants';
import {
  createPauseMusic,
  createResumeMusic,
  createStopMusic,
} from '../hooks/libOpenMPT/createTransportActions';
import { createUpdateUI } from '../hooks/libOpenMPT/createUpdateUI';
import type { LibOpenMPTRefs } from '../hooks/libOpenMPT/types';
import type { WorkletPositionSample } from '../utils/playheadPrediction';
import { createPauseClock } from '../utils/transportClock';

const ref = <T,>(current: T) => ({ current });

function makeAudioContext() {
  return {
    currentTime: 10,
    state: 'running' as AudioContextState,
    baseLatency: 0,
    outputLatency: 0.02,
    resume: vi.fn(() => Promise.resolve()),
  };
}

function makeNode() {
  return { port: { postMessage: vi.fn(), onmessage: (() => {}) as unknown }, disconnect: vi.fn() };
}

function makeSample(overrides: Partial<WorkletPositionSample> = {}): WorkletPositionSample {
  return {
    order: 0, row: 4, rowInt: 4, positionSeconds: 1, workletTime: 10, bpm: 125, speed: 6, ...overrides,
  };
}

function makeRefs() {
  const audioCtx = makeAudioContext();
  const node = makeNode();
  const nativeEngine = { pause: vi.fn(), play: vi.fn() };
  const updateUI = vi.fn();
  const refs = {
    libopenmptRef: ref(null),
    currentModulePtr: ref(0),
    audioContextRef: ref(audioCtx),
    scriptProcessorRef: ref(null),
    spLeftBufPtr: ref(0),
    spRightBufPtr: ref(0),
    spFallbackTriggered: ref(false),
    audioWorkletNodeRef: ref(node),
    nativeEngineRef: ref<typeof nativeEngine | null>(null),
    // Selection state (what the UI/engine toggle says) vs the engine that actually started playback.
    activeEngineRef: ref<'worklet' | 'native-worklet'>('worklet'),
    playbackEngineRef: ref<'worklet' | 'native-worklet' | 'scriptprocessor' | null>('worklet'),
    nativeClockAnchorRef: ref<object | null>(null),
    animationFrameHandle: ref(0),
    updateUIRef: ref(updateUI),
    uiLoopActiveRef: ref(false),
    isPlayingRef: ref(false),
    isPausedRef: ref(false),
    pauseClockRef: ref(createPauseClock()),
    channelStatesRef: ref([
      { volume: 0.8, trigger: 1, noteAge: 0 },
      { volume: 0.4, trigger: 0, noteAge: 3 },
    ]),
    workletPositionSampleRef: ref<WorkletPositionSample | null>(makeSample()),
    workletOrderRef: ref(0),
    workletRowRef: ref(4),
    workletTimeRef: ref(1),
    workletBpmRef: ref(125),
    workletSpeedRef: ref(6),
    workletRowsPerSecRef: ref(8),
    lastWorkletUpdateRef: ref(10),
    audioClockStartRef: ref(9),
    workletTimeAtStartRef: ref(0.5),
    driftAccumulatorRef: ref(0.02),
    lastCorrectedTimeRef: ref(9.9),
    pendingSeekRef: ref(null),
    seekAcknowledgedRef: ref(true),
  };
  const setters = {
    setIsPlaying: vi.fn(),
    setIsPaused: vi.fn(),
    setStatus: vi.fn(),
    setIsModuleLoaded: vi.fn(),
    setInstrumentNames: vi.fn(),
    setSampleNames: vi.fn(),
    setModuleFormat: vi.fn(),
    setModuleComments: vi.fn(),
  };
  return { refs, setters, audioCtx, node, nativeEngine, updateUI };
}

type Fixture = ReturnType<typeof makeRefs>;

function actions(f: Fixture) {
  const deps = { refs: f.refs as unknown as LibOpenMPTRefs, setters: f.setters as never, activeEngine: 'worklet' as const };
  return {
    stop: createStopMusic(deps),
    pause: createPauseMusic(deps),
    resume: createResumeMusic(deps),
  };
}

/** What the page does on a successful play(): flags + a running UI loop. */
function startPlaying(f: Fixture) {
  f.refs.isPlayingRef.current = true;
  f.refs.uiLoopActiveRef.current = true;
  f.refs.animationFrameHandle.current = 99;
}

const messageTypes = (f: Fixture) => f.node.port.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);

describe('transport state machine (worklet engine)', () => {
  let rafCalls: number;
  beforeEach(() => {
    rafCalls = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => { rafCalls += 1; return 42; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pause while stopped is a no-op', () => {
    const f = makeRefs();
    actions(f).pause();
    expect(f.node.port.postMessage).not.toHaveBeenCalled();
    expect(f.refs.isPausedRef.current).toBe(false);
    expect(f.setters.setIsPaused).not.toHaveBeenCalled();
    expect(f.setters.setStatus).not.toHaveBeenCalled();
  });

  it('resume while not paused is a no-op', () => {
    const f = makeRefs();
    startPlaying(f);
    actions(f).resume();
    expect(f.node.port.postMessage).not.toHaveBeenCalled();
    expect(f.refs.isPlayingRef.current).toBe(true);
  });

  it('pause silences the engine and keeps the position, the clock refs and the UI loop', () => {
    const f = makeRefs();
    startPlaying(f);
    f.audioCtx.currentTime = 10.5;
    actions(f).pause();

    expect(messageTypes(f)).toEqual([MAIN_TO_WORKLET.pause]);
    expect(f.refs.isPlayingRef.current).toBe(false);
    expect(f.refs.isPausedRef.current).toBe(true);
    expect(f.setters.setIsPlaying).toHaveBeenLastCalledWith(false);
    expect(f.setters.setIsPaused).toHaveBeenLastCalledWith(true);
    expect(f.setters.setStatus).toHaveBeenLastCalledWith('Paused.');
    expect(f.refs.pauseClockRef.current).toEqual({ pausedAt: 10.5, resumedAt: null });

    // Nothing stop would reset is reset.
    expect(f.refs.workletPositionSampleRef.current).toEqual(makeSample());
    expect(f.refs.workletOrderRef.current).toBe(0);
    expect(f.refs.workletRowRef.current).toBe(4);
    expect(f.refs.workletTimeRef.current).toBe(1);
    expect(f.refs.audioClockStartRef.current).toBe(9);
    expect(f.refs.workletTimeAtStartRef.current).toBe(0.5);
    expect(f.refs.driftAccumulatorRef.current).toBe(0.02);
    // The UI loop keeps running (it settles the playhead and is already alive for resume), the worklet
    // keeps its message handler (position / ended must still be handled), and the node stays wired.
    expect(f.refs.uiLoopActiveRef.current).toBe(true);
    expect(vi.mocked(cancelAnimationFrame)).not.toHaveBeenCalled();
    expect(f.node.port.onmessage).not.toBeNull();
    expect(f.node.disconnect).not.toHaveBeenCalled();
    // GPU channel meters go dark.
    expect(f.refs.channelStatesRef.current.map((c) => [c.volume, c.trigger])).toEqual([[0, 0], [0, 0]]);
  });

  it('a second pause does nothing', () => {
    const f = makeRefs();
    startPlaying(f);
    const { pause } = actions(f);
    pause();
    pause();
    expect(messageTypes(f)).toEqual([MAIN_TO_WORKLET.pause]);
  });

  it('resume continues, re-anchors the clocks and posts play after pause', () => {
    const f = makeRefs();
    startPlaying(f);
    const { pause, resume } = actions(f);
    f.audioCtx.currentTime = 10.5;
    pause();
    f.audioCtx.currentTime = 30;
    resume();

    expect(messageTypes(f)).toEqual([MAIN_TO_WORKLET.pause, MAIN_TO_WORKLET.play]);
    expect(f.refs.isPlayingRef.current).toBe(true);
    expect(f.refs.isPausedRef.current).toBe(false);
    expect(f.setters.setIsPaused).toHaveBeenLastCalledWith(false);
    expect(f.setters.setIsPlaying).toHaveBeenLastCalledWith(true);
    expect(f.setters.setStatus).toHaveBeenLastCalledWith('Playing...');

    // Same order/row: the stale sample is rebased to where the engine stopped (4 + 0.5 s * 8 = 8).
    const sample = f.refs.workletPositionSampleRef.current;
    expect(sample?.order).toBe(0);
    expect(sample?.row).toBeCloseTo(8);
    expect(sample?.workletTime).toBe(30);
    expect(f.refs.workletRowRef.current).toBe(8);
    expect(f.refs.workletTimeRef.current).toBeCloseTo(1.5);

    // Drift detector re-anchored: no drift, anchored at the resume instant and the paused song time.
    expect(f.refs.driftAccumulatorRef.current).toBe(0);
    expect(f.refs.audioClockStartRef.current).toBe(30);
    expect(f.refs.workletTimeAtStartRef.current).toBeCloseTo(1.5);
    expect(f.refs.pauseClockRef.current).toEqual({ pausedAt: null, resumedAt: 30 });
    // UI loop re-armed.
    expect(rafCalls).toBe(1);
  });

  it('resumes a suspended AudioContext', () => {
    const f = makeRefs();
    startPlaying(f);
    const { pause, resume } = actions(f);
    pause();
    f.audioCtx.state = 'suspended';
    resume();
    expect(f.audioCtx.resume).toHaveBeenCalledTimes(1);
  });

  it('runs stopped → playing → paused → playing → paused → stopped', () => {
    const f = makeRefs();
    const { stop, pause, resume } = actions(f);
    const states: string[] = [];
    const snap = () => states.push(
      f.refs.isPlayingRef.current ? 'playing' : f.refs.isPausedRef.current ? 'paused' : 'stopped',
    );

    snap();                       // stopped
    startPlaying(f); snap();      // playing
    pause(); snap();              // paused
    resume(); snap();             // playing
    pause(); snap();              // paused
    stop(); snap();               // stopped

    expect(states).toEqual(['stopped', 'playing', 'paused', 'playing', 'paused', 'stopped']);
    // pause, play, pause, then stop's own pause of the processor — in that order.
    expect(messageTypes(f)).toEqual([
      MAIN_TO_WORKLET.pause, MAIN_TO_WORKLET.play, MAIN_TO_WORKLET.pause, MAIN_TO_WORKLET.pause,
    ]);
  });

  it('stop after pause resets to the start and cannot be resumed', () => {
    const f = makeRefs();
    startPlaying(f);
    const { stop, pause, resume } = actions(f);
    pause();
    stop();

    expect(f.refs.isPausedRef.current).toBe(false);
    expect(f.setters.setIsPaused).toHaveBeenLastCalledWith(false);
    expect(f.refs.pauseClockRef.current).toEqual(createPauseClock());
    expect(f.refs.workletOrderRef.current).toBe(0);
    expect(f.refs.workletRowRef.current).toBe(0);
    expect(f.refs.workletTimeRef.current).toBe(0);
    expect(f.refs.workletPositionSampleRef.current).toBeNull();
    expect(f.refs.driftAccumulatorRef.current).toBe(0);
    expect(f.refs.audioClockStartRef.current).toBe(0);
    expect(f.setters.setStatus).toHaveBeenLastCalledWith('Stopped.');

    f.node.port.postMessage.mockClear();
    resume(); // nothing to resume
    expect(f.node.port.postMessage).not.toHaveBeenCalled();
  });

  it('survives a node torn down mid-flight (postMessage throwing)', () => {
    const f = makeRefs();
    startPlaying(f);
    const { pause, resume } = actions(f);
    f.node.port.postMessage.mockImplementation(() => { throw new Error('port closed'); });
    expect(() => { pause(); resume(); }).not.toThrow();
    expect(f.refs.isPlayingRef.current).toBe(true);
  });
});

describe('transport state machine (native engine)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pauses and resumes through the engine exports, not the worklet port, and drops the stale clock anchor', () => {
    const f = makeRefs();
    f.refs.activeEngineRef.current = 'native-worklet';
    f.refs.playbackEngineRef.current = 'native-worklet';
    f.refs.nativeEngineRef.current = f.nativeEngine;
    f.refs.nativeClockAnchorRef.current = { frameSecondsAtAnchor: 0, mainHeardTimeAtAnchor: 9, bridgeLatencySec: 0 };
    startPlaying(f);
    const { pause, resume } = actions(f);

    pause();
    expect(f.nativeEngine.pause).toHaveBeenCalledTimes(1);
    expect(f.node.port.postMessage).not.toHaveBeenCalled();
    // The native clock anchor survives the pause itself.
    expect(f.refs.nativeClockAnchorRef.current).not.toBeNull();

    resume();
    expect(f.nativeEngine.play).toHaveBeenCalledTimes(1);
    expect(f.node.port.postMessage).not.toHaveBeenCalled();
    // The frame clock stopped while paused, so the anchor that mapped it is stale.
    expect(f.refs.nativeClockAnchorRef.current).toBeNull();
  });
});

describe('which engine pause/resume drive', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows the engine that started playback, not the selection state (failed native start → JS fallback)', () => {
    // Real-browser finding: after a failed native start the app falls back to the JS worklet but
    // activeEngine still says native, and a native engine object exists. Pausing the "selected" engine
    // left the audio playing.
    const f = makeRefs();
    f.refs.activeEngineRef.current = 'native-worklet';
    f.refs.nativeEngineRef.current = f.nativeEngine;
    f.refs.playbackEngineRef.current = 'worklet';
    startPlaying(f);
    const { pause, resume } = actions(f);

    pause();
    expect(messageTypes(f)).toEqual([MAIN_TO_WORKLET.pause]);
    expect(f.nativeEngine.pause).not.toHaveBeenCalled();

    resume();
    expect(messageTypes(f)).toEqual([MAIN_TO_WORKLET.pause, MAIN_TO_WORKLET.play]);
    expect(f.nativeEngine.play).not.toHaveBeenCalled();
  });

  it('the ScriptProcessor fallback is paused by the flag alone — no engine or port is touched', () => {
    const f = makeRefs();
    f.refs.nativeEngineRef.current = f.nativeEngine;
    f.refs.playbackEngineRef.current = 'scriptprocessor';
    f.refs.audioWorkletNodeRef.current = null as never;
    startPlaying(f);
    const { pause, resume } = actions(f);

    pause();
    expect(f.refs.isPausedRef.current).toBe(true);
    expect(f.nativeEngine.pause).not.toHaveBeenCalled();
    expect(f.node.port.postMessage).not.toHaveBeenCalled();

    resume();
    expect(f.refs.isPlayingRef.current).toBe(true);
    expect(f.nativeEngine.play).not.toHaveBeenCalled();
    expect(f.node.port.postMessage).not.toHaveBeenCalled();
  });
});

describe('UI loop playhead across a pause (createUpdateUI)', () => {
  const RPS = 8;
  const LATENCY = 0.02;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 5));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  function makeLoop() {
    const f = makeRefs();
    startPlaying(f);
    const extra = {
      libopenmptRef: ref(null),
      workletTimestampRef: ref(10),
      patternMatricesRef: ref([]),
      playbackStateRef: ref({
        playheadRow: 0, currentOrder: 0, timeSec: 0, beatPhase: 0, kickTrigger: 0, grooveAmount: 0, lastUpdateTimestamp: 0,
      }),
      playheadLagTrackerRef: ref({}),
      positionReportTrackerRef: ref({}),
      lastPositionSampleTimeRef: ref(-1),
      lastUiOrderRef: ref(0),
      lastUiRowIntRef: ref(-1),
      lastUiBpmRef: ref(-1),
      lastSyncDebugUiMsRef: ref(0),
      lastChannelStatePublishMsRef: ref(0),
      noteAgesScratchRef: ref([]),
      lastUpdateTimeRef: ref(0),
    };
    Object.assign(f.refs, extra);
    const uiSetters = {
      setModuleInfo: vi.fn(), setSequencerMatrix: vi.fn(), setSequencerCurrentRow: vi.fn(),
      setSequencerGlobalRow: vi.fn(), setPlaybackSeconds: vi.fn(), setPlaybackRowFraction: vi.fn(),
      setChannelStates: vi.fn(), setBeatPhase: vi.fn(), setSyncDebug: vi.fn(),
    };
    const updateUI = createUpdateUI({
      refs: f.refs as unknown as LibOpenMPTRefs,
      setters: uiSetters as never,
      activeEngine: 'worklet',
      kickTrigger: 0,
      grooveAmount: 0,
    });
    f.audioCtx.outputLatency = LATENCY;
    f.refs.workletRowsPerSecRef.current = RPS;
    f.refs.audioClockStartRef.current = 10; // as startAudioPlayback sets it
    f.refs.workletTimeAtStartRef.current = 1;
    f.refs.driftAccumulatorRef.current = 0;
    const tickAt = (t: number) => {
      f.audioCtx.currentTime = t;
      updateUI();
      return extra.playbackStateRef.current;
    };
    return { f, tickAt, playbackStateRef: extra.playbackStateRef, ...actions(f) };
  }

  it('follows the audio already in flight, then holds at the stop position however long it stays paused', () => {
    const { tickAt, pause, playbackStateRef } = makeLoop();
    // Heard time = currentTime - 0.02, so the sample (row 4 @ t=10) is at 4 + (10.48 - 10) * 8 = 7.84.
    expect(tickAt(10.5).playheadRow).toBeCloseTo(7.84);
    pause(); // pausedAt = 10.5
    // 10 ms later the ear is still hearing audio rendered before the pause: still following.
    expect(tickAt(10.51).playheadRow).toBeCloseTo(7.92);
    // Once the ear has caught up with where rendering stopped (4 + 0.5 * 8 = 8) it holds there.
    expect(tickAt(10.6).playheadRow).toBeCloseTo(8);
    expect(tickAt(40).playheadRow).toBeCloseTo(8);
    expect(tickAt(500).playheadRow).toBeCloseTo(8);
    expect(playbackStateRef.current.timeSec).toBeCloseTo(1.5);
  });

  it('does not measure drift while paused', () => {
    const { f, tickAt, pause } = makeLoop();
    tickAt(10.5);
    pause();
    f.refs.driftAccumulatorRef.current = 0.05;
    tickAt(60);
    expect(f.refs.driftAccumulatorRef.current).toBe(0.05);
  });

  it('resumes from the same row with no jump and no drift correction, then advances', () => {
    const { f, tickAt, pause, resume } = makeLoop();
    tickAt(10.5);
    pause();
    const held = tickAt(40).playheadRow;
    expect(held).toBeCloseTo(8);

    f.audioCtx.currentTime = 40;
    resume();
    // First frame after resume, one output latency "early": exactly the paused position, zero drift.
    const first = tickAt(40);
    expect(first.playheadRow).toBeCloseTo(held);
    expect(first.timeSec).toBeCloseTo(1.5);
    expect(f.refs.driftAccumulatorRef.current).toBeCloseTo(0);
    // 0.3 s of real audio later the playhead has advanced 0.3 s from the paused position.
    expect(tickAt(40.3 + LATENCY).playheadRow).toBeCloseTo(held + 0.3 * RPS);
    expect(f.refs.driftAccumulatorRef.current).toBeCloseTo(0);
  });

  it('a position report that was already in flight when the pause landed is absorbed without a jump', () => {
    const { f, tickAt, pause } = makeLoop();
    tickAt(10.5);
    pause(); // pausedAt = 10.5
    // The processor rendered one more quantum before it saw the pause and reported it: a newer, more
    // accurate sample (row 7.9 @ t=10.49) — consistent with the old one, within a hair.
    f.refs.workletPositionSampleRef.current = makeSample({ row: 7.9, rowInt: 7, positionSeconds: 1.49, workletTime: 10.49 });
    // Held position = 7.9 + (10.5 - 10.49) * 8 = 7.98 — within 0.03 rows of the previous 8.0.
    expect(Math.abs(tickAt(60).playheadRow - 8)).toBeLessThan(0.03);
  });

  it('seeking while paused moves the playhead and it stays put until resume', () => {
    const { f, tickAt, pause, resume } = makeLoop();
    tickAt(10.5);
    pause();
    // createSeekToStep clears the sample and parks the refs at the target; the engine renders nothing.
    f.refs.workletPositionSampleRef.current = null;
    f.refs.workletOrderRef.current = 0;
    f.refs.workletRowRef.current = 32;
    f.refs.workletTimeRef.current = 0;
    expect(tickAt(30).playheadRow).toBe(32);
    expect(tickAt(90).playheadRow).toBe(32);

    f.audioCtx.currentTime = 90;
    resume(); // nothing to rebase — the first fresh report will take over
    expect(tickAt(90).playheadRow).toBe(32);
    expect(f.refs.driftAccumulatorRef.current).toBe(0);
  });
});
