/**
 * Process-wide PCM tap for GPU audio analysis.
 *
 * The AudioWorklet already renders fixed-size interleaved stereo blocks for
 * Project-M (`projectm-pcm`, see public/worklets/openmpt-worklet.js). That
 * stream is *opt-in* — interleaving and posting competed with the render loop
 * at XM pattern starts, so it stays off unless something is listening.
 *
 * This module is that "something else": the WebGPU compute analysis pass
 * (src/renderers/webgpu/computeAnalysis.ts) subscribes here, and the audio
 * graph asks the worklet to start emitting as soon as the first subscriber
 * arrives — and to stop again when the last one leaves.
 *
 * Deliberately framework-free (no React, no worklet imports) so both the audio
 * graph and the renderer can depend on it without a cycle. A native PCM ring
 * can publish through the same entry point later without touching consumers.
 */

export interface PcmBlock {
  /** Interleaved when `channels === 2` (L0,R0,L1,R1,…), planar mono otherwise. */
  readonly samples: Float32Array;
  readonly channels: 1 | 2;
  readonly sampleRate: number;
  /** Frames per channel — `samples.length / channels`. */
  readonly frameCount: number;
}

export type PcmSubscriber = (block: PcmBlock) => void;

const subscribers = new Set<PcmSubscriber>();

/** Notified when the subscriber count crosses 0 ↔ 1. */
type DemandListener = (wanted: boolean) => void;
let demandListener: DemandListener | null = null;

/**
 * Register the callback that turns the worklet's PCM stream on and off.
 * The audio graph installs this when a worklet node is created and clears it on
 * teardown. Called immediately with the current demand so a node created while
 * a subscriber is already attached starts emitting.
 */
export function setPcmDemandListener(listener: DemandListener | null): void {
  demandListener = listener;
  listener?.(subscribers.size > 0);
}

/** True when at least one consumer wants PCM blocks. */
export function pcmBusHasSubscribers(): boolean {
  return subscribers.size > 0;
}

/** Subscribe to PCM blocks. Returns an unsubscribe function. */
export function subscribePcm(subscriber: PcmSubscriber): () => void {
  const wasIdle = subscribers.size === 0;
  subscribers.add(subscriber);
  if (wasIdle) demandListener?.(true);

  return () => {
    if (!subscribers.delete(subscriber)) return;
    if (subscribers.size === 0) demandListener?.(false);
  };
}

/**
 * Publish one rendered PCM block. Safe to call with no subscribers (no-op).
 * A throwing subscriber is isolated so it cannot break the audio message loop.
 */
export function publishPcmBlock(
  samples: Float32Array,
  channels: 1 | 2,
  sampleRate: number,
): void {
  if (subscribers.size === 0) return;
  const block: PcmBlock = {
    samples,
    channels,
    sampleRate,
    frameCount: Math.floor(samples.length / channels),
  };
  for (const subscriber of subscribers) {
    try {
      subscriber(block);
    } catch (err) {
      console.warn('[pcmBus] subscriber threw; continuing:', err);
    }
  }
}

/** Test helper — drop every subscriber and the demand listener. */
export function resetPcmBus(): void {
  subscribers.clear();
  demandListener = null;
}
