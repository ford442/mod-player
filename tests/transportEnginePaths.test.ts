/**
 * Engine start paths while the transport is paused:
 *  - the JS worklet's `loaded` ack (fault recovery #456, or a module load while paused) comes up paused;
 *  - the ScriptProcessor fallback renders silence without advancing the module while paused;
 *  - loading a module while paused cues it (stays paused) instead of starting it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/audioGraph/masterGraph', () => ({
  wireMasterOutput: vi.fn(),
  ensureCommonMasterNodes: vi.fn(),
  moduleBytesFromFileData: vi.fn(),
}));

import { MAIN_TO_WORKLET } from '../audio-worklet/workletProtocolConstants';
import { createLoadModule } from '../hooks/libOpenMPT/createModuleActions';
import type { LibOpenMPTRefs } from '../hooks/libOpenMPT/types';
import { runScriptProcessorFallback } from '../hooks/audioGraph/scriptProcessorFallback';
import { acceptWorkletLoaded } from '../hooks/audioGraph/startJsWorkletPlayback';
import type { AudioGraphCallbacks, AudioGraphRefs } from '../hooks/audioGraph/types';

const ref = <T,>(current: T) => ({ current });

function makeCallbacks() {
  return {
    setStatus: vi.fn(),
    setIsPlaying: vi.fn(),
    setActiveEngine: vi.fn(),
    setModuleInfo: vi.fn(),
    setSequencerMatrix: vi.fn(),
    stopMusic: vi.fn(),
    seekToStepWrapper: vi.fn(),
    updateUI: vi.fn(),
  };
}

describe('acceptWorkletLoaded (JS worklet `loaded` ack)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 11));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(paused: boolean) {
    const refs = {
      isPlayingRef: ref(false),
      isPausedRef: ref(paused),
      gainNodeRef: ref({ gain: { value: 0 } }),
      stereoPannerRef: ref({ pan: { value: 0 } }),
      animationFrameHandle: ref(0),
      updateUIRef: ref(() => {}),
    } as unknown as AudioGraphRefs;
    const callbacks = makeCallbacks();
    const node = { port: { postMessage: vi.fn() } };
    const ctx = { state: 'running', resume: vi.fn(() => Promise.resolve()) } as unknown as AudioContext;
    const config = { volume: 0.7, panValue: -0.25 };
    const run = () =>
      acceptWorkletLoaded(refs, callbacks as unknown as AudioGraphCallbacks, config, ctx, node as unknown as AudioWorkletNode);
    return { refs, callbacks, node, run };
  }

  const sent = (node: { port: { postMessage: ReturnType<typeof vi.fn> } }) =>
    node.port.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);

  it('starts playing when not paused', async () => {
    const { refs, callbacks, node, run } = setup(false);
    await run();
    expect(refs.isPlayingRef.current).toBe(true);
    expect(callbacks.setIsPlaying).toHaveBeenCalledWith(true);
    expect(callbacks.setStatus).toHaveBeenLastCalledWith('Playing...');
    expect(sent(node)).toEqual([MAIN_TO_WORKLET.play]);
    expect(callbacks.seekToStepWrapper).not.toHaveBeenCalled();
  });

  it('comes up paused, not playing, when the transport is paused', async () => {
    const { refs, callbacks, node, run } = setup(true);
    await run();
    expect(refs.isPlayingRef.current).toBe(false);
    expect(callbacks.setIsPlaying).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenLastCalledWith('Paused.');
    // Never un-silences the processor...
    expect(sent(node)).toEqual([MAIN_TO_WORKLET.pause]);
    // ...and puts the playhead/engine cursor back at the start the freshly loaded module is at.
    expect(callbacks.seekToStepWrapper).toHaveBeenCalledWith(0);
    // The UI loop is armed so resume (and the paused playhead) have something running.
    expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledTimes(1);
  });

  it('applies master gain and pan either way', async () => {
    for (const paused of [false, true]) {
      const { refs, run } = setup(paused);
      await run();
      expect(refs.gainNodeRef.current?.gain.value).toBe(0.7);
      expect(refs.stereoPannerRef.current?.pan.value).toBe(-0.25);
    }
  });

  it('resumes a suspended AudioContext only when it is actually going to play', async () => {
    const playing = setup(false);
    const playingCtx = { state: 'suspended', resume: vi.fn(() => Promise.resolve()) } as unknown as AudioContext;
    await acceptWorkletLoaded(
      playing.refs, playing.callbacks as unknown as AudioGraphCallbacks, { volume: 1, panValue: 0 }, playingCtx,
      playing.node as unknown as AudioWorkletNode,
    );
    expect(playingCtx.resume).toHaveBeenCalledTimes(1);

    const paused = setup(true);
    const pausedCtx = { state: 'suspended', resume: vi.fn(() => Promise.resolve()) } as unknown as AudioContext;
    await acceptWorkletLoaded(
      paused.refs, paused.callbacks as unknown as AudioGraphCallbacks, { volume: 1, panValue: 0 }, pausedCtx,
      paused.node as unknown as AudioWorkletNode,
    );
    expect(pausedCtx.resume).not.toHaveBeenCalled();
  });
});

describe('ScriptProcessor fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 3));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const BUFFER = 4096;

  function setup(paused: boolean) {
    const lib = {
      _malloc: vi.fn(() => 64),
      _openmpt_module_set_render_param: vi.fn(),
      _openmpt_module_read_float_stereo: vi.fn(() => BUFFER),
      _openmpt_module_set_position_order_row: vi.fn(),
      _openmpt_module_get_current_order: vi.fn(() => 0),
      _openmpt_module_get_current_row: vi.fn(() => 0),
      _openmpt_module_get_position_seconds: vi.fn(() => 0),
      _openmpt_module_get_current_estimated_bpm: vi.fn(() => 125),
      _openmpt_module_get_current_speed: vi.fn(() => 6),
      HEAPF32: { buffer: new ArrayBuffer(BUFFER * 4 * 4 + 256) },
    };
    const spNode = { connect: vi.fn(), onaudioprocess: null as null | ((e: unknown) => void) };
    const ctx = { sampleRate: 48000, currentTime: 0, createScriptProcessor: vi.fn(() => spNode) } as unknown as AudioContext;
    const workletNode = { port: { postMessage: vi.fn(), onmessage: null as unknown }, disconnect: vi.fn() };
    const refs = {
      spFallbackTriggered: ref(false),
      audioWorkletNodeRef: ref(workletNode),
      currentModulePtr: ref(1234),
      ensureMainThreadModuleRef: ref(null),
      fileDataRef: ref(null),
      libopenmptRef: ref(lib),
      spLeftBufPtr: ref(0),
      spRightBufPtr: ref(0),
      analyserRef: ref({}),
      scriptProcessorRef: ref(null),
      isPlayingRef: ref(false),
      isPausedRef: ref(paused),
      playbackEngineRef: ref(null),
      animationFrameHandle: ref(0),
      updateUIRef: ref(() => {}),
      workletBpmRef: ref(125),
      workletSpeedRef: ref(6),
      workletRowsPerSecRef: ref(8),
      workletPositionSampleRef: ref(null),
      workletOrderRef: ref(0),
      workletRowRef: ref(0),
      workletTimeRef: ref(0),
      workletTimestampRef: ref(0),
      lastWorkletUpdateRef: ref(0),
      patternMatricesRef: ref([]),
    } as unknown as AudioGraphRefs;
    const callbacks = makeCallbacks();
    const start = () =>
      runScriptProcessorFallback(
        refs, callbacks as unknown as AudioGraphCallbacks, { volume: 1, panValue: 0, isLooping: false }, ctx,
        workletNode as unknown as AudioWorkletNode,
      );
    const render = () => {
      const outL = new Float32Array(BUFFER).fill(0.5);
      const outR = new Float32Array(BUFFER).fill(0.5);
      spNode.onaudioprocess?.({
        outputBuffer: { getChannelData: (c: number) => (c === 0 ? outL : outR) },
      });
      return { outL, outR };
    };
    return { refs, callbacks, lib, start, render };
  }

  it('renders the module while playing, and records itself as the playing engine', async () => {
    const { refs, callbacks, lib, start, render } = setup(false);
    await start();
    expect(refs.playbackEngineRef.current).toBe('scriptprocessor');
    expect(refs.isPlayingRef.current).toBe(true);
    expect(callbacks.setIsPlaying).toHaveBeenCalledWith(true);
    render();
    expect(lib._openmpt_module_read_float_stereo).toHaveBeenCalledTimes(1);
  });

  it('renders silence without advancing the module while paused, and continues once resumed', async () => {
    const { refs, lib, start, render } = setup(false);
    await start();
    render();
    expect(lib._openmpt_module_read_float_stereo).toHaveBeenCalledTimes(1);

    refs.isPausedRef.current = true; // what createPauseMusic does for this engine
    const silent = render();
    expect(lib._openmpt_module_read_float_stereo).toHaveBeenCalledTimes(1); // module not advanced
    expect(Array.from(silent.outL.slice(0, 8))).toEqual(new Array(8).fill(0));
    expect(Array.from(silent.outR.slice(0, 8))).toEqual(new Array(8).fill(0));

    refs.isPausedRef.current = false; // what createResumeMusic does
    render();
    expect(lib._openmpt_module_read_float_stereo).toHaveBeenCalledTimes(2);
  });

  it('started while paused (e.g. after a worklet fault) stays paused', async () => {
    const { refs, callbacks, lib, start, render } = setup(true);
    await start();
    expect(refs.isPlayingRef.current).toBe(false);
    expect(callbacks.setIsPlaying).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenLastCalledWith('Paused.');
    render();
    expect(lib._openmpt_module_read_float_stereo).not.toHaveBeenCalled();
  });
});

describe('loading a module while paused (createLoadModule)', () => {
  function setup(paused: boolean) {
    const order: string[] = [];
    const refs = {
      libopenmptRef: ref({}),
      userModuleLoadedRef: ref(false),
      isPausedRef: ref(paused),
      playRef: ref(vi.fn(async () => { order.push('play'); })),
    } as unknown as LibOpenMPTRefs;
    const processModuleData = vi.fn(async () => { order.push('process'); });
    const load = createLoadModule(refs, vi.fn(), processModuleData);
    return { refs, processModuleData, load, order };
  }

  it('cues the module: keeps the pause through the load, then forces a real (re)load', async () => {
    const { refs, processModuleData, load, order } = setup(true);
    await load(new Uint8Array([1]), 'next.xm');
    expect(processModuleData).toHaveBeenCalledWith(expect.any(Uint8Array), 'next.xm', { keepPaused: true });
    expect(refs.playRef.current).toHaveBeenCalledWith({ forceModuleLoad: true });
    expect(order).toEqual(['process', 'play']);
  });

  it('still starts the module when it is loaded while playing or stopped', async () => {
    const { processModuleData, load, refs } = setup(false);
    await load(new Uint8Array([1]), 'next.xm');
    expect(processModuleData).toHaveBeenCalledWith(expect.any(Uint8Array), 'next.xm', undefined);
    expect(refs.playRef.current).toHaveBeenCalledWith({ forceModuleLoad: true });
  });
});
