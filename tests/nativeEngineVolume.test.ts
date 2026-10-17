/**
 * Master volume is applied exactly once, by the master GainNode, for every engine (#489).
 *
 * The native C++ module scales its own render output by `volume_` (`buffer[i] *= volume_` in
 * cpp/openmpt_wrapper.cpp). The app used to push the slider value into it as well as into the master
 * GainNode, so the native engine played at volume² (−12 dB at 0.5, not −6 dB) and its analyser /
 * GPU-spectrum taps — which sit before the GainNode — came out scaled too. The JS worklet engine only
 * ever had the GainNode.
 *
 * The native AudioWorklet thread cannot start headless, so the C++ engine is a fake here whose
 * `setVolume` drives a GainNode exactly like the C++ render gain does. Everything else is production
 * code on real Web Audio (node-web-audio-api): `startNativePlayback`, `ensureCommonMasterNodes` and
 * `applyMasterLevels`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishFxHost } from '../audio/fx/fxHost';
import { ensureCommonMasterNodes } from '../hooks/audioGraph/masterGraph';
import { startNativePlayback } from '../hooks/audioGraph/startNativePlayback';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from '../hooks/audioGraph/types';
import { applyMasterLevels } from '../utils/audioMasterGraph';
import { setPcmDemandListener } from '../utils/pcmBus';
import { readAudioGraphSources } from './helpers/audioGraphSource';
import {
  WEB_AUDIO_TIMEOUT_MS,
  bufferFrom,
  channelsOf,
  createOfflineContext,
  maxAbsDiff,
  nwa,
  startRenderingWithTimeout,
} from './helpers/webAudioNode';

const SR = 48_000;
const LEN = 4_800;
const PAN = 0;
const VOLUMES = [1, 0.5, 0.25, 0] as const;

/** A stand-in for one engine's PCM: stereo, deterministic, loud enough that 0.25× is still far above float noise. */
function enginePcm(): Float32Array<ArrayBuffer>[] {
  const left = new Float32Array(LEN);
  const right = new Float32Array(LEN);
  for (let i = 0; i < LEN; i++) {
    left[i] = 0.6 * Math.sin((2 * Math.PI * 110 * i) / SR);
    right[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR);
  }
  return [left, right];
}

function graphRefs(): AudioGraphRefs {
  return {
    masterInputRef: { current: null },
    masterDirectRef: { current: null },
    analyserRef: { current: null },
    stereoPannerRef: { current: null },
    gainNodeRef: { current: null },
    // startNativePlayback
    nativeEngineRef: { current: null },
    fileDataRef: { current: null },
    audioWorkletNodeRef: { current: null },
    nativeBridgeLatencyRef: { current: -1 },
    nativeClockAnchorRef: { current: null },
    playbackEngineRef: { current: null },
    isPausedRef: { current: false },
    isPlayingRef: { current: false },
    animationFrameHandle: { current: 0 },
    updateUIRef: { current: () => {} },
  } as unknown as AudioGraphRefs;
}

/** The C++ engine as the app sees it: its volume is a render gain on the module's own output. */
function fakeNativeEngine(cppRenderGain: GainNode) {
  return {
    attachAudioContext: vi.fn(async () => {}),
    getLoadedFingerprint: vi.fn(() => null),
    load: vi.fn(async () => {}),
    commitModule: vi.fn(),
    setVolume: vi.fn((vol: number) => {
      cppRenderGain.gain.value = vol; // buffer[i] *= volume_
    }),
    setLoop: vi.fn(),
    setInterpolationLength: vi.fn(),
    removeAllListeners: vi.fn(),
    setPcmCapture: vi.fn(),
    getOutputNode: vi.fn(async () => cppRenderGain),
    on: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
  };
}

type Engine = 'js' | 'native';

interface Rendered {
  pcm: Float32Array<ArrayBuffer>[];
  /** The fake C++ engine, or null for the JS engine. */
  native: ReturnType<typeof fakeNativeEngine> | null;
}

/**
 * One engine feeding the production master chain at slider position `volume`. `moveSliderTo` is
 * applied after the engine started, like dragging the volume slider during playback.
 */
async function renderThroughMasterChain(
  engine: Engine,
  volume: number,
  moveSliderTo?: number,
): Promise<Rendered> {
  const ctx = createOfflineContext({ length: LEN, sampleRate: SR });
  const audioCtx = ctx as unknown as AudioContext;
  const refs = graphRefs();
  ensureCommonMasterNodes(audioCtx, refs, volume, PAN);

  const source = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, enginePcm()) });
  let native: ReturnType<typeof fakeNativeEngine> | null = null;

  if (engine === 'js') {
    // The JS worklet node connects straight to masterInput; it has no volume of its own.
    source.connect(refs.masterInputRef.current!);
  } else {
    const cppRenderGain = ctx.createGain();
    source.connect(cppRenderGain);
    native = fakeNativeEngine(cppRenderGain);
    refs.nativeEngineRef.current = native as unknown as AudioGraphRefs['nativeEngineRef']['current'];
    const callbacks = { setIsPlaying: vi.fn(), setStatus: vi.fn() } as unknown as AudioGraphCallbacks;
    const config = { volume, panValue: PAN, isLooping: false } as unknown as AudioGraphConfig;
    await expect(startNativePlayback(refs, callbacks, config, audioCtx)).resolves.toBe('started');
  }

  if (moveSliderTo !== undefined) {
    applyMasterLevels(
      { gainNodeRef: refs.gainNodeRef, stereoPannerRef: refs.stereoPannerRef },
      moveSliderTo,
      PAN,
    );
  }

  source.start(0);
  return { pcm: channelsOf(await startRenderingWithTimeout(ctx)), native };
}

function scaled(input: Float32Array<ArrayBuffer>[], gain: number): Float32Array<ArrayBuffer>[] {
  return input.map((channel) => Float32Array.from(channel, (x) => x * gain));
}

/** float32 gain math: a few ulps of the largest sample. */
const TOLERANCE = 1e-6;

describe('master volume is applied once (#489)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    publishFxHost(null);
    setPcmDemandListener(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts the native engine at unity whatever the slider says', async () => {
    for (const volume of VOLUMES) {
      const { native } = await renderThroughMasterChain('native', volume);
      expect(native!.setVolume.mock.calls.length).toBeGreaterThan(0);
      for (const [arg] of native!.setVolume.mock.calls) expect(arg).toBe(1);
    }
  }, WEB_AUDIO_TIMEOUT_MS);

  it.each(VOLUMES)('JS and native engines are equally loud at slider %s (= volume × engine PCM)', async (volume) => {
    const js = await renderThroughMasterChain('js', volume);
    const native = await renderThroughMasterChain('native', volume);
    const expected = scaled(enginePcm(), volume);

    expect(maxAbsDiff(js.pcm, expected)).toBeLessThan(TOLERANCE);
    expect(maxAbsDiff(native.pcm, expected)).toBeLessThan(TOLERANCE);
    expect(maxAbsDiff(native.pcm, js.pcm)).toBeLessThan(TOLERANCE);
  }, WEB_AUDIO_TIMEOUT_MS);

  it('moving the slider during playback scales both engines identically and never touches the C++ gain', async () => {
    for (const [from, to] of [[1, 0.5], [0.25, 1]] as const) {
      const js = await renderThroughMasterChain('js', from, to);
      const native = await renderThroughMasterChain('native', from, to);
      const expected = scaled(enginePcm(), to);

      expect(maxAbsDiff(js.pcm, expected)).toBeLessThan(TOLERANCE);
      expect(maxAbsDiff(native.pcm, expected)).toBeLessThan(TOLERANCE);
      // The only setVolume is the unity one at start — applyMasterLevels has no native branch.
      expect(native.native!.setVolume.mock.calls).toEqual([[1]]);
    }
  }, WEB_AUDIO_TIMEOUT_MS);

  it('no call site pushes a non-unity volume into the native engine', () => {
    // The hot-reload and slider paths live in hooks/useLibOpenMPT.ts, which cannot be rendered in a
    // node test, so guard them at the source: volume is the master GainNode's job.
    const sources = [
      readAudioGraphSources(),
      readFileSync(join(process.cwd(), 'hooks/useLibOpenMPT.ts'), 'utf8'),
    ].join('\n');
    const calls = [...sources.matchAll(/\.setVolume\(\s*([^)]*?)\s*\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['1']);
  });
});
