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

    this.port.onmessage = async (e) => {
      const { moduleData, type } = e.data;

      if (type === 'load' && moduleData) {
        await this.loadModule(moduleData);
      } else if (type === "seek") {
        if (this.modulePtr && this.lib) {
           this.lib._openmpt_module_set_position_order_row(this.modulePtr, e.data.order, e.data.row);
        }
      } else if (moduleData && !type) {
        // Fallback for just sending data
        await this.loadModule(moduleData);
      }
    };
  }

  async loadModule(moduleData) {
    try {
      // Ensure Module is initialized
      let lib = Module;
      if (!lib._openmpt_module_create_from_memory) {
         await new Promise(resolve => {
            if (lib.calledRun && lib.onRuntimeInitialized) {
               // Already ran?
               resolve();
            } else {
               lib.onRuntimeInitialized = resolve;
            }
         });
      }
      this.lib = lib;

      // Cleanup old module
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

      // Create new module
      const filePtr = lib._malloc(moduleData.byteLength);
      lib.HEAPU8.set(new Uint8Array(moduleData), filePtr);
      
      this.modulePtr = lib._openmpt_module_create_from_memory(filePtr, moduleData.byteLength, 0, 0, 0);
      lib._free(filePtr);

      if (this.modulePtr === 0) {
        this.port.postMessage({ type: 'error', message: 'Failed to create module' });
        return;
      }

      // Alloc buffers
      this.leftBufPtr = lib._malloc(4 * this.maxFrames);
      this.rightBufPtr = lib._malloc(4 * this.maxFrames);

      // Set render params
      lib._openmpt_module_set_render_param(this.modulePtr, 0, 0); // Use read() value
      lib._openmpt_module_set_render_param(this.modulePtr, 2, 4); // Interpolation best

      this.port.postMessage({ type: 'loaded' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: err.toString() });
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.modulePtr || !this.lib) return true;

    const output = outputs[0];
    const outputLeft = output[0];
    const outputRight = output[1];
    if (!outputLeft || !outputRight) return true;

    const numSamples = outputLeft.length;
    // Use the AudioContext sampleRate (global in AudioWorkletScope)
    const sr = sampleRate;

    const samplesWritten = this.lib._openmpt_module_read_float_stereo(
      this.modulePtr,
      sr,
      numSamples,
      this.leftBufPtr,
      this.rightBufPtr
    );

    if (samplesWritten === 0) {
      this.port.postMessage({ type: 'ended' });
      return true;
    }

    const leftView = new Float32Array(this.lib.HEAPF32.buffer, this.leftBufPtr, samplesWritten);
    const rightView = new Float32Array(this.lib.HEAPF32.buffer, this.rightBufPtr, samplesWritten);

    // Copy to output
    outputLeft.set(leftView);
    outputRight.set(rightView);

    // Fill remaining with silence if needed (shouldn't happen if samplesWritten == numSamples)
    if (samplesWritten < numSamples) {
       outputLeft.fill(0, samplesWritten);
       outputRight.fill(0, samplesWritten);
    }

    // Position reporting
    if (currentTime - this.lastPositionReportTime > 0.05) { // ~20fps
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
