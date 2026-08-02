/**
 * Classic-script bootstrap for AudioWorkletGlobalScope.
 *
 * Loaded via audioWorklet.addModule() before openmpt-worklet.js so the
 * processor can reference shared message-type constants without duplicating
 * string literals. Values must match audio-worklet/workletProtocolConstants.ts
 * (enforced by tests/workletProtocol.test.ts).
 */
(function (g) {
  'use strict';

  var MAIN_TO_WORKLET = Object.freeze({
    initLib: 'initLib',
    load: 'load',
    play: 'play',
    pause: 'pause',
    seek: 'seek',
    getOscBuffer: 'getOscBuffer',
    setAudioLite: 'setAudioLite',
    setPcmEmit: 'setPcmEmit',
  });

  var WORKLET_TO_MAIN = Object.freeze({
    position: 'position',
    loaded: 'loaded',
    ended: 'ended',
    seekAck: 'seekAck',
    error: 'error',
    oscBuffer: 'oscBuffer',
    needData: 'needData',
    starvation: 'starvation',
    projectmPcm: 'projectm-pcm',
  });

  function isObject(v) {
    return v != null && typeof v === 'object';
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function isNonNegInt(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
  }

  function isModulePayload(v) {
    return v instanceof ArrayBuffer || v instanceof Uint8Array;
  }

  /** Lightweight main→worklet receive guard (mirrors audio-worklet/protocol.ts). */
  function parseMainToWorkletMessage(data) {
    if (!isObject(data)) {
      return { ok: false, error: 'message is not an object' };
    }

    var type = data.type;

    if (type === MAIN_TO_WORKLET.initLib) {
      if (typeof data.scriptText !== 'string' || data.scriptText.length === 0) {
        return { ok: false, error: 'initLib requires scriptText' };
      }
      if (data.wasmBytes != null && !(data.wasmBytes instanceof ArrayBuffer)) {
        return { ok: false, error: 'wasmBytes must be ArrayBuffer' };
      }
      return { ok: true, message: data };
    }

    if (type === MAIN_TO_WORKLET.load) {
      if (!isModulePayload(data.moduleData)) {
        return { ok: false, error: 'load requires moduleData' };
      }
      return { ok: true, message: data };
    }

    if (type === MAIN_TO_WORKLET.play || type === MAIN_TO_WORKLET.pause || type === MAIN_TO_WORKLET.getOscBuffer) {
      return { ok: true, message: data };
    }

    if (type === MAIN_TO_WORKLET.seek) {
      if (!isNonNegInt(data.order) || !isNonNegInt(data.row)) {
        return { ok: false, error: 'seek requires order/row' };
      }
      return { ok: true, message: data };
    }

    if (type === MAIN_TO_WORKLET.setAudioLite) {
      if (typeof data.lite !== 'boolean') {
        return { ok: false, error: 'setAudioLite requires lite boolean' };
      }
      return { ok: true, message: data };
    }

    if (type === MAIN_TO_WORKLET.setPcmEmit) {
      if (typeof data.enabled !== 'boolean') {
        return { ok: false, error: 'setPcmEmit requires enabled boolean' };
      }
      return { ok: true, message: data };
    }

    // Legacy no-type load shim
    if (type == null && isModulePayload(data.moduleData)) {
      return { ok: true, message: data };
    }

    return { ok: false, error: 'unknown main→worklet message type: ' + String(type) };
  }

  g.WorkletProtocolConstants = Object.freeze({
    MAIN_TO_WORKLET: MAIN_TO_WORKLET,
    WORKLET_TO_MAIN: WORKLET_TO_MAIN,
    parseMainToWorkletMessage: parseMainToWorkletMessage,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
