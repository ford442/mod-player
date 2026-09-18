/**
 * Canonical message-type strings for the JS AudioWorklet postMessage boundary.
 *
 * Single source of truth — imported by audio-worklet/protocol.ts (types + zod,
 * main thread) and by audio-worklet/js/openmpt-processor.ts, which esbuild
 * bundles directly into public/worklets/openmpt-worklet.js
 * (scripts/build-js-worklet.mjs). There is no longer a separate classic-script
 * mirror to keep in sync.
 */

/** Main thread → AudioWorklet processor */
export const MAIN_TO_WORKLET = {
  initLib: 'initLib',
  load: 'load',
  play: 'play',
  pause: 'pause',
  seek: 'seek',
  getOscBuffer: 'getOscBuffer',
  setAudioLite: 'setAudioLite',
  setProjectmPcm: 'setProjectmPcm',
  setAudioDiag: 'setAudioDiag',
  setChannelMute: 'setChannelMute',
  setRenderParam: 'setRenderParam',
  ctlSetText: 'ctlSetText',
} as const;

/** AudioWorklet processor → main thread */
export const WORKLET_TO_MAIN = {
  position: 'position',
  loaded: 'loaded',
  ended: 'ended',
  seekAck: 'seekAck',
  error: 'error',
  oscBuffer: 'oscBuffer',
  needData: 'needData',
  starvation: 'starvation',
  projectmPcm: 'projectm-pcm',
  audioDiag: 'audioDiag',
} as const;

export type MainToWorkletType = (typeof MAIN_TO_WORKLET)[keyof typeof MAIN_TO_WORKLET];
export type WorkletToMainType = (typeof WORKLET_TO_MAIN)[keyof typeof WORKLET_TO_MAIN];

export const ALL_MAIN_TO_WORKLET_TYPES = Object.values(MAIN_TO_WORKLET);
export const ALL_WORKLET_TO_MAIN_TYPES = Object.values(WORKLET_TO_MAIN);
