// openmpt-worklet.js
// Advanced AudioWorkletProcessor for libopenmpt with ring buffer, starvation tracking,
// and proper WASM initialization.

const DEBUG = false;

function log(...args) {
  if (DEBUG) console.log('[Worklet]', ...args);
}

function error(...args) {
  console.error('[Worklet]', ...args);
}

// ==================== RING BUFFER ====================
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

  get writeAvailable() { return this.capacity - this.filled; }
  get readAvailable() { return this.filled; }

  write(channelData) {
    const frames = channelData[0].length;
    if (frames > this.writeAvailable) return 0;

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

  read(outputChannels, frames) {
    const toRead = Math.min(frames, this.filled);
    for (let c = 0; c < this.numChannels; c++) {
      const source = this.buffer[c];
      const dest = outputChannels[c];
      for (let i = 0; i < toRead; i++) {
        dest[i] = source[(this.readIndex + i) % this.capacity];
      }
      for (let i = toRead; i < frames; i++) {
        dest[i] = 0;
      }
    }
    this.readIndex = (this.readIndex + toRead) % this.capacity;
    this.filled -= toRead;
    return toRead;
  }

  clear() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.filled = 0;
  }

  get health() {
    return this.filled / this.capacity;
  }
}

// ==================== MAIN PROCESSOR ====================
class OpenMPTProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.modulePtr = 0;
    this.leftBufPtr = 0;
    this.rightBufPtr = 0;
    this.maxFrames = 4096;
    this.lib = null;
    this.isLibReady = false;

    // Ring buffer (5 seconds)
    this.ringBuffer = null;
    this.RING_BUFFER_SECONDS = 5;
    this.LOW_WATERMARK_SECONDS = 0.5;

    this.starvationCount = 0;
    this.lastStarvationReport = 0;
    this.lastRefillRequestTime = 0;
    this.REFILL_COOLDOWN_MS = 50;

    this.positionReportInterval = 1 / 60;
    this.lastPositionReportTime = 0;

    this.contextSampleRate = sampleRate; // global in AudioWorklet

    log('OpenMPTProcessor initialized, sample rate:', this.contextSampleRate);

    this.port.onmessage = async (e) => {
      const { type, moduleData, audioData } = e.data;

      if (type === 'load' && moduleData) {
        await this.loadModule(moduleData);
      } else if (type === 'audioData' && audioData) {
        this.receiveAudioData(audioData);
      } else if (type === 'seek') {
        if (this.modulePtr && this.lib) {
          if (this.ringBuffer) this.ringBuffer.clear();
          this.lib._openmpt_module_set_position_order_row(
            this.modulePtr, e.data.order, e.data.row
          );

          // TIMING FIX: Acknowledge seek
          this.port.postMessage({
            type: 'seekAck',
            order: e.data.order,
            row: e.data.row,
            timestamp: e.data.timestamp || currentTime
          });
        } else {
          error('Cannot seek: module not loaded');
          this.port.postMessage({ type: 'seekAck', success: false });
        }
      }
    };
  }

  // ── WASM Initialization ─────────────────────────────────────
  async _initLib() {
    try {
      log('Dynamic importing libopenmpt-audioworklet.js...');
      const mod = await import('./libopenmpt-audioworklet.js');
      this.lib = mod.default || mod;

      if (!this.lib._openmpt_module_create_from_memory) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('WASM init timeout')), 20000);
          const prev = this.lib.onRuntimeInitialized;
          this.lib.onRuntimeInitialized = () => {
            clearTimeout(timeout);
            if (typeof prev === 'function') prev();
            resolve();
          };
        });
      }
      this.isLibReady = true;
      log('WASM library ready');
    } catch (err) {
      error('Failed to initialize libopenmpt:', err);
    }
  }

  // ── Module Loading ──────────────────────────────────────────
  async loadModule(moduleData) {
    await this._initLib();
    if (!this.isLibReady) {
      error('WASM never became ready');
      this.port.postMessage({ type: 'error', message: 'WASM init failed' });
      return;
    }

    try {
      // Free old buffers if any
      if (this.leftBufPtr) { this.lib._free(this.leftBufPtr); this.leftBufPtr = 0; }
      if (this.rightBufPtr) { this.lib._free(this.rightBufPtr); this.rightBufPtr = 0; }

      const filePtr = this.lib._malloc(moduleData.byteLength);
      this.lib.HEAPU8.set(new Uint8Array(moduleData), filePtr);

      this.modulePtr = this.lib._openmpt_module_create_from_memory(
        filePtr, moduleData.byteLength, 0, 0, 0
      );
      this.lib._free(filePtr);

      if (this.modulePtr === 0) throw new Error('Failed to create module');

      this.leftBufPtr = this.lib._malloc(4 * this.maxFrames);
      this.rightBufPtr = this.lib._malloc(4 * this.maxFrames);

      // High quality rendering
      this.lib._openmpt_module_set_render_param(this.modulePtr, 2, 8);

      this.ringBuffer = new AudioRingBuffer(
        this.RING_BUFFER_SECONDS,
        this.contextSampleRate,
        2
      );

      log('Module loaded successfully, ring buffer ready');

      this.port.postMessage({
        type: 'loaded',
        sampleRate: this.contextSampleRate,
        bufferCapacity: this.ringBuffer.capacity
      });
    } catch (err) {
      error('loadModule failed:', err);
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  receiveAudioData(audioData) {
    if (!this.ringBuffer) return;
    this.ringBuffer.write(audioData);
  }

  requestRefill() {
    const now = currentTime * 1000;
    if (now - this.lastRefillRequestTime < this.REFILL_COOLDOWN_MS) return;

    const needed = this.ringBuffer.capacity - this.ringBuffer.filled;
    this.port.postMessage({
      type: 'needData',
      framesNeeded: needed,
      bufferHealth: this.ringBuffer.health
    });
    this.lastRefillRequestTime = now;
  }

  // ── Audio Processing Loop ───────────────────────────────────
  process(_inputs, outputs, _parameters) {
    const out = outputs[0];
    if (!out || !out[0] || !out[1]) return true;

    if (!this.modulePtr || !this.lib || !this.ringBuffer) {
      out[0].fill(0);
      out[1].fill(0);
      return true;
    }

    const numSamples = out[0].length;
    const samplesRead = this.ringBuffer.read([out[0], out[1]], numSamples);

    // Starvation tracking
    if (samplesRead < numSamples) {
      this.starvationCount++;
      const now = currentTime;
      if (now - this.lastStarvationReport > 1.0) {
        this.port.postMessage({
          type: 'starvation',
          count: this.starvationCount,
          bufferHealth: this.ringBuffer.health
        });
        this.lastStarvationReport = now;
      }
    }

    // Request more data if needed
    if (this.ringBuffer.readAvailable < this.LOW_WATERMARK_SECONDS * this.contextSampleRate) {
      this.requestRefill();
    }

    // Position reporting ~60 Hz
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
        workletTime: currentTime,           // ← Atomic timestamp
        bufferHealth: this.ringBuffer.health,
        starvationCount: this.starvationCount
      });

      this.lastPositionReportTime = currentTime;
    }

    return true;
  }
}

registerProcessor('openmpt-processor', OpenMPTProcessor);
console.log('[OpenMPTWorklet] Advanced processor registered with ring buffer support');