/**
 * Canonical message-type strings for the JS AudioWorklet postMessage boundary.
 *
 * Imported by audio-worklet/protocol.ts (worklet→main zod schemas),
 * audio-worklet/mainToWorkletMessages.ts (main→worklet guard + send helpers),
 * and — via scripts/build-worklet-js.mjs — compiled straight into
 * public/worklets/openmpt-worklet.js. There is no classic-script mirror to keep
 * in sync; tests/workletProtocol.test.ts checks the generated bundle instead.
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
