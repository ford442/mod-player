// openmpt-worklet.js
// AudioWorkletProcessor for libopenmpt with ring buffer support
// Uses dynamic import() for broad Chrome 116+ compatibility.

const DEBUG = false;
function log(...args) { if (DEBUG) console.log('[Worklet]', ...args); }
function error(...args) { console.error('[Worklet]', ...args); }

// Ring Buffer Implementation
class AudioRingBuffer {
  constructor(capacitySeconds, sampleRate, numChannels) {
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this.capacity = Math.floor(capacitySeconds * sampleRate);
    this.buffer = new Array(numChannels);
    for (let c = 0; c < numChannels; c++) {
      this.buffer[c] = new Float32Array(this.capacity);
    }
    this.writeIndex = 0;
    this.readIndex = 0;
    this.filled = 0;
  }

  // Get available space for writing
  get writeAvailable() {
    return this.capacity - this.filled;
  }

  // Get available samples for reading
  get readAvailable() {
    return this.filled;
  }

  // Write samples to ring buffer
  write(channelData) {
    const frames = channelData[0].length;
    if (frames > this.writeAvailable) {
      return 0; // Not enough space
    }

    for (let c = 0; c < this.numChannels; c++) {
      const source = channelData[c];
      const dest = this.buffer[c];
      for (let i = 0; i < frames; i++) {
        dest[(this.writeIndex + i) % this.capacity] = source[i];
      }
    }

    this.writeIndex = (this.writeIndex + frames) % this.capacity;
    this.filled += frames;
    return frames;
  }

  // Read samples from ring buffer
  read(outputChannels, frames) {
    const toRead = Math.min(frames, this.filled);
    
    for (let c = 0; c < this.numChannels; c++) {
      const source = this.buffer[c];
      const dest = outputChannels[c];
      for (let i = 0; i < toRead; i++) {
        dest[i] = source[(this.readIndex + i) % this.capacity];
      }
      // Fill remainder with silence if needed
      for (let i = toRead; i < frames; i++) {
        dest[i] = 0;
      }
    }

    this.readIndex = (this.readIndex + toRead) % this.capacity;
    this.filled -= toRead;
    return toRead;
  }

  // Clear the buffer
  clear() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.filled = 0;
  }

  // Get buffer health (0.0 = empty, 1.0 = full)
  get health() {
    return this.filled / this.capacity;
  }
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
    
    // Ring buffer (~5 seconds capacity)
    this.ringBuffer = null;
    this.RING_BUFFER_SECONDS = 5;
    
    // Refill threshold - request more data when buffer drops below this
    this.LOW_WATERMARK_SECONDS = 0.5; // Request refill when < 500ms buffered
    this.lowWatermarkFrames = 0;
    
    // Track refill requests to avoid spamming
    this.lastRefillRequestTime = 0;
    this.REFILL_COOLDOWN_MS = 50;
    
    // Position reporting
    this.positionReportInterval = 1 / 60;
    this.lastPositionReportTime = 0;
    
    // Sample rate from AudioContext
    this.contextSampleRate = sampleRate; // AudioWorklet global
    
    // Buffer starvation tracking
    this.starvationCount = 0;
    this.lastStarvationReport = 0;

    log('Constructor called, sample rate:', this.contextSampleRate);

    this.port.onmessage = async (e) => {
      const { type, moduleData, audioData } = e.data;
      log('Received message:', type || '(no-type)');

      if (type === 'load' && moduleData) {
        await this.loadModule(moduleData);
      } else if (type === 'audioData' && audioData) {
        // Receive pre-rendered audio from main thread
        this.receiveAudioData(audioData);
      } else if (type === 'seek') {
        if (this.modulePtr && this.lib) {
          // Clear buffer on seek to prevent old audio from playing
          if (this.ringBuffer) {
            this.ringBuffer.clear();
          }
          this.lib._openmpt_module_set_position_order_row(
            this.modulePtr, e.data.order, e.data.row
          );
        } else {
          error('Cannot seek: module not loaded');
        }
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

      // Wait for the async WASM runtime to complete initialisation
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

      // Initialize ring buffer with correct sample rate
      this.ringBuffer = new AudioRingBuffer(
        this.RING_BUFFER_SECONDS, 
        this.contextSampleRate, 
        2
      );
      this.lowWatermarkFrames = Math.floor(
        this.LOW_WATERMARK_SECONDS * this.contextSampleRate
      );
      
      log('Module loaded ✅ ptr=', this.modulePtr);
      log('Ring buffer initialized:', this.RING_BUFFER_SECONDS, 'seconds capacity');
      
      // Notify main thread we're ready and need audio data
      this.port.postMessage({ 
        type: 'loaded', 
        sampleRate: this.contextSampleRate,
        bufferCapacity: this.ringBuffer.capacity 
      });
    } catch (err) {
      error('loadModule error:', err);
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  // Receive audio data from main thread data pump
  receiveAudioData(audioData) {
    if (!this.ringBuffer) return;
    
    const written = this.ringBuffer.write(audioData);
    if (written === 0) {
      log('Ring buffer full, dropped audio chunk');
    }
  }

  // Request more audio from main thread
  requestRefill() {
    const now = currentTime * 1000; // AudioWorklet global currentTime in seconds
    if (now - this.lastRefillRequestTime > this.REFILL_COOLDOWN_MS) {
      const needed = this.ringBuffer.capacity - this.ringBuffer.filled;
      this.port.postMessage({ 
        type: 'needData', 
        framesNeeded: needed,
        bufferHealth: this.ringBuffer.health
      });
      this.lastRefillRequestTime = now;
    }
  }

  // ── Audio process loop ─────────────────────────────────────────────
  process(_inputs, outputs, _parameters) {
    const out = outputs[0];
    const outL = out[0];
    const outR = out[1];
    
    if (!outL || !outR) return true;

    // If module not loaded or ring buffer not ready, output silence
    if (!this.modulePtr || !this.lib || !this.ringBuffer) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    const numSamples = outL.length;

    // Try to read from ring buffer
    const samplesRead = this.ringBuffer.read([outL, outR], numSamples);

    // Check for starvation (buffer underrun)
    if (samplesRead < numSamples) {
      this.starvationCount++;
      const now = currentTime;
      if (now - this.lastStarvationReport > 1.0) { // Report once per second max
        this.port.postMessage({
          type: 'starvation',
          count: this.starvationCount,
          bufferHealth: this.ringBuffer.health
        });
        this.lastStarvationReport = now;
      }
    }

    // Request refill if buffer is running low
    if (this.ringBuffer.readAvailable < this.lowWatermarkFrames) {
      this.requestRefill();
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
        bufferHealth: this.ringBuffer.health,
        starvationCount: this.starvationCount
      });
      this.lastPositionReportTime = currentTime;
    }

    return true;
  }
}

registerProcessor('openmpt-processor', XMPlayerProcessor);
