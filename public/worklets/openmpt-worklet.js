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
 * and libopenmpt.wasm and sends them via postMessage({ type:'initLib', ... }).
 * The worklet evaluates the JS via new Function() with wasmBinary pre-seeded.
 *
 * NOTE: Chrome 116+ provides setTimeout in AudioWorkletGlobalScope.
 */

const DEBUG = true;
function log(...args) { if (DEBUG) console.log('[Worklet]', ...args); }
function error(...args) { console.error('[Worklet]', ...args); }

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

    log('Constructor called, sampleRate:', sampleRate);

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

  // ── WASM bootstrap via main-thread-fetched assets ──────────────────
  // AudioWorklet classic scripts cannot use import() or importScripts().
  // The main thread fetches libopenmpt-audioworklet.js + libopenmpt.wasm
  // and sends them here. We evaluate the JS via new Function() with
  // wasmBinary pre-seeded so Emscripten skips its own network fetch.
  async _handleInitLib({ scriptText, wasmBytes }) {
    try {
      clearTimeout(this._libInitTimeout);

      if (!scriptText || !wasmBytes) {
        throw new Error('initLib missing scriptText or wasmBytes');
      }

      log('Evaluating libopenmpt-audioworklet.js (', scriptText.length, ' chars)…');

      // Pre-configure the Emscripten Module object. Emscripten checks
      // "typeof libopenmpt !== 'undefined'" and merges with this object.
      globalThis.libopenmpt = {
        wasmBinary: wasmBytes,  // avoids a second network fetch for the .wasm
        noInitialRun: true,
      };

      // Evaluate the Emscripten-generated script in the global scope.
      // new Function() runs with globalThis as its outer scope, so the script
      // sees (and modifies) globalThis.libopenmpt via normal variable lookup.
      const fn = new Function(scriptText); // eslint-disable-line no-new-func
      fn.call(globalThis);

      let lib = globalThis.libopenmpt;
      if (!lib || typeof lib !== 'object') {
        throw new Error('globalThis.libopenmpt not set after script evaluation');
      }

      if (!lib._openmpt_module_create_from_memory) {
        log('Waiting for WASM onRuntimeInitialized…');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('WASM onRuntimeInitialized timeout')), 25000
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
