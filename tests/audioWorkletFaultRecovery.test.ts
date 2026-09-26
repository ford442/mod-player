/**
 * #runtime-hardening: a wasm trap inside the JS AudioWorklet's process() (or a
 * native `node.onprocessorerror`) used to kill the node silently while the UI
 * kept showing "Playing". hooks/audioGraph/startJsWorkletPlayback.ts's
 * handleWorkletFault() tears the node down, records the fault in
 * utils/audioEngineFaultState.ts, attempts one restart (reusing the shared
 * libopenmpt instance — see ensureSharedLibOpenMPT), and falls back to
 * ScriptProcessorNode if that restart faults again.
 *
 * The restart branch (attempt 1) recurses into startJsWorkletPlayback, which
 * this Node/vitest environment cannot actually complete (no AudioWorkletNode
 * global) — it fails inside that function's own try/catch and returns
 * 'failed', which is itself a meaningful assertion: the store must NOT clear
 * a fault the restart didn't actually resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { scriptProcessorFallback } = vi.hoisted(() => ({
  scriptProcessorFallback: vi.fn(async () => {}),
}));
vi.mock('../hooks/audioGraph/scriptProcessorFallback', () => ({
  runScriptProcessorFallback: scriptProcessorFallback,
}));

import { handleWorkletFault } from '../hooks/audioGraph/startJsWorkletPlayback';
import {
  getAudioFaultState,
  __resetAudioFaultStateForTests,
} from '../utils/audioEngineFaultState';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from '../hooks/audioGraph/types';

function makeRefs(): AudioGraphRefs {
  return {
    workletLoadedRef: { current: true },
    audioWorkletNodeRef: { current: null },
    isPlayingRef: { current: true },
  } as unknown as AudioGraphRefs;
}

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
  } as unknown as AudioGraphCallbacks & { setStatus: ReturnType<typeof vi.fn>; setIsPlaying: ReturnType<typeof vi.fn> };
}

function makeNode() {
  return {
    onprocessorerror: null as unknown,
    port: {
      postMessage: vi.fn(),
      onmessage: (() => {}) as unknown,
    },
    disconnect: vi.fn(),
  };
}

const config = {} as AudioGraphConfig;

describe('handleWorkletFault (JS worklet crash recovery)', () => {
  beforeEach(() => {
    __resetAudioFaultStateForTests();
    scriptProcessorFallback.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetAudioFaultStateForTests();
  });

  it('tears the node down and puts the store in a faulted state; never reports "Playing" while faulted', async () => {
    const refs = makeRefs();
    const callbacks = makeCallbacks();
    const node = makeNode();
    refs.audioWorkletNodeRef.current = node as unknown as AudioWorkletNode;
    const ctx = {} as AudioContext; // no .audioWorklet — the nested restart fails fast, on purpose

    await handleWorkletFault(refs, callbacks, config, ctx, node as unknown as AudioWorkletNode, 'processor-error', 'boom');

    // Store reflects the fault.
    const state = getAudioFaultState();
    expect(state.faulted).toBe(true);
    expect(state.reason).toBe('processor-error');
    expect(state.message).toBe('boom');
    expect(state.restartAttempts).toBe(1);

    // isPlaying goes false immediately — the caller's next render can't show "Playing".
    expect(refs.isPlayingRef.current).toBe(false);
    expect(callbacks.setIsPlaying).toHaveBeenCalledWith(false);
    for (const call of callbacks.setStatus.mock.calls) {
      expect(call[0]).not.toBe('Playing...');
    }

    // The faulted node itself was torn down and detached from refs.
    expect(node.disconnect).toHaveBeenCalled();
    expect(node.port.onmessage).toBeNull();
    expect(refs.audioWorkletNodeRef.current).toBeNull();

    // The restart attempt (recursing into startJsWorkletPlayback) could not
    // actually complete in this environment — it must NOT have cleared the
    // fault it did not resolve.
    expect(getAudioFaultState().faulted).toBe(true);
    expect(scriptProcessorFallback).not.toHaveBeenCalled();
  });

  it('falls back to ScriptProcessorNode when a second fault hits before the first is cleared', async () => {
    const refs = makeRefs();
    const callbacks = makeCallbacks();
    const ctx = {} as AudioContext;

    const firstNode = makeNode();
    refs.audioWorkletNodeRef.current = firstNode as unknown as AudioWorkletNode;
    await handleWorkletFault(refs, callbacks, config, ctx, firstNode as unknown as AudioWorkletNode, 'process-trap', 'first trap');
    expect(getAudioFaultState().restartAttempts).toBe(1);
    expect(scriptProcessorFallback).not.toHaveBeenCalled();

    // The (failed) restart's own node faults again immediately.
    const secondNode = makeNode();
    refs.audioWorkletNodeRef.current = secondNode as unknown as AudioWorkletNode;
    await handleWorkletFault(refs, callbacks, config, ctx, secondNode as unknown as AudioWorkletNode, 'process-trap', 'second trap');

    expect(getAudioFaultState().restartAttempts).toBe(2);
    expect(getAudioFaultState().reason).toBe('restart-failed');
    expect(scriptProcessorFallback).toHaveBeenCalledTimes(1);
    expect(scriptProcessorFallback).toHaveBeenCalledWith(refs, callbacks, config, ctx, secondNode);
  });
});
