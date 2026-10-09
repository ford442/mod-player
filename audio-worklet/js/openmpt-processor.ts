// Polyfill global crypto for AudioWorklet Global Scope if missing
// This MUST be set on globalThis before libopenmpt-worklet.js is evaluated
// so that Emscripten's randomFill can find it.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues: function (array) {
      for (let i = 0; i < array.length; i++) {
        // Fallback to pseudo-random numbers if true crypto is restricted
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  };
}
// Also set on self for backwards compatibility
const sharedCrypto = globalThis.crypto;
if (typeof self !== 'undefined' && (!self.crypto || !self.crypto.getRandomValues) && sharedCrypto) {
  self.crypto = sharedCrypto;
}

/**
 * OpenMPT AudioWorklet Processor
 * Renders libopenmpt audio directly inside the AudioWorklet process() callback.
 *
 * ⚠️  WARNING: This file MUST call _openmpt_module_read_float_stereo() in process().
 *     Do NOT replace this with a stub/test tone. A previous stub (commit 499a862)
 *     broke all MOD playback by generating a 440Hz sine wave instead of rendering
 *     the loaded module. See docs/WORKLET_AUDIO_BUG.md for the full post-mortem.
 *
 * WASM loading strategy: AudioWorklet classic scripts cannot use import() or
 * importScripts(), and the worklet scope has no fetch(). The main thread fetches
 * libopenmpt-worklet.js (Emscripten glue, ~100 KB) and libopenmpt-worklet.wasm
 * (real WebAssembly, \0asm magic-checked before transfer) and sends both via
 * postMessage({ type:'initLib', scriptText, wasmBytes }). The glue is evaluated
 * with `new Function` and seeded with Module.wasmBinary, so it instantiates the
 * bytes directly. There is no wasm2js path: wasmBytes is required.
 *
 * NOTE: Chrome 116+ provides setTimeout in AudioWorkletGlobalScope. Older
 * browsers don't, so we polyfill it below using process()-driven ticks.
 *
 * Source of truth: this file compiles (scripts/build-js-worklet.mjs, esbuild)
 * to public/worklets/openmpt-worklet.js. Do not hand-edit the generated file.
 */

import { MAIN_TO_WORKLET, WORKLET_TO_MAIN } from '../workletProtocolConstants';
import { ensureSharedLib } from '../libSingleton';
import { waitForRuntimeInitialized } from '../libRuntimeReady';

const MT = MAIN_TO_WORKLET;
const WT = WORKLET_TO_MAIN;

// Older Chrome/Edge/Firefox don't expose timers in the worklet scope.
// Schedule callbacks via currentTime checks driven by process().
if (typeof globalThis.setTimeout !== 'function') {
  const _timers = new Map<number, WorkletTimerEntry>();
  let _nextTimerId = 1;
  globalThis.__workletTimers = _timers;
  globalThis.setTimeout = function (fn: () => void, delayMs?: number): number {
    const id = _nextTimerId++;
    const deadline = (typeof currentTime === 'number' ? currentTime : 0) + (delayMs || 0) / 1000;
    _timers.set(id, { fn, deadline });
    return id;
  };
  globalThis.clearTimeout = function (id: number | undefined | null): void {
    if (id != null) _timers.delete(id);
  };
}

// Keep false in production: console I/O on the audio thread can cost real-time
// budget at pattern boundaries (many voices + log spam → underruns/crackle).
const DEBUG = false;

// Flip to true only when testing #416 locally — throws instead of silently
// no-op'ing setChannelMute so the gap is loud, not silent, during development.
const WORKLET_DEV = false;

// OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH is render param 3 (param 2 is
// STEREOSEPARATION_PERCENT — do not confuse). 0 / >=8 = Sinc+LP; 1 = nearest; 2 = linear;
// 3-7 = cubic. Values must match utils/openmptRenderParams.ts.
const OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3;
// Real wasm (not wasm2js) makes the high-quality filter affordable: sinc-8 measured at ~4% of the
// 128-frame quantum budget on a 64-channel stress module (mean; p99 ~11%), vs 37% for the old
// wasm2js glue at *cubic* — see docs/planning/native-engine-bench-notes.md. The main thread can
// still ask for 4 (cubic) via setRenderParam / `?interp=4` on weak devices.
const DEFAULT_INTERPOLATION_LENGTH = 8;

// Cap on how many returned projectm-pcm buffers we keep around — bounds worst
// case memory if the main thread ever returns more than we hand out.
const PCM_BUFFER_POOL_MAX = 4;

// Output fade duration around a module load's synchronous destroy+create swap
// (see loadModule()) — turns a slow parse's stall into hush, not a click.
const LOAD_FADE_MS = 10;

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[Worklet]', ...args);
}
function error(...args: unknown[]): void {
  console.error('[Worklet]', ...args);
}

// ── Lightweight main→worklet message validation ─────────────────────────
// Deliberately hand-rolled (not the zod schema in audio-worklet/protocol.ts)
// — zod's parse cost and bundle weight don't belong on the audio thread.

interface InitLibMsg {
  type: typeof MAIN_TO_WORKLET.initLib;
  scriptText: string;
  wasmBytes?: ArrayBuffer;
}
interface LoadMsg {
  type: typeof MAIN_TO_WORKLET.load;
  moduleData: ArrayBuffer | Uint8Array;
}
interface PlayMsg { type: typeof MAIN_TO_WORKLET.play }
interface PauseMsg { type: typeof MAIN_TO_WORKLET.pause }
interface SeekMsg {
  type: typeof MAIN_TO_WORKLET.seek;
  order: number;
  row: number;
}
interface GetOscBufferMsg { type: typeof MAIN_TO_WORKLET.getOscBuffer }
interface SetAudioLiteMsg {
  type: typeof MAIN_TO_WORKLET.setAudioLite;
  lite: boolean;
}
interface SetProjectmPcmMsg {
  type: typeof MAIN_TO_WORKLET.setProjectmPcm;
  enabled: boolean;
}
interface SetAudioDiagMsg {
  type: typeof MAIN_TO_WORKLET.setAudioDiag;
  enabled: boolean;
}
interface SetChannelMuteMsg {
  type: typeof MAIN_TO_WORKLET.setChannelMute;
  channel: number;
  muted: boolean;
}
interface SetRenderParamMsg {
  type: typeof MAIN_TO_WORKLET.setRenderParam;
  param: number;
  value: number;
}
interface CtlSetTextMsg {
  type: typeof MAIN_TO_WORKLET.ctlSetText;
  key: string;
  value: string;
}
interface ReturnPcmBufferMsg {
  type: typeof MAIN_TO_WORKLET.returnPcmBuffer;
  buffer: Float32Array<ArrayBuffer>;
}
/** Legacy no-type load shim used by some callers. */
interface LegacyLoadMsg {
  type?: undefined;
  moduleData: ArrayBuffer | Uint8Array;
}

type MainToWorkletMsg =
  | InitLibMsg
  | LoadMsg
  | PlayMsg
  | PauseMsg
  | SeekMsg
  | GetOscBufferMsg
  | SetAudioLiteMsg
  | SetProjectmPcmMsg
  | SetAudioDiagMsg
  | SetChannelMuteMsg
  | SetRenderParamMsg
  | CtlSetTextMsg
  | ReturnPcmBufferMsg
  | LegacyLoadMsg;

type ParseMainToWorkletResult =
  | { ok: true; message: MainToWorkletMsg }
  | { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object';
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
function isModulePayload(v: unknown): v is ArrayBuffer | Uint8Array {
  return v instanceof ArrayBuffer || v instanceof Uint8Array;
}

/** Lightweight main→worklet receive guard (mirrors audio-worklet/protocol.ts). */
function parseMainToWorkletMessage(data: unknown): ParseMainToWorkletResult {
  if (!isObject(data)) {
    return { ok: false, error: 'message is not an object' };
  }

  const type = data.type;

  if (type === MAIN_TO_WORKLET.initLib) {
    if (typeof data.scriptText !== 'string' || data.scriptText.length === 0) {
      return { ok: false, error: 'initLib requires scriptText' };
    }
    if (data.wasmBytes != null && !(data.wasmBytes instanceof ArrayBuffer)) {
      return { ok: false, error: 'wasmBytes must be ArrayBuffer' };
    }
    return { ok: true, message: data as unknown as InitLibMsg };
  }

  if (type === MAIN_TO_WORKLET.load) {
    if (!isModulePayload(data.moduleData)) {
      return { ok: false, error: 'load requires moduleData' };
    }
    return { ok: true, message: data as unknown as LoadMsg };
  }

  if (type === MAIN_TO_WORKLET.play || type === MAIN_TO_WORKLET.pause || type === MAIN_TO_WORKLET.getOscBuffer) {
    return { ok: true, message: data as unknown as PlayMsg | PauseMsg | GetOscBufferMsg };
  }

  if (type === MAIN_TO_WORKLET.seek) {
    if (!isNonNegInt(data.order) || !isNonNegInt(data.row)) {
      return { ok: false, error: 'seek requires order/row' };
    }
    return { ok: true, message: data as unknown as SeekMsg };
  }

  if (type === MAIN_TO_WORKLET.setAudioLite) {
    if (typeof data.lite !== 'boolean') {
      return { ok: false, error: 'setAudioLite requires lite boolean' };
    }
    return { ok: true, message: data as unknown as SetAudioLiteMsg };
  }

  if (type === MAIN_TO_WORKLET.setProjectmPcm || type === MAIN_TO_WORKLET.setAudioDiag) {
    if (typeof data.enabled !== 'boolean') {
      return { ok: false, error: String(type) + ' requires enabled boolean' };
    }
    return { ok: true, message: data as unknown as SetProjectmPcmMsg | SetAudioDiagMsg };
  }

  if (type === MAIN_TO_WORKLET.setChannelMute) {
    if (!isNonNegInt(data.channel) || typeof data.muted !== 'boolean') {
      return { ok: false, error: 'setChannelMute requires channel/muted' };
    }
    return { ok: true, message: data as unknown as SetChannelMuteMsg };
  }

  if (type === MAIN_TO_WORKLET.setRenderParam) {
    if (!isFiniteNumber(data.param) || !isFiniteNumber(data.value)) {
      return { ok: false, error: 'setRenderParam requires param/value' };
    }
    return { ok: true, message: data as unknown as SetRenderParamMsg };
  }

  if (type === MAIN_TO_WORKLET.ctlSetText) {
    if (typeof data.key !== 'string' || typeof data.value !== 'string') {
      return { ok: false, error: 'ctlSetText requires key/value strings' };
    }
    return { ok: true, message: data as unknown as CtlSetTextMsg };
  }

  if (type === MAIN_TO_WORKLET.returnPcmBuffer) {
    if (!(data.buffer instanceof Float32Array)) {
      return { ok: false, error: 'returnPcmBuffer requires a Float32Array buffer' };
    }
    return { ok: true, message: data as unknown as ReturnPcmBufferMsg };
  }

  // Legacy no-type load shim
  if (type == null && isModulePayload(data.moduleData)) {
    return { ok: true, message: data as unknown as LegacyLoadMsg };
  }

  return { ok: false, error: 'unknown main→worklet message type: ' + String(type) };
}

/** Normalize postMessage payload to a tight Uint8Array view. */
function moduleBytesFromPayload(moduleData: ArrayBuffer | Uint8Array): Uint8Array {
  if (moduleData instanceof Uint8Array) {
    if (moduleData.byteOffset === 0 && moduleData.byteLength === moduleData.buffer.byteLength) {
      return moduleData;
    }
    return moduleData.slice();
  }
  return new Uint8Array(moduleData);
}

/** UTF-8 encode without relying on TextEncoder (not guaranteed in every worklet impl). */
function utf8Bytes(str: string): Uint8Array {
  const escaped = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(escaped.length);
  for (let i = 0; i < escaped.length; i++) bytes[i] = escaped.charCodeAt(i);
  return bytes;
}

/** Allocate a NUL-terminated UTF-8 C string in the WASM heap. Caller must _free() it. */
function allocUtf8CString(lib: LibOpenMPT, str: string): number {
  const bytes = utf8Bytes(str);
  const ptr = lib._malloc(bytes.byteLength + 1);
  if (!ptr) throw new Error('_malloc returned 0 for ctl string');
  lib.HEAPU8.set(bytes, ptr);
  lib.HEAPU8[ptr + bytes.byteLength] = 0;
  return ptr;
}

/**
 * Host-specific half of the shared-scope libopenmpt singleton: evaluate the glue seeded with the real
 * wasm bytes and wait until the runtime is ready. The policy around it (reuse, one init promise for
 * concurrent callers, the real-wasm-bytes guards) is audio-worklet/libSingleton.ts, which is also what
 * the unit tests run.
 */
async function bootstrapLibOpenMPT(
  scriptText: string,
  wasmBytes: ArrayBuffer | Uint8Array,
): Promise<LibOpenMPT> {
  log(
    'Evaluating libopenmpt-worklet.js (',
    scriptText.length,
    ' chars, wasmBytes:',
    wasmBytes.byteLength,
    ')…',
  );

  if (typeof globalThis.performance === 'undefined') {
    globalThis.performance = { now: () => currentTime * 1000 };
  }

  if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
    globalThis.crypto = {
      getRandomValues: function (array) {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
        return array;
      },
    };
  }

  globalThis.libopenmpt = { noInitialRun: true, wasmBinary: wasmBytes };

  const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, '');
  const fn = new Function(cleanedScript);
  fn.call(globalThis);

  const lib = globalThis.libopenmpt as unknown as LibOpenMPT | undefined;
  if (!lib || typeof lib !== 'object') {
    throw new Error('globalThis.libopenmpt not set after script evaluation');
  }

  // Always wait: real-wasm glue defines lazy export stubs at eval time, so the presence of
  // `_openmpt_*` proves nothing (see audio-worklet/libRuntimeReady.ts).
  log('Waiting for WASM onRuntimeInitialized…');
  await waitForRuntimeInitialized(lib, 25000);
  return lib;
}

/**
 * Initialise libopenmpt once per AudioWorkletGlobalScope.
 * Every AudioWorkletNode shares this scope — re-evaluating the glue (and
 * re-instantiating the wasm) on each node creation resets heap state and breaks
 * module reload (XM/MOD).
 */
function ensureSharedLibOpenMPT(
  scriptText: string | undefined,
  wasmBytes: ArrayBuffer | Uint8Array | undefined,
): Promise<LibOpenMPT> {
  return ensureSharedLib<LibOpenMPT>(globalThis, scriptText, wasmBytes, {
    bootstrap: bootstrapLibOpenMPT,
    log,
  });
}

// ── Audio-reactive SAB layout (must match utils/audioReactive.ts) ───────────
const OSC_SAMPLE_COUNT = 2048;
const AUDIO_REACTIVE_FLOATS = 16;
const AUDIO_SAB_BYTES = (OSC_SAMPLE_COUNT + AUDIO_REACTIVE_FLOATS) * 4;
const AR_BASS = 0;
const AR_MID = 1;
const AR_HIGH = 2;
const AR_AMPLITUDE = 3;
const AR_BEAT = 4;
const AR_PEAK_L = 5;
const AR_PEAK_R = 6;
const AR_RMS_L = 7;
const AR_RMS_R = 8;
const AR_FLAGS = 9;
const AR_FLAG_LITE = 1;

function onePoleAlpha(cutoffHz: number, sr: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / sr);
}

interface AudioDiagMessage {
  type: string;
  budgetMs: number;
  quanta: number;
  avgProcessMs: number;
  maxProcessMs: number;
  overruns: number;
  wraps: number;
  wrapMaxProcessMs: number;
  wrapOverruns: number;
  order: number;
  row: number;
  slowMs: number;
  slowOrder: number;
  slowRow: number;
  pcmEnabled: boolean;
  audioLite: boolean;
  audioTime: number;
  wrapProcessMs: number[];
  maxCallbackGapMs: number;
  heapBytes: number;
  heapMoves: number;
  playingChannels?: number;
}

class XMPlayerProcessor extends AudioWorkletProcessor {
  declare modulePtr: number;
  declare leftBufPtr: number;
  declare rightBufPtr: number;
  declare maxFrames: number;
  declare lib: LibOpenMPT | null;
  declare isLibReady: boolean;
  declare isPlaying: boolean;
  declare hasEnded: boolean;
  /** Set when process() caught a wasm trap; output stays silent until the next load(). */
  declare faulted: boolean;
  /** Current/target output gain for the load-swap fade (see loadModule()). */
  declare _fadeGain: number;
  declare _fadeTarget: number;
  declare _fadeStep: number;

  declare positionReportInterval: number;
  declare lastPositionReportTime: number;
  /** Last integer row — used only for diagnostics / wrap detection. */
  declare _lastReportedRowInt: number;
  /** Cached HEAPF32 views — recreate only when the wasm heap buffer moves. */
  declare _leftHeapView: Float32Array | null;
  declare _rightHeapView: Float32Array | null;
  declare _heapBuffer: ArrayBufferLike | null;

  // ── Project-M PCM accumulation ─────────────────────────────────
  // Off by default: allocating + postMessage(~88 Hz) competed with
  // read_float_stereo at XM pattern starts. Enable via setProjectmPcm when
  // a Project-M host is actually listening; otherwise RAF AnalyserNode
  // bridge covers embedded/popup cases.
  declare _projectmPcmEnabled: boolean;
  declare pcmChunkSize: number;
  declare pcmAccumL: Float32Array;
  declare pcmAccumR: Float32Array;
  /** Reused interleaved PCM block — avoids new Float32Array on every emit. */
  declare pcmInterleaved: Float32Array;
  declare pcmAccumCount: number;
  /** Transferable buffers returned by the main thread (see MT.returnPcmBuffer) — reused instead of allocating a fresh payload every emit. */
  declare pcmBufferPool: Float32Array<ArrayBuffer>[];

  declare _libInitPromise: Promise<void>;
  declare _resolveLib: (value?: void | PromiseLike<void>) => void;
  declare _rejectLib: (reason?: unknown) => void;
  declare _libInitTimeout: number | null;

  declare oscBuffer: SharedArrayBuffer | null;
  declare oscView: Float32Array | null;
  declare audioMetaView: Float32Array | null;
  declare oscWritePtr: number;
  declare _audioLite: boolean;
  declare _audioLiteExplicit: boolean;
  /** Interpolation filter length; re-applied after every module create (which resets render params). */
  declare _interpolationLength: number;
  // ?audioDiag=1 — per-quantum process() timing, correlated with row wraps.
  declare _audioDiag: boolean;
  /** Reused channel VU snapshot (length grows once to numChannels, then stable). */
  declare _channelVuArr: number[];
  declare _lastChannelVU: number[];
  declare _prevRowInt: number;
  declare _lastOrder: number;
  declare _lastBpm: number;
  declare _lastSpeed: number;
  /** O(1) in-row fraction: snapshot positionSeconds when rowInt changes. */
  declare _fracRowInt: number;
  declare _rowStartPosSec: number;
  /** Session heap-view recreates (HEAPF32.buffer identity changed). */
  declare _heapMoves: number;
  /** Audio clock of the previous process() — callback-gap diag. */
  declare _lastProcessTime: number;
  /** First N wrap windows' maxProcessMs (session; not reset per report). */
  declare _diagSessionWrapProcessMs: number[];
  declare _lpBass: number;
  declare _lpMid: number;
  declare _prevBass: number;
  declare _beatDecay: number;
  declare _smoothBass: number;
  declare _smoothMid: number;
  declare _smoothHigh: number;
  declare _alphaBass: number;
  declare _alphaMid: number;

  declare _diagQuanta: number;
  declare _diagSumMs: number;
  declare _diagMaxMs: number;
  declare _diagOverruns: number;
  declare _diagWrapMaxMs: number;
  declare _diagWrapCount: number;
  declare _diagWrapOverruns: number;
  declare _diagSlowMs: number;
  declare _diagSlowOrder: number;
  declare _diagSlowRow: number;
  declare _diagMaxGapMs: number;

  constructor(options?: AudioWorkletCtorOptions) {
    super(options);

    this.modulePtr = 0;
    this.leftBufPtr = 0;
    this.rightBufPtr = 0;
    this.maxFrames = 4096;
    this.lib = null;
    this.isLibReady = false;
    this.isPlaying = true;
    this.hasEnded = false;
    this.faulted = false;
    this._fadeGain = 1;
    this._fadeTarget = 1;
    this._fadeStep = 1 / Math.max(1, Math.round((sampleRate * LOAD_FADE_MS) / 1000));

    this.positionReportInterval = 1 / 60;
    this.lastPositionReportTime = 0;
    this._lastReportedRowInt = -1;
    this._leftHeapView = null;
    this._rightHeapView = null;
    this._heapBuffer = null;

    this._projectmPcmEnabled = false;
    this.pcmChunkSize = 512;   // target block size (~11.6 ms @ 44100 Hz)
    this.pcmAccumL = new Float32Array(this.pcmChunkSize);
    this.pcmAccumR = new Float32Array(this.pcmChunkSize);
    this.pcmInterleaved = new Float32Array(this.pcmChunkSize * 2);
    this.pcmAccumCount = 0;
    this.pcmBufferPool = [];

    log('Constructor called, sampleRate:', sampleRate);

    const sharedLib = globalThis.__openmptWorkletLib;
    if (sharedLib && typeof sharedLib._openmpt_module_create_from_memory2 === 'function') {
      this.lib = sharedLib;
      this.isLibReady = true;
      this._libInitPromise = Promise.resolve();
      this._resolveLib = () => {};
      this._rejectLib = () => {};
      this._libInitTimeout = null;
      log('Attached to pre-initialised shared libopenmpt');
    } else {
      // _libInitPromise resolves once the main thread sends 'initLib'
      // and WASM finishes initialising. loadModule() awaits this.
      this._libInitPromise = new Promise((resolve, reject) => {
        this._resolveLib = resolve;
        this._rejectLib = reject;
      });
      // Init failures (missing/corrupt wasm, glue abort, timeout) are reported to the main thread
      // as WT.error messages; don't ALSO raise an unhandledrejection when nothing is awaiting yet.
      this._libInitPromise.catch(() => {});
      this._libInitTimeout = setTimeout(() => {
        this._rejectLib(new Error('WASM init timeout: initLib message never received'));
        this.port.postMessage({ type: WT.error, message: 'WASM library init timeout' });
      }, 30000);
    }

    this.port.onmessage = async (e: WorkletMessageEvent) => {
      const parsed = parseMainToWorkletMessage(e.data);
      if (!parsed.ok) {
        error('Rejected main→worklet message:', parsed.error, e.data);
        return;
      }
      const msg = parsed.message;
      const type = msg.type;
      log('Received message:', type || '(legacy-load)');

      if (type === MT.initLib) {
        await this._handleInitLib(msg);
      } else if (type === MT.load) {
        this.hasEnded = false;
        await this.loadModule(msg.moduleData);
      } else if (type === MT.play) {
        this.isPlaying = true;
        this.hasEnded = false;
        log('Playback started');
      } else if (type === MT.pause) {
        this.isPlaying = false;
        log('Playback paused');
      } else if (type === MT.seek) {
        this.hasEnded = false;
        this._fracRowInt = -1;
        this._rowStartPosSec = 0;
        if (this.modulePtr && this.lib) {
          this.lib._openmpt_module_set_position_order_row(
            this.modulePtr, msg.order, msg.row,
          );
          log('Seek executed:', msg.order, msg.row);
        } else {
          error('Cannot seek: module not loaded');
        }
        this.port.postMessage({ type: WT.seekAck });
      } else if (type === MT.getOscBuffer) {
        if (this.oscBuffer) {
          this.port.postMessage({ type: WT.oscBuffer, buffer: this.oscBuffer });
        }
      } else if (type === MT.setAudioLite) {
        this._audioLiteExplicit = true;
        this._audioLite = !!msg.lite;
      } else if (type === MT.setProjectmPcm) {
        this._projectmPcmEnabled = !!msg.enabled;
        if (!this._projectmPcmEnabled) this.pcmAccumCount = 0;
      } else if (type === MT.setAudioDiag) {
        this._audioDiag = !!msg.enabled;
        this._resetAudioDiag();
        this._diagSessionWrapProcessMs = [];
        this._lastProcessTime = -1;
      } else if (type === MT.setChannelMute) {
        // TODO(#416): live channel mute needs the libopenmpt `openmpt_module_ext`
        // interactive interface (set_channel_mute_status): create the module with
        // ext_create_from_memory, read the function-pointer table via
        // ext_get_interface, and call set_channel_mute_status through the exported
        // Module.dynCall('iiii', …) (the real-wasm glue exports getValue/dynCall;
        // utils/libopenmptExt.ts already does this on the main thread for offline
        // render). Land it as its own change (#416) rather than guess at an
        // untested audio-thread swap of the create path here. Native engine mutes
        // via cpp/openmpt_wrapper.cpp's KEEPAlives in the meantime.
        if (WORKLET_DEV) {
          throw new Error('setChannelMute not implemented for JS engine yet (TODO #416)');
        }
      } else if (type === MT.setRenderParam) {
        if (msg.param === OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH) {
          this._interpolationLength = msg.value;
        }
        if (this.modulePtr && this.lib && typeof this.lib._openmpt_module_set_render_param === 'function') {
          this.lib._openmpt_module_set_render_param(this.modulePtr, msg.param, msg.value);
        }
      } else if (type === MT.returnPcmBuffer) {
        // Only take back buffers sized for the current chunk — a stale return
        // from before a chunk-size change (there is none today, but stay safe)
        // would corrupt the next emit's .set() into a too-small view.
        if (msg.buffer.length === this.pcmChunkSize * 2
          && this.pcmBufferPool.length < PCM_BUFFER_POOL_MAX) {
          this.pcmBufferPool.push(msg.buffer);
        }
      } else if (type === MT.ctlSetText) {
        const lib = this.lib;
        if (this.modulePtr && lib && typeof lib._openmpt_module_ctl_set_text === 'function') {
          const ctlSetText = lib._openmpt_module_ctl_set_text;
          const keyPtr = allocUtf8CString(lib, msg.key);
          const valuePtr = allocUtf8CString(lib, msg.value);
          try {
            ctlSetText(this.modulePtr, keyPtr, valuePtr);
          } finally {
            lib._free(keyPtr);
            lib._free(valuePtr);
          }
        }
      } else if (!type) {
        await this.loadModule(msg.moduleData);
      }
    };

    try {
      this.oscBuffer = new SharedArrayBuffer(AUDIO_SAB_BYTES);
    } catch {
      this.oscBuffer = null;
    }
    this.oscView = this.oscBuffer ? new Float32Array(this.oscBuffer, 0, OSC_SAMPLE_COUNT) : null;
    this.audioMetaView = this.oscBuffer
      ? new Float32Array(this.oscBuffer, OSC_SAMPLE_COUNT * 4, AUDIO_REACTIVE_FLOATS)
      : null;
    this.oscWritePtr = 0;
    this._audioLite = false;
    this._audioLiteExplicit = false;
    this._interpolationLength = DEFAULT_INTERPOLATION_LENGTH;
    this._audioDiag = false;
    this._resetAudioDiag();
    this._channelVuArr = [];
    this._lastChannelVU = this._channelVuArr;
    this._prevRowInt = -1;
    this._lastOrder = 0;
    this._lastBpm = 125;
    this._lastSpeed = 6;
    this._fracRowInt = -1;
    this._rowStartPosSec = 0;
    this._heapMoves = 0;
    this._lastProcessTime = -1;
    this._diagSessionWrapProcessMs = [];
    this._lpBass = 0;
    this._lpMid = 0;
    this._prevBass = 0;
    this._beatDecay = 0;
    this._smoothBass = 0;
    this._smoothMid = 0;
    this._smoothHigh = 0;
    this._alphaBass = onePoleAlpha(180, sampleRate);
    this._alphaMid = onePoleAlpha(1200, sampleRate);
    if (this.oscBuffer) {
      this.port.postMessage({ type: WT.oscBuffer, buffer: this.oscBuffer });
    }
  }

  /** Clear the ?audioDiag=1 window accumulators (after each report). Session wrap history stays. */
  _resetAudioDiag(): void {
    this._diagQuanta = 0;
    this._diagSumMs = 0;
    this._diagMaxMs = 0;
    this._diagOverruns = 0;
    this._diagWrapMaxMs = 0;
    this._diagWrapCount = 0;
    this._diagWrapOverruns = 0;
    this._diagSlowMs = 0;
    this._diagSlowOrder = 0;
    this._diagSlowRow = 0;
    this._diagMaxGapMs = 0;
  }

  /** High-resolution clock for diagnostics.
   *  Do NOT use performance.now() here — in AudioWorklet it is often polyfilled
   *  from currentTime, which is frozen for the entire process() callback. */
  _diagNow(): number {
    if (typeof Date !== 'undefined' && typeof Date.now === 'function') {
      return Date.now();
    }
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : 0;
  }

  /**
   * Cheap 3-band energy + peak/RMS into audioMetaView (no main-thread AnalyserNode).
   * Call at most ~60 Hz — GPU consumers sample SAB at display rate; running this every
   * quantum (~350 Hz) stole budget from read_float_stereo at XM pattern starts.
   */
  _updateAudioReactive(outL: Float32Array, outR: Float32Array, count: number, channelVU: number[] | undefined): void {
    const meta = this.audioMetaView;
    if (!meta) return;

    if (this._audioLite) {
      let vuMax = 0;
      const n = channelVU ? channelVU.length : 0;
      for (let i = 0; i < n; i++) {
        const v = channelVU![i]!;
        if (v > vuMax) vuMax = v;
      }
      const coarse = Math.min(1, vuMax * 1.2);
      const smooth = 0.82;
      this._smoothBass = this._smoothBass * smooth + coarse * (1 - smooth);
      this._smoothMid = this._smoothMid * smooth + coarse * 0.55 * (1 - smooth);
      this._smoothHigh = this._smoothHigh * smooth + coarse * 0.3 * (1 - smooth);
      meta[AR_BASS] = this._smoothBass;
      meta[AR_MID] = this._smoothMid;
      meta[AR_HIGH] = this._smoothHigh;
      meta[AR_AMPLITUDE] = coarse;
      const beat = coarse > this._prevBass * 1.25 && coarse > 0.12 ? 1 : this._beatDecay * 0.86;
      this._beatDecay = beat;
      this._prevBass = coarse;
      meta[AR_BEAT] = beat;
      meta[AR_PEAK_L] = coarse;
      meta[AR_PEAK_R] = coarse;
      meta[AR_RMS_L] = coarse * 0.7;
      meta[AR_RMS_R] = coarse * 0.7;
      meta[AR_FLAGS] = AR_FLAG_LITE;
      return;
    }

    let peakL = 0;
    let peakR = 0;
    let sumSqL = 0;
    let sumSqR = 0;
    let bassAcc = 0;
    let midAcc = 0;
    let highAcc = 0;

    for (let i = 0; i < count; i++) {
      const l = outL[i]!;
      const r = outR[i]!;
      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
      sumSqL += l * l;
      sumSqR += r * r;

      const mono = (l + r) * 0.5;
      this._lpBass += this._alphaBass * (mono - this._lpBass);
      const midBand = mono - this._lpBass;
      this._lpMid += this._alphaMid * (midBand - this._lpMid);
      const highBand = midBand - this._lpMid;

      bassAcc += this._lpBass * this._lpBass;
      midAcc += this._lpMid * this._lpMid;
      highAcc += highBand * highBand;
    }

    const inv = 1 / Math.max(1, count);
    const bass = Math.sqrt(bassAcc * inv);
    const mid = Math.sqrt(midAcc * inv);
    const high = Math.sqrt(highAcc * inv);
    const amplitude = Math.min(1, (bass + mid + high) * 0.55);
    const rmsL = Math.sqrt(sumSqL * inv);
    const rmsR = Math.sqrt(sumSqR * inv);

    const smooth = 0.78;
    this._smoothBass = this._smoothBass * smooth + bass * (1 - smooth);
    this._smoothMid = this._smoothMid * smooth + mid * (1 - smooth);
    this._smoothHigh = this._smoothHigh * smooth + high * (1 - smooth);

    meta[AR_BASS] = Math.min(1, this._smoothBass * 2.8);
    meta[AR_MID] = Math.min(1, this._smoothMid * 3.2);
    meta[AR_HIGH] = Math.min(1, this._smoothHigh * 4.0);
    meta[AR_AMPLITUDE] = amplitude;
    meta[AR_PEAK_L] = peakL;
    meta[AR_PEAK_R] = peakR;
    meta[AR_RMS_L] = rmsL;
    meta[AR_RMS_R] = rmsR;
    meta[AR_FLAGS] = 0;

    const bassNorm = meta[AR_BASS]!;
    const beat = bassNorm > this._prevBass * 1.28 && bassNorm > 0.14
      ? 1.0
      : this._beatDecay * 0.87;
    this._beatDecay = beat;
    this._prevBass = bassNorm;
    meta[AR_BEAT] = beat;
  }

  /** Per-sample ramp toward `_fadeTarget` (see loadModule()'s output fade). */
  _applyLoadFade(outL: Float32Array, outR: Float32Array, count: number): void {
    let gain = this._fadeGain;
    const target = this._fadeTarget;
    const step = this._fadeStep;
    for (let i = 0; i < count; i++) {
      if (gain < target) gain = Math.min(target, gain + step);
      else if (gain > target) gain = Math.max(target, gain - step);
      outL[i] = outL[i]! * gain;
      outR[i] = outR[i]! * gain;
    }
    this._fadeGain = gain;
  }

  // ── libopenmpt bootstrap via main-thread-fetched assets ────────────
  // AudioWorklet classic scripts cannot use import() or importScripts(), and
  // this scope has no fetch(). Main thread fetches libopenmpt-worklet.js and
  // libopenmpt-worklet.wasm and posts both here. We evaluate the JS via
  // new Function() and seed Module.wasmBinary so Emscripten instantiates the
  // bytes directly instead of trying to fetch its sibling .wasm.
  async _handleInitLib({ scriptText, wasmBytes }: InitLibMsg): Promise<void> {
    try {
      if (this._libInitTimeout != null) clearTimeout(this._libInitTimeout);

      const lib = await ensureSharedLibOpenMPT(scriptText, wasmBytes);
      this.lib = lib;
      this.isLibReady = true;
      this._resolveLib();
      log('libopenmpt ready ✅');
    } catch (err) {
      error('Failed to initialise libopenmpt:', err);
      this._rejectLib(err);
      this.port.postMessage({ type: WT.error, message: 'Lib init failed: ' + String(err) });
    }
  }

  // ── Module loading ─────────────────────────────────────────────────
  async loadModule(moduleData: ArrayBuffer | Uint8Array): Promise<void> {
    log('loadModule: awaiting WASM ready…');

    try {
      await this._libInitPromise;
    } catch {
      // initLib already reported why (WT.error); fall through to the "never became ready" error.
    }

    if (!this.isLibReady || !this.lib) {
      error('WASM library never became ready');
      this.port.postMessage({ type: WT.error, message: 'WASM library init timeout' });
      return;
    }

    // Module create/destroy below is synchronous WASM work that can run long
    // enough on a large module to stall process() past its deadline (#4: measure
    // with ?audioDiag=1). Fade to silence first so a slow parse produces hush
    // instead of an abrupt discontinuity in whatever was still playing, then
    // fade back in once the swap (success or failure) is done. The wait here
    // gives process() a chance to actually run the fade-out quanta before the
    // blocking work below starts.
    this._fadeTarget = 0;
    await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, LOAD_FADE_MS); });

    try {
      const lib = this.lib;
      const bytes = moduleBytesFromPayload(moduleData);
      log('Loading module into libopenmpt:', bytes.byteLength, 'bytes');

      // Tear down previous module. Best-effort: after a process() trap (this.faulted)
      // the old pointer may itself be the corrupt one that caused the trap, so a
      // reload must not let a second throw from destroy() block recovery.
      if (this.modulePtr) {
        try {
          lib._openmpt_module_destroy(this.modulePtr);
        } catch (destroyErr) {
          error('destroy of previous module ptr failed (ignored, reloading anyway):', destroyErr);
        }
        this.modulePtr = 0;
      }
      // A fresh load is the recovery path for a faulted node — give it a real chance.
      this.faulted = false;
      if (this.leftBufPtr) { lib._free(this.leftBufPtr); this.leftBufPtr = 0; }
      if (this.rightBufPtr) { lib._free(this.rightBufPtr); this.rightBufPtr = 0; }

      // Copy file data into WASM heap
      const filePtr = lib._malloc(bytes.byteLength);
      if (!filePtr) throw new Error('_malloc returned 0 – out of WASM heap memory');

      lib.HEAPU8.set(bytes, filePtr);
      const create = lib._openmpt_module_create_from_memory2 ?? lib._openmpt_module_create_from_memory;
      if (!create) throw new Error('libopenmpt exports neither create_from_memory2 nor create_from_memory');
      this.modulePtr = create(
        filePtr, bytes.byteLength, 0, 0, 0, 0, 0, 0, 0,
      );
      lib._free(filePtr);

      if (this.modulePtr === 0) {
        throw new Error('openmpt_module_create_from_memory returned 0 (invalid format?)');
      }

      // Allocate persistent stereo output buffers in WASM heap
      this.leftBufPtr = lib._malloc(4 * this.maxFrames);
      this.rightBufPtr = lib._malloc(4 * this.maxFrames);
      this._heapBuffer = null;
      this._leftHeapView = null;
      this._rightHeapView = null;
      this._fracRowInt = -1;
      this._rowStartPosSec = 0;

      lib._openmpt_module_set_render_param(
        this.modulePtr,
        OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
        this._interpolationLength,
      );

      const numCh = lib._openmpt_module_get_num_channels(this.modulePtr);
      // Heavy XM/IT modules: full-band audio-reactive scan at 60 Hz still tips
      // process() over budget at pattern starts — auto-lite unless host opted in.
      if (numCh > 16 && !this._audioLiteExplicit) {
        this._audioLite = true;
        log('Auto audio-lite for', numCh, 'channels');
      }

      log('Module loaded ✅ ptr=', this.modulePtr);
      this.port.postMessage({ type: WT.loaded });
    } catch (err) {
      error('loadModule error:', err);
      this.port.postMessage({ type: WT.error, message: String(err) });
    } finally {
      // Always fade back in — including on failure, so a bad file doesn't
      // leave the node permanently silent while still marked "playing".
      this._fadeTarget = 1;
    }
  }

  // ── Audio process loop ─────────────────────────────────────────────
  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    // Fire any setTimeout polyfill callbacks whose deadline has elapsed.
    const timers = globalThis.__workletTimers;
    if (timers && timers.size > 0) {
      const now = currentTime;
      for (const [id, t] of timers) {
        if (t.deadline <= now) {
          timers.delete(id);
          try { t.fn(); } catch (e) { console.error('[Worklet] timer error', e); }
        }
      }
    }

    const out = outputs[0];
    const outL = out?.[0];
    const outR = out?.[1];

    if (!outL || !outR) return true;

    // Silence while WASM / module is still initialising or paused
    if (!this.modulePtr || !this.lib || !this.isPlaying) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    // A prior quantum trapped inside wasm (corrupt pointer, OOB heap access, …).
    // The instance is not trustworthy until the next load() rebuilds it — keep
    // outputting silence rather than re-entering the code that just crashed.
    if (this.faulted) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    try {
      this._renderQuantum(outL, outR);
    } catch (err) {
      // A real wasm trap (e.g. WebAssembly.RuntimeError: memory access out of
      // bounds) permanently corrupts this instance — nothing after it can be
      // trusted. Silence output, tell the main thread so it can restart the
      // node, and stay silent until that happens.
      outL.fill(0);
      outR.fill(0);
      this.faulted = true;
      error('process() trapped — silencing output and reporting fault:', err);
      this.port.postMessage({
        type: WT.error,
        message: 'PROCESS_FAULT: ' + String(err instanceof Error ? err.message : err),
        fatal: true,
      });
    }

    return true;
  }

  /** The actual per-quantum render + reporting work. Isolated so process() can wrap it in one try/catch. */
  _renderQuantum(outL: Float32Array, outR: Float32Array): void {
    // process() already checked modulePtr/lib/isPlaying before calling this —
    // re-checked here only to re-establish TS narrowing inside this method
    // (narrowing from the caller's guard doesn't cross the method boundary).
    if (!this.modulePtr || !this.lib) return;

    const numSamples = outL.length;
    const framesToRead = Math.min(numSamples, this.maxFrames);

    // ── Pre-render position snapshot ─────────────────────────────────
    // libopenmpt DSP is heaviest at pattern/row boundaries. Anything that is
    // not required to *produce samples* must stay off the per-quantum path
    // (~350 Hz / ~2.9 ms budget). Position, VU, fractional row, and audio-
    // reactive SAB updates run at ~60 Hz only.
    const lib = this.lib;
    const mod = this.modulePtr;
    const diagOn = this._audioDiag;
    const diagStart = diagOn ? this._diagNow() : 0;
    const audioTime = currentTime;
    const shouldReportPosition =
      currentTime - this.lastPositionReportTime >= this.positionReportInterval;

    // Default to last reported values so non-report quanta do zero WASM queries.
    let order = this._lastOrder;
    let rowInt = this._prevRowInt;
    let posSec = 0;
    let bpm = this._lastBpm;
    let speed = this._lastSpeed;
    let rowFraction: number = rowInt;
    let playingChannels = -1;

    if (shouldReportPosition) {
      // Capture *before* read_float_stereo so the row matches this quantum's
      // first sample (main-thread prediction anchors on audioTime).
      // Do NOT query time-at-row here — libopenmpt GetLength walks the song
      // up to (order, row), so cost grew across wraps until audio garbled.
      rowInt = lib._openmpt_module_get_current_row(mod);
      order = lib._openmpt_module_get_current_order(mod);
      posSec = lib._openmpt_module_get_position_seconds(mod);
      bpm = lib._openmpt_module_get_current_estimated_bpm(mod);
      speed = lib._openmpt_module_get_current_speed(mod);
      this._lastOrder = order;
      this._lastBpm = bpm;
      this._lastSpeed = speed;

      if (rowInt !== this._fracRowInt) {
        this._rowStartPosSec = posSec;
        this._fracRowInt = rowInt;
      }
      const rowsPerSec = Math.max(0.25, (Math.max(bpm, 1) / 60) * 4);
      const frac = (posSec - this._rowStartPosSec) * rowsPerSec;
      rowFraction = rowInt + Math.min(0.999, Math.max(0, Number.isFinite(frac) ? frac : 0));

      if (diagOn && typeof lib._openmpt_module_get_current_playing_channels === 'function') {
        playingChannels = lib._openmpt_module_get_current_playing_channels(mod);
      }
    }

    const samplesWritten = lib._openmpt_module_read_float_stereo(
      mod,
      sampleRate,
      framesToRead,
      this.leftBufPtr,
      this.rightBufPtr,
    );

    if (samplesWritten === 0) {
      outL.fill(0);
      outR.fill(0);
      if (!this.hasEnded) {
        this.hasEnded = true;
        this.port.postMessage({ type: WT.ended });
      }
      return;
    }
    this.hasEnded = false;

    // Zero-copy view into WASM heap (reuse TypedArray when heap buffer stable).
    // Manual copy — NOT subarray()+set — avoids allocating 2 TypedArray views
    // per quantum (~700 GC objects/s) which showed up as skip→crackle cascades.
    const heapBuf = lib.HEAPF32.buffer;
    if (this._heapBuffer !== heapBuf) {
      this._heapBuffer = heapBuf;
      this._leftHeapView = new Float32Array(heapBuf, this.leftBufPtr, this.maxFrames);
      this._rightHeapView = new Float32Array(heapBuf, this.rightBufPtr, this.maxFrames);
      this._heapMoves++;
    }
    const leftSrc = this._leftHeapView!;
    const rightSrc = this._rightHeapView!;
    for (let i = 0; i < samplesWritten; i++) {
      outL[i] = leftSrc[i]!;
      outR[i] = rightSrc[i]!;
    }

    if (this._fadeGain !== this._fadeTarget) {
      this._applyLoadFade(outL, outR, samplesWritten);
    }

    // Copy first 128 samples into oscilloscope ring buffer
    if (this.oscView) {
      const framesToCopy = Math.min(128, samplesWritten);
      for (let i = 0; i < framesToCopy; i++) {
        this.oscView[this.oscWritePtr] = outL[i]!;
        this.oscWritePtr = (this.oscWritePtr + 1) & (OSC_SAMPLE_COUNT - 1);
      }
    }

    // Silence remainder if libopenmpt rendered fewer frames
    if (samplesWritten < numSamples) {
      outL.fill(0, samplesWritten);
      outR.fill(0, samplesWritten);
    }

    // ── Project-M PCM (opt-in) ───────────────────────────────────────
    // Off by default: interleave + postMessage competed with render at XM
    // pattern starts. Reuses pcmInterleaved (no transfer list — transferring
    // would detach the buffer and force reallocation every emit).
    if (this._projectmPcmEnabled) {
      let src = 0;
      while (src < samplesWritten) {
        const space = this.pcmChunkSize - this.pcmAccumCount;
        const toCopy = Math.min(samplesWritten - src, space);
        for (let i = 0; i < toCopy; i++) {
          this.pcmAccumL[this.pcmAccumCount + i] = outL[src + i]!;
          this.pcmAccumR[this.pcmAccumCount + i] = outR[src + i]!;
        }
        this.pcmAccumCount += toCopy;
        src += toCopy;

        if (this.pcmAccumCount >= this.pcmChunkSize) {
          const interleaved = this.pcmInterleaved;
          for (let i = 0; i < this.pcmChunkSize; i++) {
            interleaved[i * 2] = this.pcmAccumL[i]!;
            interleaved[i * 2 + 1] = this.pcmAccumR[i]!;
          }
          // Copy into a pooled buffer (returned by the main thread after it
          // consumes the previous block — see MT.returnPcmBuffer) instead of
          // allocating a fresh one every ~11.6 ms; the reusable accumulator
          // (`interleaved`) itself is never transferred, so it stays attached.
          const payload = this.pcmBufferPool.pop() ?? new Float32Array(this.pcmChunkSize * 2);
          payload.set(interleaved);
          this.port.postMessage(
            {
              type: WT.projectmPcm, buffer: payload, channels: 2,
              sampleRate, samplesPerChannel: this.pcmChunkSize,
            },
            [payload.buffer],
          );
          this.pcmAccumCount = 0;
        }
      }
    }

    // VU + audio-reactive SAB + position post only at report rate (~60 Hz).
    // Per-channel VU / IIR band split must not run every quantum.
    if (shouldReportPosition) {
      const numCh = lib._openmpt_module_get_num_channels(mod);
      const n = Math.min(numCh, 32);
      let channelVU = this._channelVuArr;
      if (channelVU.length !== n) {
        channelVU = new Array<number>(n);
        this._channelVuArr = channelVU;
      }
      for (let i = 0; i < n; i++) {
        channelVU[i] = lib._openmpt_module_get_current_channel_vu_mono(mod, i);
      }
      this._lastChannelVU = channelVU;

      this._updateAudioReactive(outL, outR, samplesWritten, channelVU);

      this._lastReportedRowInt = rowInt;
      this.port.postMessage({
        type: WT.position,
        order,
        row: rowInt,
        rowFraction,
        positionSeconds: posSec,
        bpm,
        speed,
        /** Preferred name — audio timeline of pre-render snapshot. */
        audioTime,
        /** Alias kept for older main-thread handlers. */
        workletTime: audioTime,
        samplesWritten,
        sampleRate,
        channelVU,
      });
      this.lastPositionReportTime = currentTime;
    }

    if (diagOn) {
      const elapsedMs = this._diagNow() - diagStart;
      // Deadline for this callback: one quantum of wall time.
      const budgetMs = (numSamples / sampleRate) * 1000;
      if (this._lastProcessTime >= 0) {
        const gapMs = (audioTime - this._lastProcessTime) * 1000 - budgetMs;
        if (gapMs > this._diagMaxGapMs) this._diagMaxGapMs = gapMs;
      }
      this._lastProcessTime = audioTime;

      this._diagQuanta++;
      this._diagSumMs += elapsedMs;
      if (elapsedMs > this._diagMaxMs) {
        this._diagMaxMs = elapsedMs;
        this._diagSlowMs = elapsedMs;
        this._diagSlowOrder = order;
        this._diagSlowRow = rowInt;
      }
      if (elapsedMs > budgetMs) this._diagOverruns++;

      // Wrap detection is report-rate only (no extra get_current_row per quantum).
      const wrapped = shouldReportPosition
        && this._prevRowInt >= 0
        && rowInt < this._prevRowInt;
      if (wrapped) {
        this._diagWrapCount++;
        if (elapsedMs > this._diagWrapMaxMs) this._diagWrapMaxMs = elapsedMs;
        if (elapsedMs > budgetMs) this._diagWrapOverruns++;
        if (this._diagSessionWrapProcessMs.length < 16) {
          this._diagSessionWrapProcessMs.push(this._diagMaxMs);
        }
      }

      if (shouldReportPosition && this._diagQuanta > 0) {
        const diagMsg: AudioDiagMessage = {
          type: WT.audioDiag,
          budgetMs,
          quanta: this._diagQuanta,
          avgProcessMs: this._diagSumMs / this._diagQuanta,
          maxProcessMs: this._diagMaxMs,
          overruns: this._diagOverruns,
          wraps: this._diagWrapCount,
          wrapMaxProcessMs: this._diagWrapMaxMs,
          wrapOverruns: this._diagWrapOverruns,
          order,
          row: rowInt,
          slowMs: this._diagSlowMs,
          slowOrder: this._diagSlowOrder,
          slowRow: this._diagSlowRow,
          pcmEnabled: !!this._projectmPcmEnabled,
          audioLite: !!this._audioLite,
          audioTime,
          wrapProcessMs: this._diagSessionWrapProcessMs.slice(),
          maxCallbackGapMs: this._diagMaxGapMs,
          heapBytes: heapBuf.byteLength,
          heapMoves: this._heapMoves,
        };
        if (playingChannels >= 0) diagMsg.playingChannels = playingChannels;
        this.port.postMessage(diagMsg);
        this._resetAudioDiag();
      }
    }
    if (shouldReportPosition) {
      this._prevRowInt = rowInt;
    }
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
log('[OpenMPTWorklet] Script loaded, processor registered');

