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
 * 1. **One context per page session.** `useAudioGraph` reuses it. Nothing
 *    else may call `new AudioContext`.
 * 2. **`sampleRate` is locked to 48000.** The JS engine's libopenmpt worklet
 *    renders at this rate, and the JS worklet's
 *    interpolation / playhead math (`samplesWritten / sampleRate`) is only
 *    stable when the rate does not depend on whatever the OS defaulted to.
 *    If the constructor rejects the explicit rate (rare — some Firefox / older
 *    Safari builds), we fall back to the device default **on the same single
 *    context** and log once. We never create a second context to recover.
 * 3. **`latencyHint` is a create-time choice.** `playback` by default;
 *    `interactive` when stage mode is on or `?latency=interactive` is present.
 *    Toggling stage mode later does *not* recreate the context — that would
 *    glitch audio mid-song. Switching profiles live is out of scope.
 * 4. **The output device moves under the live context** (#492):
 *    `switchPlayerAudioSink` → `AudioContext.setSinkId()` on the same context —
 *    never suspend / close / recreate to change device. The context is always
 *    constructed on the default output, not with the constructor's `sinkId`
 *    option: Chromium accepts a stale id there without complaint and opens
 *    nothing audible. The PlayerEngine switches it before any engine is
 *    connected (audio/engine/outputDevice.ts).
 */

import { resolveStageModePreference } from './stageModeSelection';
import { setAudioSuspended } from './audioSuspendState';
import { PLAYER_SAMPLE_RATE, type PlayerSampleRate } from './sampleRates';
import { createLogger } from './log';

const log = createLogger('AudioEngine');

export type AudioGraphProfile = 'playback' | 'interactive';

export { PLAYER_SAMPLE_RATE, type PlayerSampleRate } from './sampleRates';

export interface CreatePlayerAudioContextOptions {
  /** `playback` (default) or `interactive` (stage mode / low latency). */
  profile?: AudioGraphProfile;
  /** Locked render rate. Default {@link PLAYER_SAMPLE_RATE}. */
  sampleRate?: PlayerSampleRate;
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
/** Contexts constructed since load (or the last test reset): 1 per page session, +1 per teardown/remount. */
let constructionCount = 0;

/**
 * Whether playback is currently expected (i.e. the UI thinks it's playing).
 * Registered by the audio-graph layer (which owns `isPlayingRef`) so this
 * framework-free module can tell a *user-initiated* pause (context correctly
 * idle) from an *unexpected* one (context left `running` mid-playback).
 */
let playbackActiveQuery: (() => boolean) | null = null;

/** Called once by the audio-graph layer to answer "should audio be playing right now?". */
export function setPlaybackActiveQuery(query: (() => boolean) | null): void {
  playbackActiveQuery = query;
}

/**
 * Notice `ctx` leaving/rejoining `running` (iOS/Safari `interrupted`, OS
 * suspends, a background tab reclaiming audio) instead of only ever checking
 * `ctx.state` inside `play()`. Reported through utils/audioSuspendState.ts —
 * see that module for why the UI-facing recovery lives elsewhere.
 */
function wireStateChangeReporting(ctx: AudioContext): void {
  // A property assignment (not addEventListener) — this factory is the only
  // owner of `ctx`, so there is no other `onstatechange` listener to preserve,
  // and it keeps this testable against minimal AudioContext mocks.
  ctx.onstatechange = () => {
    const expectedPlaying = playbackActiveQuery ? playbackActiveQuery() : false;
    if (ctx.state !== 'running') {
      if (expectedPlaying) {
        console.warn(`[AudioEngine] AudioContext unexpectedly left 'running' (now '${ctx.state}') while playing`);
        setAudioSuspended(true, ctx.state);
      }
    } else {
      setAudioSuspended(false);
    }
  };
}

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof window !== 'undefined') {
    return window.AudioContext ?? window.webkitAudioContext ?? null;
  }
  return null;
}

/** `AudioContext.prototype.setSinkId` exists (Chromium 110+; not Firefox or Safari as of 2026). */
export function isAudioSinkSelectionSupported(): boolean {
  const Ctor = resolveAudioContextCtor();
  return Ctor != null && typeof (Ctor.prototype as { setSinkId?: unknown }).setSinkId === 'function';
}

/** What `readAudioSinkId` reports for an `AudioSinkInfo { type: 'none' }` sink (we never set one). */
export const SILENT_SINK_ID = 'none';

/** The output device `ctx` renders to: `''` is the system default (the spec's empty string). */
export function readAudioSinkId(ctx: AudioContext): string {
  const sink = (ctx as AudioContext & { sinkId?: string | { type?: string } }).sinkId;
  if (typeof sink === 'string') return sink;
  if (sink && typeof sink === 'object') return SILENT_SINK_ID;
  return '';
}

/**
 * Route `ctx` to another output device: `AudioContext.setSinkId()` on the SAME context, the one call
 * site in the app. Never suspends, closes or recreates the context (rules 1 and 4) — the render clock,
 * the worklet's module and cursor and every connection survive; the browser moves the output stream.
 *
 * Resolves with the sink in use afterwards. Rejects with the browser's error — `NotFoundError` for an
 * unknown or unplugged id, `NotAllowedError` when permission policy forbids it, `InvalidStateError` on
 * a closed context — and the previous sink stays; `NotSupportedError` where setSinkId is missing.
 */
export async function switchPlayerAudioSink(ctx: AudioContext, sinkId: string): Promise<string> {
  const setSinkId = (ctx as AudioContext & {
    setSinkId?: (id: string) => Promise<void>;
  }).setSinkId;
  if (typeof setSinkId !== 'function') {
    throw new DOMException('AudioContext.setSinkId() is not supported', 'NotSupportedError');
  }
  await setSinkId.call(ctx, sinkId);
  const actual = readAudioSinkId(ctx);
  log.log('output device switched', {
    requested: sinkId,
    sinkId: actual,
    state: ctx.state,
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency ?? 0,
  });
  return actual;
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

  constructionCount += 1;
  wireStateChangeReporting(ctx);

  log.log('AudioContext created', {
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

/**
 * Player contexts this module has constructed. Rule 1: one per page session (another only after
 * `closeSharedPlayerAudioContext`, i.e. unmount). Tests and the output-device smoke assert it stays
 * at 1 across device switches.
 */
export function getPlayerAudioContextConstructionCount(): number {
  return constructionCount;
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
  // Detach before closing: a closing/closed context can still fire
  // `statechange`, and wireStateChangeReporting has no way to tell "this is
  // the context I was wired for" from "a new one replaced it" on its own.
  ctx.onstatechange = null;
  void Promise.resolve(ctx.close()).catch((err: unknown) => {
    console.warn('[AudioEngine] AudioContext.close() failed', err);
  });
}

/** Test-only: drop the module-level singleton so each case starts clean. */
export function __resetSharedPlayerAudioContextForTests(): void {
  sharedContext = null;
  loggedSampleRateFallback = false;
  playbackActiveQuery = null;
  constructionCount = 0;
}
