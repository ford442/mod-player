import { ensureMasterOutputChain } from '../../utils/audioMasterGraph';
import type { AudioGraphRefs } from './types';

function masterGraphRefs(refs: AudioGraphRefs) {
  return {
    analyserRef: refs.analyserRef,
    stereoPannerRef: refs.stereoPannerRef,
    gainNodeRef: refs.gainNodeRef,
  };
}

/** Re-assert analyser → panner → gain → destination and apply live levels. */
export function wireMasterOutput(
  ctx: AudioContext,
  refs: AudioGraphRefs,
  volume: number,
  pan: number,
): void {
  ensureMasterOutputChain(ctx, masterGraphRefs(refs));
  if (refs.stereoPannerRef.current) {
    refs.stereoPannerRef.current.pan.value = pan;
  }
  if (refs.gainNodeRef.current) {
    refs.gainNodeRef.current.gain.value = volume;
  }
}

/** Exact module bytes for worklet load — safe when Uint8Array is a subarray. */
export function moduleBytesFromFileData(fileData: Uint8Array | null): ArrayBuffer | null {
  if (!fileData || fileData.byteLength === 0) return null;
  const copy = new Uint8Array(fileData.byteLength);
  copy.set(fileData);
  return copy.buffer;
}

/** Create or refresh common master-graph nodes (panner, gain, analyser). */
export function ensureCommonMasterNodes(
  ctx: AudioContext,
  refs: AudioGraphRefs,
  volume: number,
  panValue: number,
): void {
  if (!refs.stereoPannerRef.current) {
    console.log('[PLAY] Creating StereoPanner node...');
    refs.stereoPannerRef.current = ctx.createStereoPanner();
  }
  refs.stereoPannerRef.current.pan.value = panValue;

  if (!refs.gainNodeRef.current) {
    console.log('[PLAY] Creating Gain node...');
    refs.gainNodeRef.current = ctx.createGain();
  }
  // Always re-apply volume — App slider can change while the GainNode lives on.
  refs.gainNodeRef.current.gain.value = volume;

  if (!refs.analyserRef.current) {
    console.log('[PLAY] Creating Analyser node...');
    refs.analyserRef.current = ctx.createAnalyser();
    refs.analyserRef.current.fftSize = 2048;
    refs.analyserRef.current.smoothingTimeConstant = 0.8;
  }
  wireMasterOutput(ctx, refs, volume, panValue);
}
