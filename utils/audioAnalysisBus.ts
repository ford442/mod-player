/**
 * The single audio-analysis snapshot bus.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Before this module every visual surface grew its own AnalyserNode RAF walk:
 * the pattern render loop pulled `getByteFrequencyData`, the channel scope
 * pulled `getByteTimeDomainData`, and the Project-M bridge pulled
 * `getFloatTimeDomainData` — three taps computing overlapping things off the
 * same graph, at three different cadences, none of them aware that the WebGPU
 * compute pass (src/renderers/webgpu/computeAnalysis.ts) had already done the
 * FFT on the GPU that frame.
 *
 * Every consumer now reads one `AnalysisSnapshot` from here instead.
 *
 * ── Layering (there are deliberately only two modules) ────────────────────────
 *   utils/pcmBus.ts        raw PCM transport. Opt-in: the worklet only
 *                          interleaves and posts blocks while something is
 *                          subscribed. The GPU compute pass is its consumer.
 *   utils/audioAnalysisBus  (this file) derived analysis distribution. Producers
 *                          publish a finished snapshot; visual surfaces read it.
 *
 * This module deliberately does NOT subscribe to pcmBus. Doing so would turn
 * the worklet's PCM emission on merely because something imported this file,
 * which is exactly the opt-in demand contract pcmBus exists to protect. PCM
 * reaches a snapshot because the producer that already holds it puts it there.
 *
 * ── Producer arbitration ─────────────────────────────────────────────────────
 * `gpu-compute` wins. While it has published inside GPU_ACTIVE_WINDOW_MS the
 * `analyser-fallback` producer's publishes are dropped, so a snapshot never
 * alternates between two sources mid-stream. If the GPU path goes quiet (lite
 * mode, no WebGPU, a shader that never opted into GPU spectrum) the fallback
 * resumes within that window. Same shape as the worklet/RAF yield in
 * utils/projectMBridge.ts.
 *
 * Playhead and tracker row state must never travel on this bus — see
 * docs/WORKLET_AUDIO_BUG.md.
 */

/** Which producer built a snapshot. */
export type AnalysisSource = 'gpu-compute' | 'analyser-fallback';

/** Four-band energy split. Matches the GPU compute pass's band layout. */
export interface AnalysisBands {
  bass: number;
  lowMid: number;
  highMid: number;
  treble: number;
}

export interface AnalysisSnapshot {
  /** AudioContext.currentTime when the producer built this, seconds. */
  readonly audioTime: number;
  readonly sampleRate: number;
  /** Interleaved when `channels === 2` (L0,R0,L1,R1,…), planar mono otherwise. */
  readonly pcm: Float32Array;
  readonly channels: 1 | 2;
  readonly bands: AnalysisBands;
  readonly rms: number;
  readonly peak: number;
  /** Log-spaced magnitudes. Only the GPU producer fills this. */
  readonly bins32?: Float32Array;
  readonly source: AnalysisSource;
}

export type AnalysisSubscriber = (snapshot: AnalysisSnapshot) => void;

/**
 * Subscriber notification cadence ceiling. The worklet emits PCM at ~86 Hz
 * (512 frames at 44.1 kHz) but every consumer of this bus paints to a canvas,
 * so anything above display rate is work thrown away.
 */
const MIN_NOTIFY_INTERVAL_MS = 1000 / 60 - 1;

/** A `gpu-compute` publish suppresses the fallback producer for this long. */
const GPU_ACTIVE_WINDOW_MS = 250;

const subscribers = new Set<AnalysisSubscriber>();
let latest: AnalysisSnapshot | null = null;
let lastNotifyAt = 0;
let lastGpuPublishAt = 0;

/** performance.now() where available; Date.now() in a worker/test context. */
const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** True while at least one visual surface is reading snapshots. */
export function analysisBusHasSubscribers(): boolean {
  return subscribers.size > 0;
}

/**
 * The producer that last published, or null when nothing has. Consumers use
 * this to skip work the winning producer has already done — the pattern render
 * loop stops pulling its own FFT once this reads `gpu-compute`.
 */
export function activeAnalysisSource(): AnalysisSource | null {
  return latest?.source ?? null;
}

/** True while the GPU compute pass is publishing; the fallback stays silent. */
export function gpuAnalysisIsLive(): boolean {
  return now() - lastGpuPublishAt < GPU_ACTIVE_WINDOW_MS;
}

/**
 * Latest snapshot, or null before the first publish. For RAF-driven canvas
 * consumers that want the freshest value at paint time rather than a callback.
 * Subscribing is still what accounts for demand.
 */
export function readAnalysis(): AnalysisSnapshot | null {
  return latest;
}

/** Subscribe to analysis snapshots. Returns an unsubscribe function. */
export function subscribeAnalysis(subscriber: AnalysisSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/**
 * Publish one snapshot.
 *
 * `latest` always advances so a polling consumer never reads a stale frame;
 * only the subscriber fan-out is coalesced to MIN_NOTIFY_INTERVAL_MS.
 *
 * Returns false when the snapshot was rejected because a higher-priority
 * producer owns the bus — the fallback producer uses this to stop its loop.
 */
export function publishAnalysis(snapshot: AnalysisSnapshot): boolean {
  const at = now();

  if (snapshot.source === 'gpu-compute') {
    lastGpuPublishAt = at;
  } else if (at - lastGpuPublishAt < GPU_ACTIVE_WINDOW_MS) {
    return false;
  }

  latest = snapshot;

  if (subscribers.size === 0) return true;
  if (at - lastNotifyAt < MIN_NOTIFY_INTERVAL_MS) return true;
  lastNotifyAt = at;

  for (const subscriber of subscribers) {
    try {
      subscriber(snapshot);
    } catch (err) {
      console.warn('[audioAnalysisBus] subscriber threw; continuing:', err);
    }
  }
  return true;
}

// ── Fallback producer ────────────────────────────────────────────────────────
// Lite mode and any browser without the WebGPU compute path still need bands.
// This is the *only* remaining AnalyserNode walk in the app, it runs at most
// once regardless of how many surfaces are listening, and it parks itself
// whenever nobody is subscribed or the GPU producer is live.

/** Band edges in Hz, matching the GPU compute pass's four-band split. */
const BAND_EDGES_HZ: ReadonlyArray<readonly [keyof AnalysisBands, number, number]> = [
  ['bass', 20, 250],
  ['lowMid', 250, 1000],
  ['highMid', 1000, 4000],
  ['treble', 4000, 16000],
];

/**
 * Mean magnitude across a frequency span of a `getByteFrequencyData` result,
 * normalised to 0..1. Byte frequency data is already log-ish (dB mapped into
 * 0..255), so a linear mean over the span is the right summary.
 */
function meanBandEnergy(
  freq: Uint8Array,
  binHz: number,
  lowHz: number,
  highHz: number,
): number {
  const first = Math.max(0, Math.floor(lowHz / binHz));
  const last = Math.min(freq.length - 1, Math.ceil(highHz / binHz));
  if (last < first) return 0;
  let sum = 0;
  for (let i = first; i <= last; i++) sum += freq[i] ?? 0;
  return sum / (last - first + 1) / 255;
}

/**
 * Drive the bus from an AnalyserNode.
 *
 * Safe to start unconditionally: it costs one idle RAF tick while nothing is
 * subscribed or while the GPU producer owns the bus, and pulls no analyser data
 * in either case. Returns a cleanup function.
 */
export function startAnalyserAnalysis(analyser: AnalyserNode | null): () => void {
  if (!analyser || typeof requestAnimationFrame !== 'function') return () => {};

  let rafId = 0;
  let active = true;
  let freq = new Uint8Array(analyser.frequencyBinCount);
  let time = new Float32Array(analyser.fftSize);

  const tick = () => {
    if (!active) return;
    rafId = requestAnimationFrame(tick);

    // Nothing is listening, or the GPU already published this frame's bands.
    if (subscribers.size === 0 || gpuAnalysisIsLive()) return;

    if (freq.length !== analyser.frequencyBinCount) {
      freq = new Uint8Array(analyser.frequencyBinCount);
    }
    if (time.length !== analyser.fftSize) {
      time = new Float32Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(freq);
    analyser.getFloatTimeDomainData(time);

    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const bands = { bass: 0, lowMid: 0, highMid: 0, treble: 0 };
    for (const [name, lowHz, highHz] of BAND_EDGES_HZ) {
      bands[name] = meanBandEnergy(freq, binHz, lowHz, highHz);
    }

    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < time.length; i++) {
      const sample = time[i] ?? 0;
      sumSquares += sample * sample;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }

    publishAnalysis({
      audioTime: analyser.context.currentTime,
      sampleRate: analyser.context.sampleRate,
      // slice() so a consumer holding the snapshot can't see it mutate.
      pcm: time.slice(),
      channels: 1,
      bands,
      rms: time.length > 0 ? Math.sqrt(sumSquares / time.length) : 0,
      peak,
      source: 'analyser-fallback',
    });
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    active = false;
    cancelAnimationFrame(rafId);
  };
}

/** Test helper — drop every subscriber and all producer state. */
export function resetAnalysisBus(): void {
  subscribers.clear();
  latest = null;
  lastNotifyAt = 0;
  lastGpuPublishAt = 0;
}
