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
    ctlSetText: "ctlSetText",
    /** Hands a consumed projectm-pcm buffer back to the worklet's allocation pool. */
    returnPcmBuffer: "returnPcmBuffer",
    /** Shared position/VU ring (audio-worklet/positionRing.ts); replaces `position` messages when sent. */
    setPositionRing: "setPositionRing",
    /** Hands the worklet its end of the create-worker channel (#513). */
    attachCreatePort: "attachCreatePort"
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
    audioDiag: "audioDiag",
    /** The worklet's libopenmpt is the shared-memory playback heap: memory + a stack for the create worker (#513). */
    createHeap: "createHeap"
  };
  var ALL_MAIN_TO_WORKLET_TYPES = Object.values(MAIN_TO_WORKLET);
  var ALL_WORKLET_TO_MAIN_TYPES = Object.values(WORKLET_TO_MAIN);
  var MAX_VU_CHANNELS = 64;
  var OSC_BUFFER_MIN_BYTES = (2048 + 16) * 4;
  var req = (kind) => ({ kind });
  var opt = (kind) => ({ kind, optional: true });
  var MAIN_TO_WORKLET_SPEC = {
    [MAIN_TO_WORKLET.initLib]: {
      fields: { scriptText: req("nonEmptyString"), wasmBytes: opt("arrayBuffer") }
    },
    [MAIN_TO_WORKLET.load]: { fields: { moduleData: req("modulePayload") } },
    [MAIN_TO_WORKLET.play]: { fields: {} },
    [MAIN_TO_WORKLET.pause]: { fields: {} },
    [MAIN_TO_WORKLET.seek]: {
      fields: { order: req("nonNegInt"), row: req("nonNegInt"), timestamp: opt("finite") }
    },
    [MAIN_TO_WORKLET.getOscBuffer]: { fields: {} },
    [MAIN_TO_WORKLET.setAudioLite]: { fields: { lite: req("boolean") } },
    [MAIN_TO_WORKLET.setProjectmPcm]: { fields: { enabled: req("boolean") } },
    [MAIN_TO_WORKLET.setAudioDiag]: { fields: { enabled: req("boolean") } },
    [MAIN_TO_WORKLET.setChannelMute]: { fields: { channel: req("nonNegInt"), muted: req("boolean") } },
    [MAIN_TO_WORKLET.setRenderParam]: { fields: { param: req("finite"), value: req("finite") } },
    [MAIN_TO_WORKLET.ctlSetText]: { fields: { key: req("string"), value: req("string") } },
    [MAIN_TO_WORKLET.returnPcmBuffer]: { fields: { buffer: req("float32Array") } },
    [MAIN_TO_WORKLET.setPositionRing]: { fields: { buffer: req("sharedArrayBuffer") } },
    [MAIN_TO_WORKLET.attachCreatePort]: { fields: { port: req("messagePort") } }
  };
  var LEGACY_LOAD_SPEC = { fields: { moduleData: req("modulePayload") } };
  var WORKLET_TO_MAIN_SPEC = {
    [WORKLET_TO_MAIN.position]: {
      fields: {
        order: req("nonNegInt"),
        row: req("nonNegInt"),
        rowFraction: opt("finite"),
        positionSeconds: req("finite"),
        bpm: req("finite"),
        speed: opt("finite"),
        /** Audio timeline of the pre-render snapshot (preferred name). */
        audioTime: opt("finite"),
        /** Alias of audioTime kept for older handlers. */
        workletTime: opt("finite"),
        samplesWritten: opt("nonNegInt"),
        sampleRate: opt("finite"),
        channelVU: { kind: "finiteArray", optional: true, maxLength: MAX_VU_CHANNELS }
      }
    },
    [WORKLET_TO_MAIN.loaded]: { fields: {} },
    [WORKLET_TO_MAIN.ended]: { fields: {} },
    [WORKLET_TO_MAIN.seekAck]: { fields: {} },
    [WORKLET_TO_MAIN.error]: {
      fields: {
        message: req("string"),
        /** process() caught a wasm trap and silenced output: the node needs a restart. */
        fatal: opt("boolean")
      }
    },
    [WORKLET_TO_MAIN.oscBuffer]: {
      fields: { buffer: { kind: "sharedArrayBuffer", minBytes: OSC_BUFFER_MIN_BYTES } }
    },
    [WORKLET_TO_MAIN.needData]: { fields: {}, passthrough: true },
    [WORKLET_TO_MAIN.starvation]: { fields: {}, passthrough: true },
    [WORKLET_TO_MAIN.projectmPcm]: {
      fields: {
        buffer: req("float32Array"),
        channels: req("pcmChannels"),
        sampleRate: opt("finite"),
        samplesPerChannel: opt("nonNegInt")
      }
    },
    [WORKLET_TO_MAIN.audioDiag]: {
      fields: {
        budgetMs: req("finite"),
        quanta: req("nonNegInt"),
        avgProcessMs: req("finite"),
        maxProcessMs: req("finite"),
        overruns: req("nonNegInt"),
        wraps: req("nonNegInt"),
        wrapMaxProcessMs: req("finite"),
        wrapOverruns: req("nonNegInt"),
        order: req("nonNegInt"),
        row: req("nonNegInt"),
        audioTime: opt("finite"),
        /** Quantum that set maxProcessMs in this window (not necessarily the wrap). */
        slowMs: opt("finite"),
        slowOrder: opt("nonNegInt"),
        slowRow: opt("nonNegInt"),
        pcmEnabled: opt("boolean"),
        audioLite: opt("boolean"),
        /** First wrap windows' maxProcessMs (session; wrap-0 vs wrap-N). */
        wrapProcessMs: opt("finiteArray"),
        /** Worst scheduling gap in this window (late callback), ms. */
        maxCallbackGapMs: opt("finite"),
        heapBytes: opt("nonNegInt"),
        heapMoves: opt("nonNegInt"),
        playingChannels: opt("nonNegInt"),
        /** Worst wall-clock gap between two process() calls (ms) — a blocked audio thread shows here. */
        maxWallGapMs: opt("finite"),
        /** Worst audio-thread time spent bringing in a module this window (ms). */
        loadBlockMs: opt("finite"),
        /** Loads are created on the create worker, not this thread (#513). */
        createThread: opt("boolean")
      }
    },
    [WORKLET_TO_MAIN.createHeap]: {
      fields: {
        memory: req("wasmMemory"),
        /** Stable per heap (per AudioWorkletGlobalScope); the Memory object itself is a new wrapper per message. */
        heapId: req("positiveInt"),
        stackLow: req("nonNegInt"),
        stackSize: req("nonNegInt")
      }
    }
  };

  // audio-worklet/workletProtocolGuard.ts
  function compileFields(spec) {
    return Object.keys(spec.fields).map((name) => ({ name, spec: spec.fields[name] }));
  }
  function compileTable(table) {
    const out = {};
    for (const type of Object.keys(table)) out[type] = compileFields(table[type]);
    return out;
  }
  var MAIN_TO_WORKLET_FIELDS = compileTable(MAIN_TO_WORKLET_SPEC);
  var WORKLET_TO_MAIN_FIELDS = compileTable(WORKLET_TO_MAIN_SPEC);
  var LEGACY_LOAD_FIELDS = compileFields(LEGACY_LOAD_SPEC);
  var hasOwn = Object.prototype.hasOwnProperty;
  var lastError = "";
  function protocolError() {
    return lastError;
  }
  function isFinite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function fieldValueMatches(spec, value) {
    switch (spec.kind) {
      case "nonNegInt":
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      case "finite":
        return isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "string":
        return typeof value === "string";
      case "nonEmptyString":
        return typeof value === "string" && value.length > 0;
      case "arrayBuffer":
        return value instanceof ArrayBuffer;
      case "modulePayload":
        return value instanceof ArrayBuffer || value instanceof Uint8Array;
      case "float32Array":
        return value instanceof Float32Array;
      case "sharedArrayBuffer":
        return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer && (spec.minBytes === void 0 || value.byteLength >= spec.minBytes);
      case "finiteArray": {
        if (!Array.isArray(value)) return false;
        if (spec.maxLength !== void 0 && value.length > spec.maxLength) return false;
        for (let i = 0; i < value.length; i++) {
          if (!isFinite(value[i])) return false;
        }
        return true;
      }
      case "pcmChannels":
        return value === 1 || value === 2;
      case "positiveInt":
        return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
      case "messagePort":
        return value !== null && typeof value === "object" && typeof value.postMessage === "function";
      case "wasmMemory": {
        const WasmMemory = globalThis.WebAssembly?.Memory;
        return typeof WasmMemory === "function" && value instanceof WasmMemory;
      }
      default: {
        const exhaustive = spec.kind;
        return exhaustive;
      }
    }
  }
  function checkFields(fields, data) {
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const value = data[field.name];
      if (value === void 0) {
        if (field.spec.optional) continue;
        lastError = `missing field "${field.name}"`;
        return false;
      }
      if (!fieldValueMatches(field.spec, value)) {
        lastError = `field "${field.name}" is not a valid ${field.spec.kind}`;
        return false;
      }
    }
    return true;
  }
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function validate(table, data, direction) {
    if (!isRecord(data)) {
      lastError = "message is not an object";
      return false;
    }
    const type = data.type;
    if (typeof type !== "string" || !hasOwn.call(table, type)) {
      lastError = `unknown ${direction} message type: ${String(type)}`;
      return false;
    }
    return checkFields(table[type], data);
  }
  function validateMainToWorklet(data) {
    if (isRecord(data) && data.type === void 0) {
      return checkFields(LEGACY_LOAD_FIELDS, data) ? data : null;
    }
    return validate(MAIN_TO_WORKLET_FIELDS, data, "main\u2192worklet") ? data : null;
  }

  // audio-worklet/positionRing.ts
  var POSITION_RING_SLOTS = 8;
  var H_WRITE_COUNT = 1;
  var SEQ_BASE = 2;
  var HEADER_INTS = SEQ_BASE + POSITION_RING_SLOTS;
  var F_INDEX = 0;
  var F_ORDER = 1;
  var F_ROW = 2;
  var F_ROW_FRACTION = 3;
  var F_POSITION_SECONDS = 4;
  var F_BPM = 5;
  var F_SPEED = 6;
  var F_AUDIO_TIME = 7;
  var F_SAMPLES_WRITTEN = 8;
  var F_SAMPLE_RATE = 9;
  var F_NUM_VU = 10;
  var SLOT_FIELDS = 12;
  var FIELDS_BYTE_OFFSET = Math.ceil(HEADER_INTS * 4 / 8) * 8;
  var VU_BYTE_OFFSET = FIELDS_BYTE_OFFSET + POSITION_RING_SLOTS * SLOT_FIELDS * 8;
  var POSITION_RING_BYTES = VU_BYTE_OFFSET + POSITION_RING_SLOTS * MAX_VU_CHANNELS * 4;
  function views(buffer) {
    if (buffer.byteLength < POSITION_RING_BYTES) {
      throw new RangeError(`position ring needs ${POSITION_RING_BYTES} bytes, got ${buffer.byteLength}`);
    }
    return {
      header: new Int32Array(buffer, 0, HEADER_INTS),
      fields: new Float64Array(buffer, FIELDS_BYTE_OFFSET, POSITION_RING_SLOTS * SLOT_FIELDS),
      vu: new Float32Array(buffer, VU_BYTE_OFFSET, POSITION_RING_SLOTS * MAX_VU_CHANNELS)
    };
  }

  // audio-worklet/positionRingWriter.ts
  var PositionRingWriter = class {
    /** Fill `fields[fieldOffset + F_*]` and `vu[vuOffset + channel]` between begin() and commit(). */
    fields;
    vu;
    fieldOffset = 0;
    vuOffset = 0;
    header;
    writeCount = 0;
    slot = 0;
    seq = 0;
    constructor(buffer) {
      const v = views(buffer);
      this.header = v.header;
      this.fields = v.fields;
      this.vu = v.vu;
      this.writeCount = Atomics.load(this.header, H_WRITE_COUNT);
    }
    /** Claim the next slot (marks it odd = being written). */
    begin() {
      this.slot = this.writeCount & POSITION_RING_SLOTS - 1;
      this.seq = Atomics.load(this.header, SEQ_BASE + this.slot);
      Atomics.store(this.header, SEQ_BASE + this.slot, this.seq + 1 | 0);
      this.fieldOffset = this.slot * SLOT_FIELDS;
      this.vuOffset = this.slot * MAX_VU_CHANNELS;
      this.fields[this.fieldOffset + F_INDEX] = this.writeCount;
    }
    /** Publish the slot filled since begin(). */
    commit() {
      Atomics.store(this.header, SEQ_BASE + this.slot, this.seq + 2 | 0);
      this.writeCount = this.writeCount + 1 | 0;
      Atomics.store(this.header, H_WRITE_COUNT, this.writeCount);
    }
  };

  // audio-worklet/libSingleton.ts
  function hasWasmBytes(wasmBytes) {
    return wasmBytes != null && wasmBytes.byteLength > 0;
  }
  function hasWasmMagic(wasmBytes) {
    const head = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes, 0, Math.min(4, wasmBytes.byteLength));
    return head.length >= 4 && head[0] === 0 && head[1] === 97 && head[2] === 115 && head[3] === 109;
  }
  function isReady(lib) {
    return lib != null && typeof lib._openmpt_module_create_from_memory2 === "function";
  }
  async function ensureSharedLib(holder, scriptText, wasmBytes, deps) {
    const existing = holder.__openmptWorkletLib;
    if (existing && isReady(existing)) {
      deps.log?.("Reusing shared libopenmpt instance");
      return existing;
    }
    if (!holder.__openmptWorkletLibInitPromise) {
      holder.__openmptWorkletLibInitPromise = (async () => {
        if (!scriptText) {
          throw new Error("initLib missing scriptText");
        }
        if (!hasWasmBytes(wasmBytes)) {
          throw new Error("initLib missing wasmBytes (libopenmpt-worklet.wasm) \u2014 the JS engine is real WebAssembly");
        }
        if (!hasWasmMagic(wasmBytes)) {
          throw new Error("initLib wasmBytes is not a WebAssembly binary (missing \\0asm magic)");
        }
        const lib = await deps.bootstrap(scriptText, wasmBytes);
        holder.__openmptWorkletLib = lib;
        return lib;
      })();
    }
    return holder.__openmptWorkletLibInitPromise;
  }

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

  // audio-worklet/createThreadProtocol.ts
  var CREATE_PORT = {
    /** worker → worklet: a created module; the worklet now owns it. */
    staged: "staged",
    /** worker → worklet: create failed; the worklet reports it like an in-worklet load error. */
    failed: "failed",
    /** worklet → worker: a module the worklet no longer renders; the worker owns and frees it. */
    destroy: "destroy"
  };
  var CREATE_THREAD_STACK_BYTES = 1 << 20;
  var CREATE_THREAD_STACK_ALIGN = 16;
  var CREATE_FAILED_MESSAGE = "openmpt_module_create_from_memory returned 0 (invalid format?)";
  var STAGED_SWAP_TIMEOUT_MS = 100;
  function alignCreateThreadStack(rawPtr, size) {
    const a = CREATE_THREAD_STACK_ALIGN;
    return {
      stackLow: Math.ceil(rawPtr / a) * a,
      stackSize: Math.floor(size / a) * a
    };
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
  function isObject(v) {
    return v != null && typeof v === "object";
  }
  function isNonNegInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
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
  var PCM_BUFFER_POOL_MAX = 4;
  var LOAD_FADE_MS = 10;
  function log(...args) {
    if (DEBUG) console.log("[Worklet]", ...args);
  }
  function error(...args) {
    console.error("[Worklet]", ...args);
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
  function utf8Bytes(str) {
    const escaped = unescape(encodeURIComponent(str));
    const bytes = new Uint8Array(escaped.length);
    for (let i = 0; i < escaped.length; i++) bytes[i] = escaped.charCodeAt(i);
    return bytes;
  }
  function heapBuffer(lib) {
    return lib.wasmMemory ? lib.wasmMemory.buffer : lib.HEAPU8.buffer;
  }
  function heapU8(lib) {
    const buf = heapBuffer(lib);
    return lib.HEAPU8.buffer === buf ? lib.HEAPU8 : new Uint8Array(buf);
  }
  function allocUtf8CString(lib, str) {
    const bytes = utf8Bytes(str);
    const ptr = lib._malloc(bytes.byteLength + 1);
    if (!ptr) throw new Error("_malloc returned 0 for ctl string");
    const heap = heapU8(lib);
    heap.set(bytes, ptr);
    heap[ptr + bytes.byteLength] = 0;
    return ptr;
  }
  function isPlaybackHeap(lib) {
    return typeof SharedArrayBuffer !== "undefined" && lib.wasmMemory != null && lib.wasmMemory.buffer instanceof SharedArrayBuffer && typeof lib._emscripten_wasm_worker_initialize === "function";
  }
  function ensureCreateThreadStack(lib) {
    const existing = globalThis.__openmptCreateThreadStack;
    if (existing) return existing;
    const raw = lib._malloc(CREATE_THREAD_STACK_BYTES + CREATE_THREAD_STACK_ALIGN);
    if (!raw) return null;
    const heapId = 1 + Math.floor(Math.random() * 2147483646);
    const stack = { heapId, ...alignCreateThreadStack(raw, CREATE_THREAD_STACK_BYTES) };
    globalThis.__openmptCreateThreadStack = stack;
    return stack;
  }
  async function bootstrapLibOpenMPT(scriptText, wasmBytes) {
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
    return lib;
  }
  function ensureSharedLibOpenMPT(scriptText, wasmBytes) {
    return ensureSharedLib(globalThis, scriptText, wasmBytes, {
      bootstrap: bootstrapLibOpenMPT,
      log
    });
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
      this.faulted = false;
      this._fadeGain = 1;
      this._fadeTarget = 1;
      this._fadeStep = 1 / Math.max(1, Math.round(sampleRate * LOAD_FADE_MS / 1e3));
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
      this.pcmBufferPool = [];
      this._createPort = null;
      this._stagedPtr = 0;
      this._stagedTimer = null;
      this._diagMaxWallGapMs = 0;
      this._diagLoadBlockMs = 0;
      this._lastProcessWall = -1;
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
        const msg = validateMainToWorklet(e.data);
        if (!msg) {
          error("Rejected main\u2192worklet message:", protocolError(), e.data);
          return;
        }
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
          if (this._stagedPtr) this._adoptStaged();
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
          this._lastProcessWall = -1;
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
        } else if (type === MT.returnPcmBuffer) {
          if (msg.buffer.length === this.pcmChunkSize * 2 && this.pcmBufferPool.length < PCM_BUFFER_POOL_MAX) {
            this.pcmBufferPool.push(msg.buffer);
          }
        } else if (type === MT.setPositionRing) {
          this._positionRing = new PositionRingWriter(msg.buffer);
          log("Position reports go through the shared ring");
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
        } else if (type === MT.attachCreatePort) {
          this._attachCreatePort(msg.port);
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
      this._positionRing = null;
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
      this._diagMaxWallGapMs = 0;
      this._diagLoadBlockMs = 0;
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
    /** Per-sample ramp toward `_fadeTarget` (see loadModule()'s output fade). */
    _applyLoadFade(outL, outR, count) {
      let gain = this._fadeGain;
      const target = this._fadeTarget;
      const step = this._fadeStep;
      for (let i = 0; i < count; i++) {
        if (gain < target) gain = Math.min(target, gain + step);
        else if (gain > target) gain = Math.max(target, gain - step);
        outL[i] = outL[i] * gain;
        outR[i] = outR[i] * gain;
      }
      this._fadeGain = gain;
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
        this._announceCreateHeap(lib);
      } catch (err) {
        error("Failed to initialise libopenmpt:", err);
        this._rejectLib(err);
        this.port.postMessage({ type: WT.error, message: "Lib init failed: " + String(err) });
      }
    }
    // ── Create worker (#513) ────────────────────────────────────────────
    /**
     * On the shared playback heap, tell the main thread how a create worker can join it. The render
     * buffers are allocated here, once, so swapping a staged module in never mallocs.
     */
    _announceCreateHeap(lib) {
      if (!isPlaybackHeap(lib) || !lib.wasmMemory) return;
      const stack = ensureCreateThreadStack(lib);
      if (!stack) return;
      this._ensureRenderBuffers(lib);
      this.port.postMessage({
        type: WT.createHeap,
        memory: lib.wasmMemory,
        heapId: stack.heapId,
        stackLow: stack.stackLow,
        stackSize: stack.stackSize
      });
    }
    _ensureRenderBuffers(lib) {
      if (!this.leftBufPtr) this.leftBufPtr = lib._malloc(4 * this.maxFrames);
      if (!this.rightBufPtr) this.rightBufPtr = lib._malloc(4 * this.maxFrames);
      this._heapBuffer = null;
    }
    _attachCreatePort(port) {
      if (this._createPort && this._createPort !== port) this._createPort.onmessage = null;
      this._createPort = port;
      port.onmessage = (e) => {
        this._onCreatePortMessage(e.data);
      };
    }
    _onCreatePortMessage(data) {
      if (!isObject(data)) return;
      if (data.type === CREATE_PORT.staged && isNonNegInt(data.modulePtr) && data.modulePtr > 0) {
        if (this._stagedPtr) this._retireModule(this._stagedPtr);
        this._stagedPtr = data.modulePtr;
        this.hasEnded = false;
        if (!this.modulePtr || !this.isPlaying || this.faulted) {
          this._adoptStaged();
          return;
        }
        this._fadeTarget = 0;
        if (this._stagedTimer != null) clearTimeout(this._stagedTimer);
        this._stagedTimer = setTimeout(() => {
          this._stagedTimer = null;
          if (this._stagedPtr) this._adoptStaged();
        }, STAGED_SWAP_TIMEOUT_MS);
      } else if (data.type === CREATE_PORT.failed) {
        const message = typeof data.message === "string" ? data.message : CREATE_FAILED_MESSAGE;
        error("create worker: load failed:", message);
        this.port.postMessage({ type: WT.error, message });
      }
    }
    /**
     * Swap the staged module in. Runs on the audio thread (from process() at the end of the fade,
     * or from a message handler): pointer swap, render-param setup, two postMessages — no create,
     * no destroy, no malloc. The replaced module goes back to the create worker to be freed.
     */
    _adoptStaged() {
      const lib = this.lib;
      const next = this._stagedPtr;
      if (!lib || !next) return;
      const diagStart = this._audioDiag ? this._diagNow() : 0;
      this._stagedPtr = 0;
      if (this._stagedTimer != null) {
        clearTimeout(this._stagedTimer);
        this._stagedTimer = null;
      }
      const previous = this.modulePtr;
      this.modulePtr = next;
      this.faulted = false;
      this.hasEnded = false;
      this._fracRowInt = -1;
      this._rowStartPosSec = 0;
      this._configureLoadedModule(lib, next);
      this._fadeTarget = 1;
      if (previous) this._retireModule(previous);
      if (this._audioDiag) this._noteLoadBlock(this._diagNow() - diagStart);
      log("Staged module swapped in \u2705 ptr=", next);
      this.port.postMessage({ type: WT.loaded });
    }
    /** Give a module this node no longer renders back to the create worker (its free runs there). */
    _retireModule(modulePtr) {
      if (this._createPort) {
        this._createPort.postMessage({ type: CREATE_PORT.destroy, modulePtr });
        return;
      }
      try {
        this.lib?._openmpt_module_destroy(modulePtr);
      } catch (err) {
        error("destroy of retired module failed (ignored):", err);
      }
    }
    /** Per-module setup after any create: create resets render params, and heavy modules go lite. */
    _configureLoadedModule(lib, modulePtr) {
      lib._openmpt_module_set_render_param(
        modulePtr,
        OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
        this._interpolationLength
      );
      const numCh = lib._openmpt_module_get_num_channels(modulePtr);
      if (numCh > 16 && !this._audioLiteExplicit) {
        this._audioLite = true;
        log("Auto audio-lite for", numCh, "channels");
      }
    }
    _noteLoadBlock(ms) {
      if (ms > this._diagLoadBlockMs) this._diagLoadBlockMs = ms;
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
      this._fadeTarget = 0;
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, LOAD_FADE_MS);
      });
      const diagStart = this._audioDiag ? this._diagNow() : 0;
      try {
        const lib = this.lib;
        const bytes = moduleBytesFromPayload(moduleData);
        log("Loading module into libopenmpt:", bytes.byteLength, "bytes");
        if (this._stagedPtr) {
          this._retireModule(this._stagedPtr);
          this._stagedPtr = 0;
        }
        if (this.modulePtr) {
          try {
            lib._openmpt_module_destroy(this.modulePtr);
          } catch (destroyErr) {
            error("destroy of previous module ptr failed (ignored, reloading anyway):", destroyErr);
          }
          this.modulePtr = 0;
        }
        this.faulted = false;
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
        heapU8(lib).set(bytes, filePtr);
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
        this._configureLoadedModule(lib, this.modulePtr);
        log("Module loaded \u2705 ptr=", this.modulePtr);
        this.port.postMessage({ type: WT.loaded });
      } catch (err) {
        error("loadModule error:", err);
        this.port.postMessage({ type: WT.error, message: String(err) });
      } finally {
        if (this._audioDiag) this._noteLoadBlock(this._diagNow() - diagStart);
        this._fadeTarget = 1;
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
      if (this.faulted) {
        outL.fill(0);
        outR.fill(0);
        return true;
      }
      try {
        this._renderQuantum(outL, outR);
      } catch (err) {
        outL.fill(0);
        outR.fill(0);
        this.faulted = true;
        error("process() trapped \u2014 silencing output and reporting fault:", err);
        this.port.postMessage({
          type: WT.error,
          message: "PROCESS_FAULT: " + String(err instanceof Error ? err.message : err),
          fatal: true
        });
      }
      return true;
    }
    /** The actual per-quantum render + reporting work. Isolated so process() can wrap it in one try/catch. */
    _renderQuantum(outL, outR) {
      if (!this.modulePtr || !this.lib) return;
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
        if (this._stagedPtr) {
          this._adoptStaged();
          return;
        }
        if (!this.hasEnded) {
          this.hasEnded = true;
          this.port.postMessage({ type: WT.ended });
        }
        return;
      }
      this.hasEnded = false;
      const heapBuf = heapBuffer(lib);
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
      if (this._fadeGain !== this._fadeTarget) {
        this._applyLoadFade(outL, outR, samplesWritten);
      }
      if (this._stagedPtr && this._fadeGain === 0) {
        this._adoptStaged();
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
            const payload = this.pcmBufferPool.pop() ?? new Float32Array(this.pcmChunkSize * 2);
            payload.set(interleaved);
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
        const n = Math.min(numCh, MAX_VU_CHANNELS);
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
        const ring = this._positionRing;
        if (ring) {
          ring.begin();
          const f = ring.fields;
          const o = ring.fieldOffset;
          f[o + F_ORDER] = order;
          f[o + F_ROW] = rowInt;
          f[o + F_ROW_FRACTION] = rowFraction;
          f[o + F_POSITION_SECONDS] = posSec;
          f[o + F_BPM] = bpm;
          f[o + F_SPEED] = speed;
          f[o + F_AUDIO_TIME] = audioTime;
          f[o + F_SAMPLES_WRITTEN] = samplesWritten;
          f[o + F_SAMPLE_RATE] = sampleRate;
          f[o + F_NUM_VU] = n;
          const vu = ring.vu;
          const vo = ring.vuOffset;
          for (let i = 0; i < n; i++) vu[vo + i] = channelVU[i];
          ring.commit();
        } else {
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
        }
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
        if (this._lastProcessWall >= 0) {
          const wallGapMs = diagStart - this._lastProcessWall;
          if (wallGapMs > this._diagMaxWallGapMs) this._diagMaxWallGapMs = wallGapMs;
        }
        this._lastProcessWall = diagStart;
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
            heapMoves: this._heapMoves,
            maxWallGapMs: this._diagMaxWallGapMs,
            loadBlockMs: this._diagLoadBlockMs,
            createThread: this._createPort != null
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
  };
  registerProcessor("openmpt-processor", XMPlayerProcessor);
  log("[OpenMPTWorklet] Script loaded, processor registered");
})();
