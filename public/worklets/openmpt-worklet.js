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

// ── setTimeout/clearTimeout polyfill for AudioWorkletGlobalScope ──────
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

const DEBUG = true;
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

    // ── Project-M PCM accumulation ─────────────────────────────────
    // Accumulate audio-clock-accurate stereo PCM blocks and emit them
    // to the main thread for Project-M visualization.  Doing this here
    // (inside process()) avoids the jitter and background-tab throttling
    // of the requestAnimationFrame path and provides authentic PCM
    // directly from the WASM render callback.
    this.pcmChunkSize = 512;   // target block size (~11.6 ms @ 44100 Hz)
    this.pcmAccumL = new Float32Array(this.pcmChunkSize);
    this.pcmAccumR = new Float32Array(this.pcmChunkSize);
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
        this.port.postMessage({ type: 'error', message: 'WASM library init timeout' });
      }, 30000);
    }

    this.port.onmessage = async (e) => {
      const { type, moduleData } = e.data;
      log('Received message:', type || '(no-type)', 'bytes:', moduleData?.byteLength);

      if (type === 'initLib') {
        await this._handleInitLib(e.data);
      } else if (type === 'load' && moduleData) {
        this.hasEnded = false;
        await this.loadModule(moduleData);
      } else if (type === 'play') {
        this.isPlaying = true;
        this.hasEnded = false;
        log('Playback started');
      } else if (type === 'pause') {
        this.isPlaying = false;
        log('Playback paused');
      } else if (type === 'seek') {
        this.hasEnded = false;
        if (this.modulePtr && this.lib) {
          this.lib._openmpt_module_set_position_order_row(
            this.modulePtr, e.data.order, e.data.row
          );
          log('Seek executed:', e.data.order, e.data.row);
        } else {
          error('Cannot seek: module not loaded');
        }
        this.port.postMessage({ type: 'seekAck' });
      } else if (type === 'getOscBuffer') {
        if (this.oscBuffer) {
          this.port.postMessage({ type: 'oscBuffer', buffer: this.oscBuffer });
        }
      } else if (!type && moduleData) {
        await this.loadModule(moduleData);
      }
    };

    try {
      this.oscBuffer = new SharedArrayBuffer(2048 * 4);
    } catch (e) {
      this.oscBuffer = null;
    }
    this.oscView = this.oscBuffer ? new Float32Array(this.oscBuffer) : null;
    this.oscWritePtr = 0;
    if (this.oscBuffer) {
      this.port.postMessage({ type: 'oscBuffer', buffer: this.oscBuffer });
    }
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
      this.port.postMessage({ type: 'error', message: 'Lib init failed: ' + String(err) });
    }
  }

  // ── Module loading ─────────────────────────────────────────────────
  async loadModule(moduleData) {
    log('loadModule: awaiting WASM ready…');

    await this._libInitPromise;

    if (!this.isLibReady) {
      error('WASM library never became ready');
      this.port.postMessage({ type: 'error', message: 'WASM library init timeout' });
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

      // Best-quality windowed-sinc interpolation
      lib._openmpt_module_set_render_param(this.modulePtr, 2, 8);

      log('Module loaded ✅ ptr=', this.modulePtr);
      this.port.postMessage({ type: 'loaded' });
    } catch (err) {
      error('loadModule error:', err);
      this.port.postMessage({ type: 'error', message: String(err) });
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
    // Capture state *before* read_float_stereo so the row matches the first
    // sample of this quantum. Tag with AudioWorklet currentTime (audio
    // timeline of that first sample). Main thread predicts to
    // currentTime − outputLatency for speaker-aligned visuals.
    const lib = this.lib;
    const mod = this.modulePtr;
    const audioTime = currentTime;
    const order = lib._openmpt_module_get_current_order(mod);
    const rowInt = lib._openmpt_module_get_current_row(mod);
    const posSec = lib._openmpt_module_get_position_seconds(mod);
    const bpm = lib._openmpt_module_get_current_estimated_bpm(mod);
    const speed = lib._openmpt_module_get_current_speed(mod);

    let rowFraction = rowInt;
    if (typeof lib._openmpt_module_get_time_at_position === 'function') {
      const t0 = lib._openmpt_module_get_time_at_position(mod, order, rowInt);
      let t1 = lib._openmpt_module_get_time_at_position(mod, order, rowInt + 1);
      // End of pattern: try first row of next order
      if (!(t1 > t0) && typeof lib._openmpt_module_get_time_at_position === 'function') {
        t1 = lib._openmpt_module_get_time_at_position(mod, order + 1, 0);
      }
      if (t1 > t0 && Number.isFinite(t0) && Number.isFinite(t1) && Number.isFinite(posSec)) {
        const frac = (posSec - t0) / (t1 - t0);
        if (Number.isFinite(frac)) {
          rowFraction = rowInt + Math.min(0.999, Math.max(0, frac));
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
        this.port.postMessage({ type: 'ended' });
      }
      return true;
    }
    this.hasEnded = false;

    // Zero-copy view into WASM heap
    outL.set(new Float32Array(lib.HEAPF32.buffer, this.leftBufPtr, samplesWritten));
    outR.set(new Float32Array(lib.HEAPF32.buffer, this.rightBufPtr, samplesWritten));

    // Copy first 128 samples into oscilloscope ring buffer
    if (this.oscView && outL) {
      const framesToCopy = Math.min(128, outL.length);
      for (let i = 0; i < framesToCopy; i++) {
        this.oscView[this.oscWritePtr] = outL[i];
        this.oscWritePtr = (this.oscWritePtr + 1) & 2047; // fast modulo 2048
      }
    }

    // Silence remainder if libopenmpt rendered fewer frames
    if (samplesWritten < numSamples) {
      outL.fill(0, samplesWritten);
      outR.fill(0, samplesWritten);
    }

    // ── Project-M PCM accumulation ─────────────────────────────────
    // Accumulate rendered stereo samples into a fixed-size block and emit
    // a 'projectm-pcm' message when the block is full.  This runs at audio
    // callback rate (no RAF jitter) and delivers authentic PCM straight from
    // the WASM renderer, solving the timing issues of the legacy
    // requestAnimationFrame + AnalyserNode.getFloatTimeDomainData() path.
    {
      let src = 0;
      while (src < samplesWritten) {
        const space = this.pcmChunkSize - this.pcmAccumCount;
        const toCopy = Math.min(samplesWritten - src, space);
        this.pcmAccumL.set(outL.subarray(src, src + toCopy), this.pcmAccumCount);
        this.pcmAccumR.set(outR.subarray(src, src + toCopy), this.pcmAccumCount);
        this.pcmAccumCount += toCopy;
        src += toCopy;

        if (this.pcmAccumCount >= this.pcmChunkSize) {
          // Build interleaved stereo Float32Array: L0,R0, L1,R1, …
          // The element-by-element loop is the only way to interleave two
          // typed arrays with different strides; for 512 samples this is
          // ~1024 writes per block (~88 blocks/s @ 44100 Hz) — negligible
          // overhead relative to the WASM render call above.
          const interleaved = new Float32Array(this.pcmChunkSize * 2);
          for (let i = 0; i < this.pcmChunkSize; i++) {
            interleaved[i * 2]     = this.pcmAccumL[i];
            interleaved[i * 2 + 1] = this.pcmAccumR[i];
          }
          // `sampleRate` is a read-only global in AudioWorkletGlobalScope
          // (spec §4.3), like `currentTime`.  No `this.` prefix needed.
          this.port.postMessage(
            { type: 'projectm-pcm', buffer: interleaved, channels: 2,
              sampleRate, samplesPerChannel: this.pcmChunkSize },
            [interleaved.buffer]
          );
          this.pcmAccumCount = 0;
        }
      }
    }

    // Position every quantum — main thread interpolates with audio clock.
    // VU is sampled post-render (reflects the quantum just produced).
    {
      const numCh = lib._openmpt_module_get_num_channels(mod);
      const channelVU = [];
      for (let i = 0; i < Math.min(numCh, 32); i++) {
        channelVU.push(lib._openmpt_module_get_current_channel_vu_mono(mod, i));
      }

      this._lastReportedRowInt = rowInt;
      this.port.postMessage({
        type: 'position',
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
    }

    return true;
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
log('[OpenMPTWorklet] Script loaded, processor registered');
