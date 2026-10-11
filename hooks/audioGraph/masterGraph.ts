import { publishFxHost } from '../../audio/fx/fxHost';
import {
  ensureMasterOutputChain,
  releaseMasterNodes,
  type MasterGraphRefs,
} from '../../utils/audioMasterGraph';
import type { AudioGraphRefs } from './types';

function masterGraphRefs(refs: AudioGraphRefs): MasterGraphRefs {
  return {
    masterInputRef: refs.masterInputRef,
    masterDirectRef: refs.masterDirectRef,
    analyserRef: refs.analyserRef,
    stereoPannerRef: refs.stereoPannerRef,
    gainNodeRef: refs.gainNodeRef,
  };
}

/**
 * Re-assert masterInput → masterDirect → analyser → panner → gain → destination
 * (connect-only, so taps and FX-rack edges survive) and apply live levels.
 */
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

/** Create or refresh the master-graph nodes (input, direct, analyser, panner, gain). */
export function ensureCommonMasterNodes(
  ctx: AudioContext,
  refs: AudioGraphRefs,
  volume: number,
  panValue: number,
): void {
  // Nodes belong to one context, and connecting across contexts throws. If the
  // shared context was closed and recreated (unmount/remount, HMR), start over.
  const existing = refs.masterInputRef.current ?? refs.analyserRef.current;
  if (existing && existing.context !== ctx) {
    console.log('[PLAY] AudioContext changed — recreating master nodes');
    publishFxHost(null);
    releaseMasterNodes(masterGraphRefs(refs));
  }

  if (!refs.masterInputRef.current) {
    // Unity gain, never automated: the one input every engine connects to.
    refs.masterInputRef.current = ctx.createGain();
  }
  if (!refs.masterDirectRef.current) {
    // Dry path around the FX rack; the rack controller owns its gain (#453).
    refs.masterDirectRef.current = ctx.createGain();
  }

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

  publishFxHost({
    ctx,
    masterInput: refs.masterInputRef.current,
    masterDirect: refs.masterDirectRef.current,
    analyser: refs.analyserRef.current,
  });
}
