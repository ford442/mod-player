/**
 * OpenMPT AudioWorklet Processor
 * Renders libopenmpt audio directly inside the AudioWorklet process() callback.
 *
 * ⚠️  WARNING: This file MUST call _openmpt_module_read_float_stereo() in process().
 *     Do NOT replace this with a stub/test tone. A previous stub (commit 499a862)
 *     broke all MOD playback by generating a 440Hz sine wave instead of rendering
 *     the loaded module. See docs/WORKLET_AUDIO_BUG.md for the full post-mortem.
 *
 * Critical setup for AudioWorklet compatibility:
 * 1. globalThis.libopenmpt pre-configuration so Emscripten locateFile resolves WASM correctly
 * 2. Dynamic import() of libopenmpt-audioworklet.js (avoids addModule({ type:'module' }) requirement)
 *
 * NOTE: Chrome 116+ provides setTimeout in AudioWorkletGlobalScope. The old microtask-based
 * polyfill (Promise.resolve().then) was harmful because it ignored delay arguments,
 * causing Emscripten timer callbacks to fire immediately and corrupt runtime state.
 */

const DEBUG = true;
function log(...args) { if (DEBUG) console.log('[Worklet]', ...args); }
function error(...args) { console.error('[Worklet]', ...args); }

// ── Emscripten Module pre-configuration ───────────────────────────
// libopenmpt-audioworklet.js checks "typeof libopenmpt" and uses that
// object as its Module. We pre-seed locateFile so it can find the
// co-located .wasm file (or wasm2js stub) regardless of subdirectory deploys.
try {
  const workletBaseUrl = new URL('.', import.meta.url).href;
  globalThis.libopenmpt = {
    locateFile: (path) => workletBaseUrl + path,
  };
  log('WASM base URL resolved to:', workletBaseUrl);
} catch (e) {
  // Fallback: hope the wasm file is at the same path as the page
  globalThis.libopenmpt = {};
  error('Failed to resolve worklet base URL, WASM load may fail:', e);
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
    this.isPlaying = true; // default to playing for backward compat
    this.hasEnded = false; // prevent spamming 'ended' messages

    // 60 Hz position reports
    this.positionReportInterval = 1 / 60;
    this.lastPositionReportTime = 0;

    log('Constructor called, sampleRate:', sampleRate);

    this.port.onmessage = async (e) => {
      const { type, moduleData } = e.data;
      log('Received message:', type || '(no-type)', 'bytes:', moduleData?.byteLength);

      if (type === 'load' && moduleData) {
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
      } else if (!type && moduleData) {
        // Legacy fallback
        await this.loadModule(moduleData);
      }
    };

    // Fire-and-forget WASM bootstrap
    this._libInitPromise = this._initLib();
  }

  // ── WASM bootstrap ────────────────────────────────────────────────
  async _initLib() {
    try {
      log('Dynamic-importing libopenmpt-audioworklet.js…');

      const mod = await import('./libopenmpt-audioworklet.js');
      let lib = mod.default;

      if (!lib) throw new Error('dynamic import returned falsy default export');

      // Wait for the async WASM (or wasm2js) runtime to complete initialisation
      if (!lib._openmpt_module_create_from_memory) {
        log('Waiting for WASM onRuntimeInitialized…');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('WASM init timeout after 20 s')), 20000
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

      this.lib = lib;
      this.isLibReady = true;
      log('libopenmpt ready ✅');
    } catch (err) {
      error('Failed to initialise libopenmpt:', err);
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
      log('Loading MOD into libopenmpt:', moduleData.byteLength, 'bytes');

      // Tear down previous module
      if (this.modulePtr) {
        lib._openmpt_module_destroy(this.modulePtr);
        this.modulePtr = 0;
      }
      if (this.leftBufPtr) { lib._free(this.leftBufPtr); this.leftBufPtr = 0; }
      if (this.rightBufPtr) { lib._free(this.rightBufPtr); this.rightBufPtr = 0; }

      // Copy file data into WASM heap
      const filePtr = lib._malloc(moduleData.byteLength);
      if (!filePtr) throw new Error('_malloc returned 0 – out of WASM heap memory');

      lib.HEAPU8.set(new Uint8Array(moduleData), filePtr);
      this.modulePtr = lib._openmpt_module_create_from_memory(
        filePtr, moduleData.byteLength, 0, 0, 0
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

    const samplesWritten = this.lib._openmpt_module_read_float_stereo(
      this.modulePtr,
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
    outL.set(new Float32Array(this.lib.HEAPF32.buffer, this.leftBufPtr, samplesWritten));
    outR.set(new Float32Array(this.lib.HEAPF32.buffer, this.rightBufPtr, samplesWritten));

    // Silence remainder if libopenmpt rendered fewer frames
    if (samplesWritten < numSamples) {
      outL.fill(0, samplesWritten);
      outR.fill(0, samplesWritten);
    }

    // Position reporting at ~60 Hz
    if (currentTime - this.lastPositionReportTime >= this.positionReportInterval) {
      const order = this.lib._openmpt_module_get_current_order(this.modulePtr);
      const row = this.lib._openmpt_module_get_current_row(this.modulePtr);
      const posSec = this.lib._openmpt_module_get_position_seconds(this.modulePtr);
      const bpm = this.lib._openmpt_module_get_current_estimated_bpm(this.modulePtr);

      this.port.postMessage({
        type: 'position',
        order,
        row,
        positionSeconds: posSec,
        bpm,
        workletTime: currentTime,
      });
      this.lastPositionReportTime = currentTime;
    }

    return true;
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
log('[OpenMPTWorklet] Script loaded, processor registered');
