/**
 * Real Web Audio for vitest (#453), backed by node-web-audio-api (a Rust
 * implementation of the spec; Node ≥ 22).
 *
 * Use the named exports, never `node-web-audio-api/polyfill.js`: the polyfill
 * rewrites `globalThis.window`, which tests/vitest.setup.ts already stubs.
 * Production code that constructs nodes with `new AudioWorkletNode(...)` gets
 * the real class through `installWebAudioGlobals()` (a `vi.stubGlobal`, so it
 * is undone by `vi.unstubAllGlobals()`).
 *
 * Its DSP (compressor, convolver, resampling) is not Chrome's, so these tests
 * prove graph wiring, automation and parity logic; the Chromium harness
 * (scripts/fx-smoke.mjs) checks the same things on Chrome's implementation.
 * Its decoder has no Opus support — room tests synthesize their IRs.
 *
 * Don't use OfflineAudioContext.suspend() here: node-web-audio-api registers
 * suspends asynchronously, so a fast render can race past the point and reject
 * it. Schedule AudioParam automation / rack changes ahead of time instead.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import * as nwa from 'node-web-audio-api';

export { nwa };

/**
 * Per-test budget for suites that render on real Web Audio: worklet nodes run
 * on worker threads, and under a full parallel vitest run a few offline renders
 * can exceed vitest's 5 s default.
 */
export const WEB_AUDIO_TIMEOUT_MS = 30_000;

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Absolute path for `audioWorklet.addModule()` (node-web-audio-api resolves relative paths from cwd). */
export function repoPath(rel: string): string {
  return join(ROOT, rel);
}

/** Expose the node-web-audio-api constructors production code reaches for as globals. */
export function installWebAudioGlobals(): void {
  vi.stubGlobal('AudioWorkletNode', nwa.AudioWorkletNode);
  vi.stubGlobal('OfflineAudioContext', nwa.OfflineAudioContext);
  vi.stubGlobal('AudioBuffer', nwa.AudioBuffer);
}

export interface RenderOfflineOptions {
  length: number;
  sampleRate: number;
  channels?: number;
  /** A native hang should fail the test, not stall the whole vitest run. */
  timeoutMs?: number;
}

export function createOfflineContext(opts: RenderOfflineOptions): OfflineAudioContext {
  return new nwa.OfflineAudioContext({
    numberOfChannels: opts.channels ?? 2,
    length: opts.length,
    sampleRate: opts.sampleRate,
  });
}

/** Run `startRendering()` with a timeout. Build the graph (incl. worklet nodes) before calling. */
export async function startRenderingWithTimeout(
  ctx: OfflineAudioContext,
  timeoutMs = 20_000,
): Promise<AudioBuffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`offline render timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([ctx.startRendering(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Create a context, let `build` wire it, render it. */
export async function renderOffline(
  opts: RenderOfflineOptions,
  build: (ctx: OfflineAudioContext) => void | Promise<void>,
): Promise<AudioBuffer> {
  const ctx = createOfflineContext(opts);
  await build(ctx);
  return startRenderingWithTimeout(ctx, opts.timeoutMs);
}

/** Copy of each channel (AudioBuffer views can be detached by later renders). */
export function channelsOf(buffer: AudioBuffer): Float32Array<ArrayBuffer>[] {
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.push(Float32Array.from(buffer.getChannelData(c)));
  }
  return out;
}

/** Fill an AudioBuffer for `ctx` from per-channel generators. */
export function bufferFrom(
  ctx: BaseAudioContext,
  channels: readonly Float32Array<ArrayBuffer>[],
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buffer = ctx.createBuffer(channels.length, length, ctx.sampleRate);
  channels.forEach((data, c) => buffer.copyToChannel(data, c));
  return buffer;
}

/** Max |a − b| across channels over `[from, to)` frames (defaults: whole shortest buffer). */
export function maxAbsDiff(
  a: readonly Float32Array[],
  b: readonly Float32Array[],
  from = 0,
  to = Number.POSITIVE_INFINITY,
): number {
  let max = 0;
  const channels = Math.min(a.length, b.length);
  for (let c = 0; c < channels; c++) {
    const x = a[c]!;
    const y = b[c]!;
    const end = Math.min(x.length, y.length, to);
    for (let i = from; i < end; i++) {
      const d = Math.abs(x[i]! - y[i]!);
      if (d > max) max = d;
    }
  }
  return max;
}
