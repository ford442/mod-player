// Polyfill global crypto for AudioWorklet Global Scope if missing
// This MUST be set on globalThis before libopenmpt-audioworklet.js is evaluated
// so that Emscripten's randomFill can find it.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto) {
    globalThis.crypto = {
        getRandomValues: function(array) {
            for (let i = 0; i < array.length; i++) {
                // Fallback to pseudo-random numbers if true crypto is restricted
                array[i] = Math.floor(Math.random() * 256);
            }
            return array;
        }
    };
}
// Also set on self for backwards compatibility
if (typeof self !== 'undefined' && (!self.crypto || !self.crypto.getRandomValues)) {
    self.crypto = globalThis.crypto;
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

// Message types: loaded via worklet-protocol-constants.js (audio-worklet/workletProtocolConstants.ts)
const _proto = globalThis.WorkletProtocolConstants;
const MT = _proto ? _proto.MAIN_TO_WORKLET : {
  initLib: 'initLib', load: 'load', play: 'play', pause: 'pause', seek: 'seek',
  getOscBuffer: 'getOscBuffer', setAudioLite: 'setAudioLite', setProjectmPcm: 'setProjectmPcm', setAudioDiag: 'setAudioDiag',
};
const WT = _proto ? _proto.WORKLET_TO_MAIN : {
  position: 'position', loaded: 'loaded', ended: 'ended', seekAck: 'seekAck',
  error: 'error', oscBuffer: 'oscBuffer', needData: 'needData',
  starvation: 'starvation', projectmPcm: 'projectm-pcm', audioDiag: 'audioDiag',
};
const parseMainToWorklet = _proto
  ? _proto.parseMainToWorkletMessage.bind(_proto)
  : (data) => ({ ok: false, error: 'WorkletProtocolConstants not loaded' });

// Older Chrome/Edge/Firefox don't expose timers in the worklet scope.
// Schedule callbacks via currentTime checks driven by process().
if (typeof globalThis.setTimeout !== 'function') {
  const _timers = new Map();
  let _nextTimerId = 1;
  globalThis.__workletTimers = _timers;
  globalThis.setTimeout = function (fn, delayMs) {
    const id = _nextTimerId++;
    const deadline = (typeof currentTime === 'number' ? currentTime : 0) + (delayMs || 0) / 1000;
    _timers.set(id, { fn, deadline });
    return id;
  };
  globalThis.clearTimeout = function (id) {
    _timers.delete(id);
  };
}

// Keep false in production: console I/O on the audio thread can cost real-time
// budget at pattern boundaries (many voices + log spam → underruns/crackle).
const DEBUG = false;
function log(...args) { if (DEBUG) console.log('[Worklet]', ...args); }
function error(...args) { console.error('[Worklet]', ...args); }

/** Normalize postMessage payload to a tight Uint8Array view. */
function moduleBytesFromPayload(moduleData) {
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
async function ensureSharedLibOpenMPT(scriptText, wasmBytes) {
  const existing = globalThis.__openmptWorkletLib;
  if (existing && typeof existing._openmpt_module_create_from_memory2 === 'function') {
    log('Reusing shared libopenmpt instance');
    return existing;
  }

  if (!globalThis.__openmptWorkletLibInitPromise) {
    globalThis.__openmptWorkletLibInitPromise = (async () => {
      if (!scriptText) {
        throw new Error('initLib missing scriptText');
      }

      const hasWasmBytes =
        wasmBytes &&
        (wasmBytes instanceof ArrayBuffer
          ? wasmBytes.byteLength > 0
          : wasmBytes.byteLength > 0);

      log(
        'Evaluating libopenmpt-audioworklet.js (',
        scriptText.length,
        ' chars, wasmBytes:',
        hasWasmBytes ? (wasmBytes.byteLength || 0) : 0,
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

      globalThis.libopenmpt = { noInitialRun: true };
      if (hasWasmBytes) {
        globalThis.libopenmpt.wasmBinary = wasmBytes;
      }

      const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, '');
      const fn = new Function(cleanedScript); // eslint-disable-line no-new-func
      fn.call(globalThis);

      const lib = globalThis.libopenmpt;
      if (!lib || typeof lib !== 'object') {
        throw new Error('globalThis.libopenmpt not set after script evaluation');
      }

      if (!lib._openmpt_module_create_from_memory2) {
        log('Waiting for WASM onRuntimeInitialized…');
        await new Promise((resolve, reject) => {
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

      globalThis.__openmptWorkletLib = lib;
      return lib;
    })();
  }

  return globalThis.__openmptWorkletLibInitPromise;
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

function onePoleAlpha(cutoffHz, sr) {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / sr);
}

class XMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
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
      const msg = parsed.message;
      const type = msg.type;
      const moduleData = msg.moduleData;
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
        this._audioLite = !!msg.lite;
      } else if (type === MT.setProjectmPcm) {
        this._projectmPcmEnabled = !!msg.enabled;
        if (!this._projectmPcmEnabled) this.pcmAccumCount = 0;
      } else if (type === MT.setAudioDiag) {
        this._audioDiag = !!msg.enabled;
        this._resetAudioDiag();
      } else if (!type && moduleData) {
        await this.loadModule(moduleData);
      }
    };

    try {
      this.oscBuffer = new SharedArrayBuffer(AUDIO_SAB_BYTES);
    } catch (e) {
      this.oscBuffer = null;
    }
    this.oscView = this.oscBuffer ? new Float32Array(this.oscBuffer, 0, OSC_SAMPLE_COUNT) : null;
    this.audioMetaView = this.oscBuffer
      ? new Float32Array(this.oscBuffer, OSC_SAMPLE_COUNT * 4, AUDIO_REACTIVE_FLOATS)
      : null;
    this.oscWritePtr = 0;
    this._audioLite = false;
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

  /** Clear the ?audioDiag=1 accumulators (called on enable/disable and after each report). */
  _resetAudioDiag() {
    this._diagQuanta = 0;
    this._diagSumMs = 0;
    this._diagMaxMs = 0;
    this._diagOverruns = 0;
    this._diagWrapMaxMs = 0;
    this._diagWrapCount = 0;
    this._diagWrapOverruns = 0;
  }

  /** High-resolution clock for diagnostics; `currentTime` is frozen per quantum. */
  _diagNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : 0;
  }

  /**
   * Cheap 3-band energy + peak/RMS into audioMetaView (no main-thread AnalyserNode).
   * Call at most ~60 Hz — GPU consumers sample SAB at display rate; running this every
   * quantum (~350 Hz) stole budget from read_float_stereo at XM pattern starts.
   */
  _updateAudioReactive(outL, outR, count, channelVU) {
    const meta = this.audioMetaView;
    if (!meta) return;

    if (this._audioLite) {
      let vuMax = 0;
      const n = channelVU ? channelVU.length : 0;
      for (let i = 0; i < n; i++) {
        const v = channelVU[i];
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
      const l = outL[i];
      const r = outR[i];
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

    const bassNorm = meta[AR_BASS];
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
  async _handleInitLib({ scriptText, wasmBytes }) {
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
  async loadModule(moduleData) {
    log('loadModule: awaiting WASM ready…');

    await this._libInitPromise;

    if (!this.isLibReady) {
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
          : lib._openmpt_module_create_from_memory.bind(lib);
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

      // OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH:
      // 8 = highest-quality sinc (too heavy for wasm2js AudioWorklet on XM
      // pattern boundaries with many voices). 4 = windowed sinc — good quality
      // with far less per-quantum CPU; MOD rarely noticed 8→4, XM pattern
      // starts often did.
      lib._openmpt_module_set_render_param(this.modulePtr, 2, 4);

      log('Module loaded ✅ ptr=', this.modulePtr);
      this.port.postMessage({ type: WT.loaded });
    } catch (err) {
      error('loadModule error:', err);
      this.port.postMessage({ type: WT.error, message: String(err) });
    }
  }

  // ── Audio process loop ─────────────────────────────────────────────
  process(_inputs, outputs, _parameters) {
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
    const outL = out[0];
    const outR = out[1];

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

    if (shouldReportPosition || diagOn) {
      // Capture *before* read_float_stereo so the row matches this quantum's
      // first sample (main-thread prediction anchors on audioTime).
      rowInt = lib._openmpt_module_get_current_row(mod);
      if (shouldReportPosition) {
        order = lib._openmpt_module_get_current_order(mod);
        posSec = lib._openmpt_module_get_position_seconds(mod);
        bpm = lib._openmpt_module_get_current_estimated_bpm(mod);
        speed = lib._openmpt_module_get_current_speed(mod);
        this._lastOrder = order;
        this._lastBpm = bpm;
        this._lastSpeed = speed;

        if (typeof lib._openmpt_module_get_time_at_position === 'function') {
          const t0 = lib._openmpt_module_get_time_at_position(mod, order, rowInt);
          let t1 = lib._openmpt_module_get_time_at_position(mod, order, rowInt + 1);
          // End of pattern: try first row of next order
          if (!(t1 > t0)) {
            t1 = lib._openmpt_module_get_time_at_position(mod, order + 1, 0);
          }
          if (t1 > t0 && Number.isFinite(t0) && Number.isFinite(t1) && Number.isFinite(posSec)) {
            const frac = (posSec - t0) / (t1 - t0);
            if (Number.isFinite(frac)) {
              rowFraction = rowInt + Math.min(0.999, Math.max(0, frac));
            } else {
              rowFraction = rowInt;
            }
          } else {
            rowFraction = rowInt;
          }
        } else {
          rowFraction = rowInt;
        }
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
    }
    const leftSrc = this._leftHeapView;
    const rightSrc = this._rightHeapView;
    for (let i = 0; i < samplesWritten; i++) {
      outL[i] = leftSrc[i];
      outR[i] = rightSrc[i];
    }

    // Copy first 128 samples into oscilloscope ring buffer
    if (this.oscView) {
      const framesToCopy = Math.min(128, samplesWritten);
      for (let i = 0; i < framesToCopy; i++) {
        this.oscView[this.oscWritePtr] = outL[i];
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
          this.pcmAccumL[this.pcmAccumCount + i] = outL[src + i];
          this.pcmAccumR[this.pcmAccumCount + i] = outR[src + i];
        }
        this.pcmAccumCount += toCopy;
        src += toCopy;

        if (this.pcmAccumCount >= this.pcmChunkSize) {
          const interleaved = this.pcmInterleaved;
          for (let i = 0; i < this.pcmChunkSize; i++) {
            interleaved[i * 2]     = this.pcmAccumL[i];
            interleaved[i * 2 + 1] = this.pcmAccumR[i];
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
    // get_time_at_position / per-channel VU / IIR band split are the dominant
    // extra cost on multi-channel XM at pattern starts when run every quantum.
    if (shouldReportPosition) {
      const numCh = lib._openmpt_module_get_num_channels(mod);
      const n = Math.min(numCh, 32);
      let channelVU = this._channelVuArr;
      if (channelVU.length !== n) {
        channelVU = new Array(n);
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
      // Row went backwards (63→0): a pattern boundary / wrap.
      const wrapped = this._prevRowInt >= 0 && rowInt < this._prevRowInt;

      this._diagQuanta++;
      this._diagSumMs += elapsedMs;
      if (elapsedMs > this._diagMaxMs) this._diagMaxMs = elapsedMs;
      if (elapsedMs > budgetMs) this._diagOverruns++;
      if (wrapped) {
        this._diagWrapCount++;
        if (elapsedMs > this._diagWrapMaxMs) this._diagWrapMaxMs = elapsedMs;
        if (elapsedMs > budgetMs) this._diagWrapOverruns++;
      }

      if (shouldReportPosition && this._diagQuanta > 0) {
        this.port.postMessage({
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
          audioTime,
        });
        this._resetAudioDiag();
      }
    }
    if (shouldReportPosition || diagOn) {
      this._prevRowInt = rowInt;
    }

    return true;
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
log('[OpenMPTWorklet] Script loaded, processor registered');
