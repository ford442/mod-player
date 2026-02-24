// AudioWorkletProcessor for libopenmpt
// Debug logging enabled for troubleshooting
const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log('[Worklet]', ...args);
}
function error(...args) {
  console.error('[Worklet]', ...args);
}

import Module from './libopenmpt-audioworklet.js';

class XMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.modulePtr = 0;
    this.leftBufPtr = 0;
    this.rightBufPtr = 0;
    this.maxFrames = 4096;
    this.lib = null;
    this.lastPositionReportTime = 0;
    this.isLibReady = false;

    log('Constructor called');

    this.port.onmessage = async (e) => {
      const { moduleData, type } = e.data;
      log('Received message:', type || 'no-type', 'data length:', moduleData?.byteLength);

      if (type === 'load' && moduleData) {
        await this.loadModule(moduleData);
      } else if (type === "seek") {
        log('Seek request:', e.data.order, e.data.row);
        if (this.modulePtr && this.lib) {
           this.lib._openmpt_module_set_position_order_row(this.modulePtr, e.data.order, e.data.row);
        } else {
          error('Cannot seek: module not loaded');
        }
      } else if (moduleData && !type) {
        // Fallback for just sending data
        log('Fallback: loading module without type');
        await this.loadModule(moduleData);
      }
    };

    // Start libopenmpt initialization immediately
    this.initLib();
  }

  async initLib() {
    try {
      log('Initializing libopenmpt...');
      let lib = Module;
      
      if (!lib._openmpt_module_create_from_memory) {
        log('Waiting for WASM runtime initialization...');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WASM initialization timeout'));
          }, 10000);
          
          if (lib.calledRun) {
            clearTimeout(timeout);
            log('WASM already initialized (calledRun=true)');
            resolve();
          } else {
            lib.onRuntimeInitialized = () => {
              clearTimeout(timeout);
              log('WASM runtime initialized via callback');
              resolve();
            };
          }
        });
      } else {
        log('WASM already initialized (functions available)');
      }
      
      this.lib = lib;
      this.isLibReady = true;
      log('libopenmpt initialized successfully');
    } catch (err) {
      error('Failed to initialize libopenmpt:', err);
      this.port.postMessage({ type: 'error', message: 'Lib init failed: ' + err.toString() });
    }
  }

  async loadModule(moduleData) {
    log('loadModule called with', moduleData.byteLength, 'bytes');
    
    if (!this.isLibReady) {
      log('Library not ready, waiting for initialization...');
      // Wait a bit for initialization
      let retries = 50;
      while (!this.isLibReady && retries > 0) {
        await new Promise(r => setTimeout(r, 100));
        retries--;
      }
      if (!this.isLibReady) {
        error('Library failed to initialize in time');
        this.port.postMessage({ type: 'error', message: 'Library initialization timeout' });
        return;
      }
    }

    try {
      const lib = this.lib;
      log('Loading module into libopenmpt...');

      // Cleanup old module
      if (this.modulePtr) {
        log('Destroying previous module');
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

      // Create new module
      log('Allocating', moduleData.byteLength, 'bytes for module');
      const filePtr = lib._malloc(moduleData.byteLength);
      if (!filePtr) {
        throw new Error('Failed to allocate memory for module');
      }
      
      lib.HEAPU8.set(new Uint8Array(moduleData), filePtr);
      log('Memory copied, creating module...');
      
      this.modulePtr = lib._openmpt_module_create_from_memory(filePtr, moduleData.byteLength, 0, 0, 0);
      lib._free(filePtr);

      if (this.modulePtr === 0) {
        error('Failed to create module (returned 0)');
        this.port.postMessage({ type: 'error', message: 'Failed to create module - invalid format?' });
        return;
      }
      log('Module created successfully, ptr:', this.modulePtr);

      // Alloc buffers
      this.leftBufPtr = lib._malloc(4 * this.maxFrames);
      this.rightBufPtr = lib._malloc(4 * this.maxFrames);
      log('Audio buffers allocated:', this.leftBufPtr, this.rightBufPtr);

      // Set render params
      lib._openmpt_module_set_render_param(this.modulePtr, 0, 0); // Use read() value
      lib._openmpt_module_set_render_param(this.modulePtr, 2, 4); // Interpolation best

      log('Module loaded successfully!');
      this.port.postMessage({ type: 'loaded' });
    } catch (err) {
      error('Error in loadModule:', err);
      this.port.postMessage({ type: 'error', message: err.toString() });
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.modulePtr || !this.lib) {
      // Output silence if no module loaded
      const output = outputs[0];
      if (output && output[0]) output[0].fill(0);
      if (output && output[1]) output[1].fill(0);
      return true;
    }

    const output = outputs[0];
    const outputLeft = output[0];
    const outputRight = output[1];
    if (!outputLeft || !outputRight) {
      error('No output buffers available');
      return true;
    }

    const numSamples = outputLeft.length;
    const sr = sampleRate;

    // Ensure we don't exceed maxFrames
    const framesToRender = Math.min(numSamples, this.maxFrames);

    const samplesWritten = this.lib._openmpt_module_read_float_stereo(
      this.modulePtr,
      sr,
      framesToRender,
      this.leftBufPtr,
      this.rightBufPtr
    );

    if (samplesWritten === 0) {
      // Module ended
      outputLeft.fill(0);
      outputRight.fill(0);
      this.port.postMessage({ type: 'ended' });
      return true;
    }

    // Copy rendered audio to output
    const leftView = new Float32Array(this.lib.HEAPF32.buffer, this.leftBufPtr, samplesWritten);
    const rightView = new Float32Array(this.lib.HEAPF32.buffer, this.rightBufPtr, samplesWritten);

    outputLeft.set(leftView);
    outputRight.set(rightView);

    // Fill remaining with silence if needed
    if (samplesWritten < numSamples) {
       outputLeft.fill(0, samplesWritten);
       outputRight.fill(0, samplesWritten);
    }

    // Position reporting (throttled to ~20fps)
    if (currentTime - this.lastPositionReportTime > 0.05) {
       const order = this.lib._openmpt_module_get_current_order(this.modulePtr);
       const row = this.lib._openmpt_module_get_current_row(this.modulePtr);
       const positionSeconds = this.lib._openmpt_module_get_position_seconds(this.modulePtr);

       this.port.postMessage({
         type: 'position',
         order,
         row,
         positionSeconds
       });
       this.lastPositionReportTime = currentTime;
    }

    return true;
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
