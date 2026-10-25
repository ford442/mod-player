/**
 * Master volume is applied exactly once, by the master GainNode (#489).
 *
 * The engine node feeds `masterInput` at unity and has no volume of its own; the slider value only
 * ever reaches the master GainNode after the analyser, so the output is `volume × engine PCM` and the
 * analyser / GPU-spectrum taps stay unscaled. A stand-in AudioBufferSourceNode plays the engine's PCM;
 * everything else is production code on real Web Audio (node-web-audio-api): `ensureCommonMasterNodes`
 * and `applyMasterLevels`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { publishFxHost } from '../audio/fx/fxHost';
import { ensureCommonMasterNodes } from '../hooks/audioGraph/masterGraph';
import type { AudioGraphRefs } from '../hooks/audioGraph/types';
import { applyMasterLevels } from '../utils/audioMasterGraph';
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

/** A stand-in for the engine's PCM: stereo, deterministic, loud enough that 0.25× is still far above float noise. */
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
  } as unknown as AudioGraphRefs;
}

/**
 * The engine feeding the production master chain at slider position `volume`. `moveSliderTo` is
 * applied after the engine started, like dragging the volume slider during playback.
 */
async function renderThroughMasterChain(
  volume: number,
  moveSliderTo?: number,
): Promise<Float32Array<ArrayBuffer>[]> {
  const ctx = createOfflineContext({ length: LEN, sampleRate: SR });
  const audioCtx = ctx as unknown as AudioContext;
  const refs = graphRefs();
  ensureCommonMasterNodes(audioCtx, refs, volume, PAN);

  // The worklet node connects straight to masterInput; it has no volume of its own.
  const source = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, enginePcm()) });
  source.connect(refs.masterInputRef.current!);

  if (moveSliderTo !== undefined) {
    applyMasterLevels(
      { gainNodeRef: refs.gainNodeRef, stereoPannerRef: refs.stereoPannerRef },
      moveSliderTo,
      PAN,
    );
  }

  source.start(0);
  return channelsOf(await startRenderingWithTimeout(ctx));
}

function scaled(input: Float32Array<ArrayBuffer>[], gain: number): Float32Array<ArrayBuffer>[] {
  return input.map((channel) => Float32Array.from(channel, (x) => x * gain));
}

/** float32 gain math: a few ulps of the largest sample. */
const TOLERANCE = 1e-6;

describe('master volume is applied once (#489)', () => {
  afterEach(() => {
    publishFxHost(null);
  });

  it.each(VOLUMES)('plays at volume × engine PCM at slider %s', async (volume) => {
    const pcm = await renderThroughMasterChain(volume);
    expect(maxAbsDiff(pcm, scaled(enginePcm(), volume))).toBeLessThan(TOLERANCE);
  }, WEB_AUDIO_TIMEOUT_MS);

  it('moving the slider during playback rescales the output once', async () => {
    for (const [from, to] of [[1, 0.5], [0.25, 1]] as const) {
      const pcm = await renderThroughMasterChain(from, to);
      expect(maxAbsDiff(pcm, scaled(enginePcm(), to))).toBeLessThan(TOLERANCE);
    }
  }, WEB_AUDIO_TIMEOUT_MS);
});
