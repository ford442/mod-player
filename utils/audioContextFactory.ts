/**
 * Single construction site for the player's `AudioContext`.
 *
 * Why this exists (#411 follow-up): the graph used to be assembled by two
 * owners with two option bags — `hooks/useAudioGraph.ts` (`new AudioContext({
 * latencyHint: 'playback' })`, no `sampleRate`) and the C++ legacy path
 * (`emscripten_create_audio_context`). Two contexts means silent MediaRecorder
 * capture, clock-domain fights between `samplesWritten / sampleRate` and
 * `ctx.currentTime`, and the "UI playing / no audio" class of bug that #329 /
 * #330 already cost us.
 *
 * Rules enforced here:
 * 1. **One context per page session.** `useAudioGraph` and
 *    `OpenMPTWorkletEngine.attachAudioContext` both reuse it. Nothing else may
 *    call `new AudioContext` (and the native engine never calls
 *    `emscripten_create_audio_context`).
 * 2. **`sampleRate` is locked to 48000.** The `--grow` native heap build and
 *    the JS engine's libopenmpt worklet both render at this rate, and the JS worklet's
 *    interpolation / playhead math (`samplesWritten / sampleRate`) is only
 *    stable when the rate does not depend on whatever the OS defaulted to.
 *    If the constructor rejects the explicit rate (rare — some Firefox / older
 *    Safari builds), we fall back to the device default **on the same single
 *    context** and log once. We never create a second context to recover.
 * 3. **`latencyHint` is a create-time choice.** `playback` by default;
 *    `interactive` when stage mode is on or `?latency=interactive` is present.
 *    Toggling stage mode later does *not* recreate the context — that would
 *    glitch audio mid-song. Switching profiles live is out of scope.
 */

import { resolveStageModePreference } from './stageModeSelection';

export type AudioGraphProfile = 'playback' | 'interactive';

/** Locked render rate. Native (`--grow`) and the JS engine both render here. */
export const PLAYER_SAMPLE_RATE = 48000;

export type PlayerSampleRate = 44100 | 48000;

export interface CreatePlayerAudioContextOptions {
  /** `playback` (default) or `interactive` (stage mode / low latency). */
  profile?: AudioGraphProfile;
  /** Locked render rate. Default {@link PLAYER_SAMPLE_RATE}. */
  sampleRate?: PlayerSampleRate;
  /** Optional output device id; ignored when `setSinkId` is unsupported. */
  sinkId?: string;
}

/** `?latency=interactive|playback` — session-only, never persisted. */
export function parseLatencyQueryParam(
  search?: string | URLSearchParams | null,
): AudioGraphProfile | null {
  const raw = search ?? (typeof window !== 'undefined' ? window.location.search : null);
  if (raw == null) return null;
  const params = typeof raw === 'string'
    ? new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
    : raw;
  const v = params.get('latency')?.trim().toLowerCase();
  if (v === 'interactive') return 'interactive';
  if (v === 'playback') return 'playback';
  return null;
}

/**
 * Resolve the create-time profile: `?latency=` wins, then stage mode, else
 * `playback`. Read once, when the context is constructed.
 */
export function resolveAudioGraphProfile(
  search?: string | URLSearchParams | null,
): AudioGraphProfile {
  const fromUrl = parseLatencyQueryParam(search);
  if (fromUrl) return fromUrl;
  try {
    if (typeof window !== 'undefined' && resolveStageModePreference(search ?? null)) {
      return 'interactive';
    }
  } catch {
    // localStorage unavailable (private mode) — fall through to playback
  }
  return 'playback';
}

let sharedContext: AudioContext | null = null;
let loggedSampleRateFallback = false;

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof window !== 'undefined') {
    return window.AudioContext ?? window.webkitAudioContext ?? null;
  }
  return null;
}

function applySinkId(ctx: AudioContext, sinkId: string | undefined): void {
  if (!sinkId) return;
  // Chrome 110+ only; a plain no-op elsewhere.
  const setSinkId = (ctx as AudioContext & {
    setSinkId?: (id: string) => Promise<void>;
  }).setSinkId;
  if (typeof setSinkId !== 'function') return;
  void setSinkId.call(ctx, sinkId).catch((err: unknown) => {
    console.warn('[AudioEngine] setSinkId failed — using default output', err);
  });
}

/**
 * Create the one player `AudioContext`, or return the existing one.
 *
 * Subsequent calls ignore `opts` and hand back the live context: the profile
 * and sample rate are fixed for the page session by the first call.
 */
export function createPlayerAudioContext(
  opts: CreatePlayerAudioContextOptions = {},
): AudioContext {
  if (sharedContext && sharedContext.state !== 'closed') {
    return sharedContext;
  }

  const Ctor = resolveAudioContextCtor();
  if (!Ctor) {
    throw new Error('Web Audio API is not available in this environment');
  }

  const profile = opts.profile ?? resolveAudioGraphProfile();
  const sampleRate = opts.sampleRate ?? PLAYER_SAMPLE_RATE;
  const latencyHint: AudioContextLatencyCategory = profile === 'interactive'
    ? 'interactive'
    : 'playback';

  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint, sampleRate });
  } catch (err) {
    // Device cannot open at the requested rate. Take the device default rather
    // than leaving the player without a graph — and never open a second one.
    if (!loggedSampleRateFallback) {
      loggedSampleRateFallback = true;
      console.warn(
        `[AudioEngine] AudioContext rejected sampleRate=${sampleRate} — falling back to the device default`,
        err,
      );
    }
    ctx = new Ctor({ latencyHint });
  }

  applySinkId(ctx, opts.sinkId);

  console.log('[AudioEngine] AudioContext created', {
    profile,
    latencyHint,
    requestedSampleRate: sampleRate,
    state: ctx.state,
    sampleRate: ctx.sampleRate,
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency ?? 0,
    timestamp: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  sharedContext = ctx;
  return ctx;
}

/** The live player context, or null before the first `createPlayerAudioContext`. */
export function getSharedPlayerAudioContext(): AudioContext | null {
  if (sharedContext && sharedContext.state === 'closed') return null;
  return sharedContext;
}

/**
 * Close the player context and drop the singleton (unmount / teardown only).
 * The next `createPlayerAudioContext` builds a fresh one — this is the only
 * sanctioned way to end a page session's context.
 */
export function closeSharedPlayerAudioContext(): void {
  const ctx = sharedContext;
  sharedContext = null;
  if (!ctx || ctx.state === 'closed') return;
  void Promise.resolve(ctx.close()).catch((err: unknown) => {
    console.warn('[AudioEngine] AudioContext.close() failed', err);
  });
}

/** Test-only: drop the module-level singleton so each case starts clean. */
export function __resetSharedPlayerAudioContextForTests(): void {
  sharedContext = null;
  loggedSampleRateFallback = false;
}
