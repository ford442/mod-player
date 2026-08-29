/** Preferred rate for the shared main AudioContext (matches libopenmpt / export). */
export const PREFERRED_AUDIO_SAMPLE_RATE = 44100;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

/**
 * Create the single shared AudioContext used by both JS and native engines.
 * Requests {@link PREFERRED_AUDIO_SAMPLE_RATE}; if the browser refuses, falls
 * back to the default constructor and callers must use `ctx.sampleRate`.
 */
export function createSharedAudioContext(): AudioContext {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) {
    throw new Error('AudioContext is not supported in this browser');
  }
  try {
    return new Ctor({
      latencyHint: 'playback',
      sampleRate: PREFERRED_AUDIO_SAMPLE_RATE,
    });
  } catch {
    return new Ctor({ latencyHint: 'playback' });
  }
}
