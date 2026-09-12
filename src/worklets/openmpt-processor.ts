/**
 * OpenMPT AudioWorklet Processor — TypeScript source of record.
 *
 * Built to public/worklets/openmpt-worklet.js by scripts/build-worklet-js.mjs
 * (esbuild, IIFE, no minify). **Edit this file, never the generated output.**
 *
 * ⚠️  WARNING: This file MUST call _openmpt_module_read_float_stereo() in process().
 *     Do NOT replace this with a stub/test tone. A previous stub (commit 499a862)
 *     broke all MOD playback by generating a 440Hz sine wave instead of rendering
 *     the loaded module. See docs/WORKLET_AUDIO_BUG.md for the full post-mortem.
 *
 * WASM loading strategy: AudioWorklet classic scripts cannot use import() or
 * importScripts(). Instead, the main thread fetches libopenmpt-audioworklet.js
 * (and, only for classic Emscripten binary builds, libopenmpt.wasm) and sends
 * them via postMessage({ type:'initLib', scriptText, wasmBytes? }).
 *
 * Production glue is **wasm2js** (~5 MB JS with the runtime embedded). In that
 * mode wasmBytes is omitted — do NOT seed a fake/empty sibling .wasm. For a
 * future real-WASM glue, main thread validates \0asm magic before transfer.
 *
 * NOTE: Chrome 116+ provides setTimeout in AudioWorkletGlobalScope. Older
 * browsers don't, so we polyfill it below using process()-driven ticks.
 */

import {
  MAIN_TO_WORKLET,
  WORKLET_TO_MAIN,
} from '../../audio-worklet/workletProtocolConstants';
import {
  parseMainToWorkletMessage,
  type InitLibMessage,
  type LegacyLoadMessage,
  type MainToWorkletMessage,
} from '../../audio-worklet/mainToWorkletMessages';
import {
  AUDIO_REACTIVE_FLOATS,
  AUDIO_SAB_BYTES,
  AR_AMPLITUDE,
  AR_BASS,
  AR_BEAT,
  AR_FLAGS,
  AR_FLAG_LITE,
  AR_HIGH,
  AR_MID,
  AR_PEAK_L,
  AR_PEAK_R,
  AR_RMS_L,
  AR_RMS_R,
  OSC_SAMPLE_COUNT,
} from '../../utils/audioReactive';
import { G, type LibOpenMPTWasm } from './libopenmptWasm';

// Polyfill global crypto for AudioWorklet Global Scope if missing
// This MUST be set on globalThis before libopenmpt-audioworklet.js is evaluated
// so that Emscripten's randomFill can find it.
function installCryptoPolyfill(): void {
  G.crypto = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        // Fallback to pseudo-random numbers if true crypto is restricted
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  };
}

if (!G.crypto || typeof G.crypto.getRandomValues !== 'function') {
  installCryptoPolyfill();
}

// Message types — single source of truth is audio-worklet/workletProtocolConstants.ts,
// bundled in here rather than mirrored as a second classic script.
const MT = MAIN_TO_WORKLET;
const WT = WORKLET_TO_MAIN;
const parseMainToWorklet = parseMainToWorkletMessage;

// Older Chrome/Edge/Firefox don't expose timers in the worklet scope.
// Schedule callbacks via currentTime checks driven by process().
if (typeof G.setTimeout !== 'function') {
  const _timers = new Map<number, { fn: () => void; deadline: number }>();
  let _nextTimerId = 1;
  G.__workletTimers = _timers;
  G.setTimeout = function (fn: () => void, delayMs?: number): number {
    const id = _nextTimerId++;
    const deadline = (typeof currentTime === 'number' ? currentTime : 0) + (delayMs || 0) / 1000;
    _timers.set(id, { fn, deadline });
    return id;
  };
  G.clearTimeout = function (id: number): void {
    _timers.delete(id);
  };
}

// Keep false in production: console I/O on the audio thread can cost real-time
// budget at pattern boundaries (many voices + log spam → underruns/crackle).
const DEBUG = false;
function log(...args: unknown[]): void { if (DEBUG) console.log('[Worklet]', ...args); }
function error(...args: unknown[]): void { console.error('[Worklet]', ...args); }

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

/**
 * Initialise libopenmpt once per AudioWorkletGlobalScope.
 * Every AudioWorkletNode shares this scope — re-evaluating the ~5 MB glue on
 * each node creation resets WASM heap state and breaks module reload (XM/MOD).
 */
async function ensureSharedLibOpenMPT(
  scriptText: string | undefined,
  wasmBytes: ArrayBuffer | undefined,
): Promise<LibOpenMPTWasm> {
  const existing = G.__openmptWorkletLib;
  if (existing && typeof existing._openmpt_module_create_from_memory2 === 'function') {
    log('Reusing shared libopenmpt instance');
    return existing;
  }

  if (!G.__openmptWorkletLibInitPromise) {
    G.__openmptWorkletLibInitPromise = (async () => {
      if (!scriptText) {
        throw new Error('initLib missing scriptText');
      }

      const hasWasmBytes = !!wasmBytes && wasmBytes.byteLength > 0;

      log(
        'Evaluating libopenmpt-audioworklet.js (',
        scriptText.length,
        ' chars, wasmBytes:',
        hasWasmBytes ? (wasmBytes?.byteLength ?? 0) : 0,
        ')…',
      );

      if (typeof G.performance === 'undefined') {
        G.performance = { now: () => currentTime * 1000 };
      }

      if (!G.crypto || typeof G.crypto.getRandomValues !== 'function') {
        installCryptoPolyfill();
      }

      G.libopenmpt = { noInitialRun: true };
      if (wasmBytes && hasWasmBytes) {
        G.libopenmpt.wasmBinary = wasmBytes;
      }

      const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, '');
      // AudioWorklet classic scripts cannot import() — evaluating the glue text
      // is the only way to get libopenmpt into this scope.
      const fn = new Function(cleanedScript);
      fn.call(globalThis);

      const lib = G.libopenmpt as unknown as LibOpenMPTWasm | undefined;
      if (!lib || typeof lib !== 'object') {
        throw new Error('globalThis.libopenmpt not set after script evaluation');
      }

      if (!lib._openmpt_module_create_from_memory2) {
        log('Waiting for WASM onRuntimeInitialized…');
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('WASM onRuntimeInitialized timeout')), 25000,
          );
          if (lib.calledRun) {
            clearTimeout(timeout);
            resolve();
          } else {
            const prev = lib.onRuntimeInitialized;
            lib.onRuntimeInitialized = () => {
              clearTimeout(timeout);
              if (typeof prev === 'function') prev();
              resolve();
            };
          }
        });
      } else {
        log('WASM already initialised (functions present)');
      }

      G.__openmptWorkletLib = lib;
      return lib;
    })();
  }

  return G.__openmptWorkletLibInitPromise;
}

// ── Audio-reactive SAB layout — imported from utils/audioReactive.ts, which is
//    the same module the main thread and GPU uniform packer read. ────────────

function onePoleAlpha(cutoffHz: number, sr: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / sr);
}

class XMPlayerProcessor extends AudioWorkletProcessor {
  modulePtr!: number;
  leftBufPtr!: number;
  rightBufPtr!: number;
  maxFrames!: number;
  lib!: LibOpenMPTWasm | null;
  isLibReady!: boolean;
  isPlaying!: boolean;
  hasEnded!: boolean;

  positionReportInterval!: number;
  lastPositionReportTime!: number;
  _lastReportedRowInt!: number;
  _leftHeapView!: Float32Array | null;
  _rightHeapView!: Float32Array | null;
  _heapBuffer!: ArrayBufferLike | null;

  _projectmPcmEnabled!: boolean;
  pcmChunkSize!: number;
  pcmAccumL!: Float32Array;
  pcmAccumR!: Float32Array;
  pcmInterleaved!: Float32Array;
  pcmAccumCount!: number;

  _libInitPromise!: Promise<unknown>;
  _resolveLib!: () => void;
  _rejectLib!: (reason?: unknown) => void;
  _libInitTimeout!: number | null;

  oscBuffer!: SharedArrayBuffer | null;
  oscView!: Float32Array | null;
  audioMetaView!: Float32Array | null;
  oscWritePtr!: number;
  _audioLite!: boolean;
  _audioLiteExplicit!: boolean;
  _audioDiag!: boolean;
  _channelVuArr!: number[];
  _lastChannelVU!: number[];
  _prevRowInt!: number;
  _lastOrder!: number;
  _lastBpm!: number;
  _lastSpeed!: number;
  _fracRowInt!: number;
  _rowStartPosSec!: number;
  _heapMoves!: number;
  _lastProcessTime!: number;
  _diagSessionWrapProcessMs!: number[];
  _lpBass!: number;
  _lpMid!: number;
  _prevBass!: number;
  _beatDecay!: number;
  _smoothBass!: number;
  _smoothMid!: number;
  _smoothHigh!: number;
  _alphaBass!: number;
  _alphaMid!: number;

  // ?audioDiag=1 window accumulators
  _diagQuanta!: number;
  _diagSumMs!: number;
  _diagMaxMs!: number;
  _diagOverruns!: number;
  _diagWrapMaxMs!: number;
  _diagWrapCount!: number;
  _diagWrapOverruns!: number;
  _diagSlowMs!: number;
  _diagSlowOrder!: number;
  _diagSlowRow!: number;
  _diagMaxGapMs!: number;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);

    this.modulePtr = 0;
    this.leftBufPtr = 0;
    this.rightBufPtr = 0;
    this.maxFrames = 4096;
    this.lib = null;
    this.isLibReady = false;
    this.isPlaying = true;
    this.hasEnded = false;

    this.positionReportInterval = 1 / 60;
    this.lastPositionReportTime = 0;
    /** Last integer row — used only for diagnostics / wrap detection. */
    this._lastReportedRowInt = -1;
    /** Cached HEAPF32 views — recreate only when the wasm heap buffer moves. */
    this._leftHeapView = null;
    this._rightHeapView = null;
    this._heapBuffer = null;

    // ── Project-M PCM accumulation ─────────────────────────────────
    // Off by default: allocating + postMessage(~88 Hz) competed with
    // read_float_stereo at XM pattern starts. Enable via setProjectmPcm when
    // a Project-M host is actually listening; otherwise RAF AnalyserNode
    // bridge covers embedded/popup cases.
    this._projectmPcmEnabled = false;
    this.pcmChunkSize = 512;   // target block size (~11.6 ms @ 44100 Hz)
    this.pcmAccumL = new Float32Array(this.pcmChunkSize);
    this.pcmAccumR = new Float32Array(this.pcmChunkSize);
    /** Reused interleaved PCM block — avoids new Float32Array on every emit. */
    this.pcmInterleaved = new Float32Array(this.pcmChunkSize * 2);
    this.pcmAccumCount = 0;

    log('Constructor called, sampleRate:', sampleRate);

    const sharedLib = G.__openmptWorkletLib;
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
      this._libInitPromise = new Promise<void>((resolve, reject) => {
        this._resolveLib = () => resolve();
        this._rejectLib = reject;
      });
      this._libInitTimeout = setTimeout(() => {
        this._rejectLib(new Error('WASM init timeout: initLib message never received'));
        this.port.postMessage({ type: WT.error, message: 'WASM library init timeout' });
      }, 30000);
    }

    this.port.onmessage = async (e) => {
      const parsed = parseMainToWorklet(e.data);
      if (!parsed.ok) {
        error('Rejected main→worklet message:', parsed.error, e.data);
        return;
      }
      const msg: MainToWorkletMessage | LegacyLoadMessage = parsed.message;
      const type = msg.type;
      const moduleData = 'moduleData' in msg ? msg.moduleData : undefined;
      log('Received message:', type || '(legacy-load)', 'bytes:', moduleData?.byteLength);

      if (type === MT.initLib) {
        await this._handleInitLib(msg);
      } else if (type === MT.load && moduleData) {
        this.hasEnded = false;
        await this.loadModule(moduleData);
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
            this.modulePtr, msg.order, msg.row
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
        // Stub for #416 live mute on the JS engine; native uses KEEPAlives.
      } else if (type === MT.setRenderParam) {
        if (this.modulePtr && this.lib && typeof this.lib._openmpt_module_set_render_param === 'function') {
          this.lib._openmpt_module_set_render_param(this.modulePtr, msg.param, msg.value);
        }
      } else if (type === MT.ctlSetText) {
        // String marshalling into wasm2js is #416; accept the message so protocol stays valid.
      } else if (!type && moduleData) {
        await this.loadModule(moduleData);
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
    // ?audioDiag=1 — per-quantum process() timing, correlated with row wraps.
    this._audioDiag = false;
    this._resetAudioDiag();
    /** Reused channel VU snapshot (length grows once to numChannels, then stable). */
    this._channelVuArr = [];
    this._lastChannelVU = this._channelVuArr;
    this._prevRowInt = -1;
    this._lastOrder = 0;
    this._lastBpm = 125;
    this._lastSpeed = 6;
    /** O(1) in-row fraction: snapshot positionSeconds when rowInt changes. */
    this._fracRowInt = -1;
    this._rowStartPosSec = 0;
    /** Session heap-view recreates (HEAPF32.buffer identity changed). */
    this._heapMoves = 0;
    /** Audio clock of the previous process() — callback-gap diag. */
    this._lastProcessTime = -1;
    /** First N wrap windows' maxProcessMs (session; not reset per report). */
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
  _updateAudioReactive(
    outL: Float32Array,
    outR: Float32Array,
    count: number,
    channelVU: number[] | null,
  ): void {
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

  // ── libopenmpt bootstrap via main-thread-fetched assets ────────────
  // AudioWorklet classic scripts cannot use import() or importScripts().
  // Main thread fetches libopenmpt-audioworklet.js (+ optional real .wasm)
  // and posts them here. We evaluate the JS via new Function().
  //
  // wasm2js: do NOT set Module.wasmBinary — the glue clears wasmBinary to []
  // and embeds the runtime in JS. Seeding HTML/garbage overwrites that and
  // can break init. Classic binary builds: seed wasmBinary so Emscripten
  // skips its own network fetch of the sibling .wasm.
  async _handleInitLib({ scriptText, wasmBytes }: InitLibMessage): Promise<void> {
    try {
      if (this._libInitTimeout) clearTimeout(this._libInitTimeout);

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

    await this._libInitPromise;

    if (!this.isLibReady || !this.lib) {
      error('WASM library never became ready');
      this.port.postMessage({ type: WT.error, message: 'WASM library init timeout' });
      return;
    }

    try {
      const lib = this.lib;
      const bytes = moduleBytesFromPayload(moduleData);
      log('Loading module into libopenmpt:', bytes.byteLength, 'bytes');

      // Tear down previous module
      if (this.modulePtr) {
        lib._openmpt_module_destroy(this.modulePtr);
        this.modulePtr = 0;
      }
      if (this.leftBufPtr) { lib._free(this.leftBufPtr); this.leftBufPtr = 0; }
      if (this.rightBufPtr) { lib._free(this.rightBufPtr); this.rightBufPtr = 0; }

      // Copy file data into WASM heap
      const filePtr = lib._malloc(bytes.byteLength);
      if (!filePtr) throw new Error('_malloc returned 0 – out of WASM heap memory');

      lib.HEAPU8.set(bytes, filePtr);
      const create =
        typeof lib._openmpt_module_create_from_memory2 === 'function'
          ? lib._openmpt_module_create_from_memory2.bind(lib)
          : lib._openmpt_module_create_from_memory!.bind(lib);
      this.modulePtr = (create as (...args: number[]) => number)(
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

      // OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH is param 3
      // (param 2 is STEREOSEPARATION_PERCENT — do not confuse).
      // 0 / ≥8 = Sinc+LP; 1 = nearest; 2 = linear; 3–7 = cubic.
      // wasm2js stays on cubic: length 8 is too heavy at XM pattern wraps.
      const OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3;
      lib._openmpt_module_set_render_param!(this.modulePtr, OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, 4);

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
    }
  }

  // ── Audio process loop ─────────────────────────────────────────────
  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    // Fire any setTimeout polyfill callbacks whose deadline has elapsed.
    const timers = G.__workletTimers;
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
    const outL = out ? out[0] : undefined;
    const outR = out ? out[1] : undefined;

    if (!outL || !outR) return true;

    // Silence while WASM / module is still initialising or paused
    if (!this.modulePtr || !this.lib || !this.isPlaying) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

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
    let rowFraction = rowInt;
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
      this.rightBufPtr
    );

    if (samplesWritten === 0) {
      outL.fill(0);
      outR.fill(0);
      if (!this.hasEnded) {
        this.hasEnded = true;
        this.port.postMessage({ type: WT.ended });
      }
      return true;
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
            interleaved[i * 2]     = this.pcmAccumL[i]!;
            interleaved[i * 2 + 1] = this.pcmAccumR[i]!;
          }
          // Clone for postMessage so the reusable buffer stays attached.
          const payload = interleaved.slice();
          this.port.postMessage(
            { type: WT.projectmPcm, buffer: payload, channels: 2,
              sampleRate, samplesPerChannel: this.pcmChunkSize },
            [payload.buffer]
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
        const diagMsg: Record<string, unknown> = {
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

    return true;
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
log('[OpenMPTWorklet] Script loaded, processor registered');
