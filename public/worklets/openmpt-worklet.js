// generated — do not edit.
// Source: audio-worklet/js/openmpt-processor.ts
// Regenerate with: npm run build:js-worklet
"use strict";
(() => {
  // audio-worklet/workletProtocolConstants.ts
  var MAIN_TO_WORKLET = {
    initLib: "initLib",
    load: "load",
    play: "play",
    pause: "pause",
    seek: "seek",
    getOscBuffer: "getOscBuffer",
    setAudioLite: "setAudioLite",
    setProjectmPcm: "setProjectmPcm",
    setAudioDiag: "setAudioDiag",
    setChannelMute: "setChannelMute",
    setRenderParam: "setRenderParam",
    ctlSetText: "ctlSetText"
  };
  var WORKLET_TO_MAIN = {
    position: "position",
    loaded: "loaded",
    ended: "ended",
    seekAck: "seekAck",
    error: "error",
    oscBuffer: "oscBuffer",
    needData: "needData",
    starvation: "starvation",
    projectmPcm: "projectm-pcm",
    audioDiag: "audioDiag"
  };
  var ALL_MAIN_TO_WORKLET_TYPES = Object.values(MAIN_TO_WORKLET);
  var ALL_WORKLET_TO_MAIN_TYPES = Object.values(WORKLET_TO_MAIN);

  // audio-worklet/libRuntimeReady.ts
  function waitForRuntimeInitialized(lib, timeoutMs, what = "WASM") {
    return new Promise((resolve, reject) => {
      if (lib.calledRun) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error(`${what} onRuntimeInitialized timeout (${timeoutMs} ms)`)),
        timeoutMs
      );
      const prevInit = lib.onRuntimeInitialized;
      lib.onRuntimeInitialized = () => {
        clearTimeout(timer);
        if (typeof prevInit === "function") prevInit();
        resolve();
      };
      const prevAbort = lib.onAbort;
      lib.onAbort = (reason) => {
        clearTimeout(timer);
        if (typeof prevAbort === "function") prevAbort(reason);
        reject(new Error(`${what} aborted during init: ${String(reason)}`));
      };
    });
  }

  // audio-worklet/js/openmpt-processor.ts
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto) {
    globalThis.crypto = {
      getRandomValues: function(array) {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
        return array;
      }
    };
  }
  var sharedCrypto = globalThis.crypto;
  if (typeof self !== "undefined" && (!self.crypto || !self.crypto.getRandomValues) && sharedCrypto) {
    self.crypto = sharedCrypto;
  }
  var MT = MAIN_TO_WORKLET;
  var WT = WORKLET_TO_MAIN;
  if (typeof globalThis.setTimeout !== "function") {
    const _timers = /* @__PURE__ */ new Map();
    let _nextTimerId = 1;
    globalThis.__workletTimers = _timers;
    globalThis.setTimeout = function(fn, delayMs) {
      const id = _nextTimerId++;
      const deadline = (typeof currentTime === "number" ? currentTime : 0) + (delayMs || 0) / 1e3;
      _timers.set(id, { fn, deadline });
      return id;
    };
    globalThis.clearTimeout = function(id) {
      if (id != null) _timers.delete(id);
    };
  }
  var DEBUG = false;
  var WORKLET_DEV = false;
  var OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3;
  var DEFAULT_INTERPOLATION_LENGTH = 8;
  function log(...args) {
    if (DEBUG) console.log("[Worklet]", ...args);
  }
  function error(...args) {
    console.error("[Worklet]", ...args);
  }
  function isObject(v) {
    return v != null && typeof v === "object";
  }
  function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function isNonNegInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
  }
  function isModulePayload(v) {
    return v instanceof ArrayBuffer || v instanceof Uint8Array;
  }
  function parseMainToWorkletMessage(data) {
    if (!isObject(data)) {
      return { ok: false, error: "message is not an object" };
    }
    const type = data.type;
    if (type === MAIN_TO_WORKLET.initLib) {
      if (typeof data.scriptText !== "string" || data.scriptText.length === 0) {
        return { ok: false, error: "initLib requires scriptText" };
      }
      if (data.wasmBytes != null && !(data.wasmBytes instanceof ArrayBuffer)) {
        return { ok: false, error: "wasmBytes must be ArrayBuffer" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.load) {
      if (!isModulePayload(data.moduleData)) {
        return { ok: false, error: "load requires moduleData" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.play || type === MAIN_TO_WORKLET.pause || type === MAIN_TO_WORKLET.getOscBuffer) {
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.seek) {
      if (!isNonNegInt(data.order) || !isNonNegInt(data.row)) {
        return { ok: false, error: "seek requires order/row" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.setAudioLite) {
      if (typeof data.lite !== "boolean") {
        return { ok: false, error: "setAudioLite requires lite boolean" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.setProjectmPcm || type === MAIN_TO_WORKLET.setAudioDiag) {
      if (typeof data.enabled !== "boolean") {
        return { ok: false, error: String(type) + " requires enabled boolean" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.setChannelMute) {
      if (!isNonNegInt(data.channel) || typeof data.muted !== "boolean") {
        return { ok: false, error: "setChannelMute requires channel/muted" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.setRenderParam) {
      if (!isFiniteNumber(data.param) || !isFiniteNumber(data.value)) {
        return { ok: false, error: "setRenderParam requires param/value" };
      }
      return { ok: true, message: data };
    }
    if (type === MAIN_TO_WORKLET.ctlSetText) {
      if (typeof data.key !== "string" || typeof data.value !== "string") {
        return { ok: false, error: "ctlSetText requires key/value strings" };
      }
      return { ok: true, message: data };
    }
    if (type == null && isModulePayload(data.moduleData)) {
      return { ok: true, message: data };
    }
    return { ok: false, error: "unknown main\u2192worklet message type: " + String(type) };
  }
  function moduleBytesFromPayload(moduleData) {
    if (moduleData instanceof Uint8Array) {
      if (moduleData.byteOffset === 0 && moduleData.byteLength === moduleData.buffer.byteLength) {
        return moduleData;
      }
      return moduleData.slice();
    }
    return new Uint8Array(moduleData);
  }
  function hasWasmBytes(wasmBytes) {
    return wasmBytes != null && wasmBytes.byteLength > 0;
  }
  function hasWasmMagic(wasmBytes) {
    const head = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes, 0, Math.min(4, wasmBytes.byteLength));
    return head.length >= 4 && head[0] === 0 && head[1] === 97 && head[2] === 115 && head[3] === 109;
  }
  function utf8Bytes(str) {
    const escaped = unescape(encodeURIComponent(str));
    const bytes = new Uint8Array(escaped.length);
    for (let i = 0; i < escaped.length; i++) bytes[i] = escaped.charCodeAt(i);
    return bytes;
  }
  function allocUtf8CString(lib, str) {
    const bytes = utf8Bytes(str);
    const ptr = lib._malloc(bytes.byteLength + 1);
    if (!ptr) throw new Error("_malloc returned 0 for ctl string");
    lib.HEAPU8.set(bytes, ptr);
    lib.HEAPU8[ptr + bytes.byteLength] = 0;
    return ptr;
  }
  async function ensureSharedLibOpenMPT(scriptText, wasmBytes) {
    const existing = globalThis.__openmptWorkletLib;
    if (existing && typeof existing._openmpt_module_create_from_memory2 === "function") {
      log("Reusing shared libopenmpt instance");
      return existing;
    }
    if (!globalThis.__openmptWorkletLibInitPromise) {
      globalThis.__openmptWorkletLibInitPromise = (async () => {
        if (!scriptText) {
          throw new Error("initLib missing scriptText");
        }
        if (!hasWasmBytes(wasmBytes)) {
          throw new Error("initLib missing wasmBytes (libopenmpt-worklet.wasm) \u2014 the JS engine is real WebAssembly");
        }
        if (!hasWasmMagic(wasmBytes)) {
          throw new Error("initLib wasmBytes is not a WebAssembly binary (missing \\0asm magic)");
        }
        log(
          "Evaluating libopenmpt-worklet.js (",
          scriptText.length,
          " chars, wasmBytes:",
          wasmBytes.byteLength,
          ")\u2026"
        );
        if (typeof globalThis.performance === "undefined") {
          globalThis.performance = { now: () => currentTime * 1e3 };
        }
        if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
          globalThis.crypto = {
            getRandomValues: function(array) {
              for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256);
              }
              return array;
            }
          };
        }
        globalThis.libopenmpt = { noInitialRun: true, wasmBinary: wasmBytes };
        const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, "");
        const fn = new Function(cleanedScript);
        fn.call(globalThis);
        const lib = globalThis.libopenmpt;
        if (!lib || typeof lib !== "object") {
          throw new Error("globalThis.libopenmpt not set after script evaluation");
        }
        log("Waiting for WASM onRuntimeInitialized\u2026");
        await waitForRuntimeInitialized(lib, 25e3);
        globalThis.__openmptWorkletLib = lib;
        return lib;
      })();
    }
    return globalThis.__openmptWorkletLibInitPromise;
  }
  var OSC_SAMPLE_COUNT = 2048;
  var AUDIO_REACTIVE_FLOATS = 16;
  var AUDIO_SAB_BYTES = (OSC_SAMPLE_COUNT + AUDIO_REACTIVE_FLOATS) * 4;
  var AR_BASS = 0;
  var AR_MID = 1;
  var AR_HIGH = 2;
  var AR_AMPLITUDE = 3;
  var AR_BEAT = 4;
  var AR_PEAK_L = 5;
  var AR_PEAK_R = 6;
  var AR_RMS_L = 7;
  var AR_RMS_R = 8;
  var AR_FLAGS = 9;
  var AR_FLAG_LITE = 1;
  function onePoleAlpha(cutoffHz, sr) {
    return 1 - Math.exp(-2 * Math.PI * cutoffHz / sr);
  }
  var XMPlayerProcessor = class extends AudioWorkletProcessor {
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
      this._lastReportedRowInt = -1;
      this._leftHeapView = null;
      this._rightHeapView = null;
      this._heapBuffer = null;
      this._projectmPcmEnabled = false;
      this.pcmChunkSize = 512;
      this.pcmAccumL = new Float32Array(this.pcmChunkSize);
      this.pcmAccumR = new Float32Array(this.pcmChunkSize);
      this.pcmInterleaved = new Float32Array(this.pcmChunkSize * 2);
      this.pcmAccumCount = 0;
      log("Constructor called, sampleRate:", sampleRate);
      const sharedLib = globalThis.__openmptWorkletLib;
      if (sharedLib && typeof sharedLib._openmpt_module_create_from_memory2 === "function") {
        this.lib = sharedLib;
        this.isLibReady = true;
        this._libInitPromise = Promise.resolve();
        this._resolveLib = () => {
        };
        this._rejectLib = () => {
        };
        this._libInitTimeout = null;
        log("Attached to pre-initialised shared libopenmpt");
      } else {
        this._libInitPromise = new Promise((resolve, reject) => {
          this._resolveLib = resolve;
          this._rejectLib = reject;
        });
        this._libInitPromise.catch(() => {
        });
        this._libInitTimeout = setTimeout(() => {
          this._rejectLib(new Error("WASM init timeout: initLib message never received"));
          this.port.postMessage({ type: WT.error, message: "WASM library init timeout" });
        }, 3e4);
      }
      this.port.onmessage = async (e) => {
        const parsed = parseMainToWorkletMessage(e.data);
        if (!parsed.ok) {
          error("Rejected main\u2192worklet message:", parsed.error, e.data);
          return;
        }
        const msg = parsed.message;
        const type = msg.type;
        log("Received message:", type || "(legacy-load)");
        if (type === MT.initLib) {
          await this._handleInitLib(msg);
        } else if (type === MT.load) {
          this.hasEnded = false;
          await this.loadModule(msg.moduleData);
        } else if (type === MT.play) {
          this.isPlaying = true;
          this.hasEnded = false;
          log("Playback started");
        } else if (type === MT.pause) {
          this.isPlaying = false;
          log("Playback paused");
        } else if (type === MT.seek) {
          this.hasEnded = false;
          this._fracRowInt = -1;
          this._rowStartPosSec = 0;
          if (this.modulePtr && this.lib) {
            this.lib._openmpt_module_set_position_order_row(
              this.modulePtr,
              msg.order,
              msg.row
            );
            log("Seek executed:", msg.order, msg.row);
          } else {
            error("Cannot seek: module not loaded");
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
          if (WORKLET_DEV) {
            throw new Error("setChannelMute not implemented for JS engine yet (TODO #416)");
          }
        } else if (type === MT.setRenderParam) {
          if (msg.param === OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH) {
            this._interpolationLength = msg.value;
          }
          if (this.modulePtr && this.lib && typeof this.lib._openmpt_module_set_render_param === "function") {
            this.lib._openmpt_module_set_render_param(this.modulePtr, msg.param, msg.value);
          }
        } else if (type === MT.ctlSetText) {
          const lib = this.lib;
          if (this.modulePtr && lib && typeof lib._openmpt_module_ctl_set_text === "function") {
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
      this.audioMetaView = this.oscBuffer ? new Float32Array(this.oscBuffer, OSC_SAMPLE_COUNT * 4, AUDIO_REACTIVE_FLOATS) : null;
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
    _resetAudioDiag() {
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
    _diagNow() {
      if (typeof Date !== "undefined" && typeof Date.now === "function") {
        return Date.now();
      }
      return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0;
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
        const smooth2 = 0.82;
        this._smoothBass = this._smoothBass * smooth2 + coarse * (1 - smooth2);
        this._smoothMid = this._smoothMid * smooth2 + coarse * 0.55 * (1 - smooth2);
        this._smoothHigh = this._smoothHigh * smooth2 + coarse * 0.3 * (1 - smooth2);
        meta[AR_BASS] = this._smoothBass;
        meta[AR_MID] = this._smoothMid;
        meta[AR_HIGH] = this._smoothHigh;
        meta[AR_AMPLITUDE] = coarse;
        const beat2 = coarse > this._prevBass * 1.25 && coarse > 0.12 ? 1 : this._beatDecay * 0.86;
        this._beatDecay = beat2;
        this._prevBass = coarse;
        meta[AR_BEAT] = beat2;
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
      meta[AR_HIGH] = Math.min(1, this._smoothHigh * 4);
      meta[AR_AMPLITUDE] = amplitude;
      meta[AR_PEAK_L] = peakL;
      meta[AR_PEAK_R] = peakR;
      meta[AR_RMS_L] = rmsL;
      meta[AR_RMS_R] = rmsR;
      meta[AR_FLAGS] = 0;
      const bassNorm = meta[AR_BASS];
      const beat = bassNorm > this._prevBass * 1.28 && bassNorm > 0.14 ? 1 : this._beatDecay * 0.87;
      this._beatDecay = beat;
      this._prevBass = bassNorm;
      meta[AR_BEAT] = beat;
    }
    // ── libopenmpt bootstrap via main-thread-fetched assets ────────────
    // AudioWorklet classic scripts cannot use import() or importScripts(), and
    // this scope has no fetch(). Main thread fetches libopenmpt-worklet.js and
    // libopenmpt-worklet.wasm and posts both here. We evaluate the JS via
    // new Function() and seed Module.wasmBinary so Emscripten instantiates the
    // bytes directly instead of trying to fetch its sibling .wasm.
    async _handleInitLib({ scriptText, wasmBytes }) {
      try {
        if (this._libInitTimeout != null) clearTimeout(this._libInitTimeout);
        const lib = await ensureSharedLibOpenMPT(scriptText, wasmBytes);
        this.lib = lib;
        this.isLibReady = true;
        this._resolveLib();
        log("libopenmpt ready \u2705");
      } catch (err) {
        error("Failed to initialise libopenmpt:", err);
        this._rejectLib(err);
        this.port.postMessage({ type: WT.error, message: "Lib init failed: " + String(err) });
      }
    }
    // ── Module loading ─────────────────────────────────────────────────
    async loadModule(moduleData) {
      log("loadModule: awaiting WASM ready\u2026");
      try {
        await this._libInitPromise;
      } catch {
      }
      if (!this.isLibReady || !this.lib) {
        error("WASM library never became ready");
        this.port.postMessage({ type: WT.error, message: "WASM library init timeout" });
        return;
      }
      try {
        const lib = this.lib;
        const bytes = moduleBytesFromPayload(moduleData);
        log("Loading module into libopenmpt:", bytes.byteLength, "bytes");
        if (this.modulePtr) {
          lib._openmpt_module_destroy(this.modulePtr);
          this.modulePtr = 0;
        }
        if (this.leftBufPtr) {
          lib._free(this.leftBufPtr);
          this.leftBufPtr = 0;
        }
        if (this.rightBufPtr) {
          lib._free(this.rightBufPtr);
          this.rightBufPtr = 0;
        }
        const filePtr = lib._malloc(bytes.byteLength);
        if (!filePtr) throw new Error("_malloc returned 0 \u2013 out of WASM heap memory");
        lib.HEAPU8.set(bytes, filePtr);
        const create = lib._openmpt_module_create_from_memory2 ?? lib._openmpt_module_create_from_memory;
        if (!create) throw new Error("libopenmpt exports neither create_from_memory2 nor create_from_memory");
        this.modulePtr = create(
          filePtr,
          bytes.byteLength,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        );
        lib._free(filePtr);
        if (this.modulePtr === 0) {
          throw new Error("openmpt_module_create_from_memory returned 0 (invalid format?)");
        }
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
          this._interpolationLength
        );
        const numCh = lib._openmpt_module_get_num_channels(this.modulePtr);
        if (numCh > 16 && !this._audioLiteExplicit) {
          this._audioLite = true;
          log("Auto audio-lite for", numCh, "channels");
        }
        log("Module loaded \u2705 ptr=", this.modulePtr);
        this.port.postMessage({ type: WT.loaded });
      } catch (err) {
        error("loadModule error:", err);
        this.port.postMessage({ type: WT.error, message: String(err) });
      }
    }
    // ── Audio process loop ─────────────────────────────────────────────
    process(_inputs, outputs, _parameters) {
      const timers = globalThis.__workletTimers;
      if (timers && timers.size > 0) {
        const now = currentTime;
        for (const [id, t] of timers) {
          if (t.deadline <= now) {
            timers.delete(id);
            try {
              t.fn();
            } catch (e) {
              console.error("[Worklet] timer error", e);
            }
          }
        }
      }
      const out = outputs[0];
      const outL = out?.[0];
      const outR = out?.[1];
      if (!outL || !outR) return true;
      if (!this.modulePtr || !this.lib || !this.isPlaying) {
        outL.fill(0);
        outR.fill(0);
        return true;
      }
      const numSamples = outL.length;
      const framesToRead = Math.min(numSamples, this.maxFrames);
      const lib = this.lib;
      const mod = this.modulePtr;
      const diagOn = this._audioDiag;
      const diagStart = diagOn ? this._diagNow() : 0;
      const audioTime = currentTime;
      const shouldReportPosition = currentTime - this.lastPositionReportTime >= this.positionReportInterval;
      let order = this._lastOrder;
      let rowInt = this._prevRowInt;
      let posSec = 0;
      let bpm = this._lastBpm;
      let speed = this._lastSpeed;
      let rowFraction = rowInt;
      let playingChannels = -1;
      if (shouldReportPosition) {
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
        const rowsPerSec = Math.max(0.25, Math.max(bpm, 1) / 60 * 4);
        const frac = (posSec - this._rowStartPosSec) * rowsPerSec;
        rowFraction = rowInt + Math.min(0.999, Math.max(0, Number.isFinite(frac) ? frac : 0));
        if (diagOn && typeof lib._openmpt_module_get_current_playing_channels === "function") {
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
      const heapBuf = lib.HEAPF32.buffer;
      if (this._heapBuffer !== heapBuf) {
        this._heapBuffer = heapBuf;
        this._leftHeapView = new Float32Array(heapBuf, this.leftBufPtr, this.maxFrames);
        this._rightHeapView = new Float32Array(heapBuf, this.rightBufPtr, this.maxFrames);
        this._heapMoves++;
      }
      const leftSrc = this._leftHeapView;
      const rightSrc = this._rightHeapView;
      for (let i = 0; i < samplesWritten; i++) {
        outL[i] = leftSrc[i];
        outR[i] = rightSrc[i];
      }
      if (this.oscView) {
        const framesToCopy = Math.min(128, samplesWritten);
        for (let i = 0; i < framesToCopy; i++) {
          this.oscView[this.oscWritePtr] = outL[i];
          this.oscWritePtr = this.oscWritePtr + 1 & OSC_SAMPLE_COUNT - 1;
        }
      }
      if (samplesWritten < numSamples) {
        outL.fill(0, samplesWritten);
        outR.fill(0, samplesWritten);
      }
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
              interleaved[i * 2] = this.pcmAccumL[i];
              interleaved[i * 2 + 1] = this.pcmAccumR[i];
            }
            const payload = interleaved.slice();
            this.port.postMessage(
              {
                type: WT.projectmPcm,
                buffer: payload,
                channels: 2,
                sampleRate,
                samplesPerChannel: this.pcmChunkSize
              },
              [payload.buffer]
            );
            this.pcmAccumCount = 0;
          }
        }
      }
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
          channelVU
        });
        this.lastPositionReportTime = currentTime;
      }
      if (diagOn) {
        const elapsedMs = this._diagNow() - diagStart;
        const budgetMs = numSamples / sampleRate * 1e3;
        if (this._lastProcessTime >= 0) {
          const gapMs = (audioTime - this._lastProcessTime) * 1e3 - budgetMs;
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
        const wrapped = shouldReportPosition && this._prevRowInt >= 0 && rowInt < this._prevRowInt;
        if (wrapped) {
          this._diagWrapCount++;
          if (elapsedMs > this._diagWrapMaxMs) this._diagWrapMaxMs = elapsedMs;
          if (elapsedMs > budgetMs) this._diagWrapOverruns++;
          if (this._diagSessionWrapProcessMs.length < 16) {
            this._diagSessionWrapProcessMs.push(this._diagMaxMs);
          }
        }
        if (shouldReportPosition && this._diagQuanta > 0) {
          const diagMsg = {
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
            heapMoves: this._heapMoves
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
  };
  registerProcessor("openmpt-processor", XMPlayerProcessor);
  log("[OpenMPTWorklet] Script loaded, processor registered");
})();
