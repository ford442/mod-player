/**
 * OpenMPT AudioWorklet Processor
 * Handles audio playback for libopenmpt in a Web Audio worklet context
 */

class OpenMPTProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    console.log('[OpenMPTWorklet] Processor initialized');

    this.moduleData = null;
    this.isPlaying = false;
    this.positionSeconds = 0;
    this.currentOrder = 0;
    this.currentRow = 0;
    this.bpm = 125;

    this.sampleRate = 44100;
    this.numChannels = 2;
    this.bufferSize = 4096;

    this.port.onmessage = this.handleMessage.bind(this);
    console.log('[OpenMPTWorklet] Processor ready');
  }

  handleMessage(event) {
    const { type } = event.data;
    switch (type) {
      case 'load':
        this.handleLoad(event.data.moduleData);
        break;
      case 'play':
        this.handlePlay();
        break;
      case 'pause':
        this.handlePause();
        break;
      case 'seek':
        this.handleSeek(event.data.order, event.data.row);
        break;
      default:
        console.warn('[OpenMPTWorklet] Unknown message type:', type);
    }
  }

  handleLoad(moduleData) {
    try {
      console.log('[OpenMPTWorklet] Loading module data:', moduleData?.byteLength || 0, 'bytes');
      if (!moduleData) {
        this.port.postMessage({ type: 'error', message: 'No module data provided' });
        return;
      }
      this.moduleData = new Uint8Array(moduleData);
      this.isLoaded = true;
      this.port.postMessage({ type: 'loaded' });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: 'Failed to load module: ' + error.message });
    }
  }

  handlePlay() {
    if (!this.isLoaded) {
      this.port.postMessage({ type: 'error', message: 'No module loaded' });
      return;
    }
    this.isPlaying = true;
  }

  handlePause() {
    this.isPlaying = false;
  }

  handleSeek(order, row) {
    this.currentOrder = order;
    this.currentRow = row;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const numFrames = output[0]?.length || 128;

    if (!this.isPlaying || !this.isLoaded) {
      for (let channel = 0; channel < this.numChannels; channel++) {
        if (output[channel]) output[channel].fill(0);
      }
      return true;
    }

    try {
      // Update position tracking
      this.positionSeconds += numFrames / this.sampleRate;

      // Send position update occasionally
      if (Math.floor(this.positionSeconds * 10) % 5 === 0) {
        this.port.postMessage({
          type: 'position',
          order: this.currentOrder,
          row: this.currentRow,
          positionSeconds: this.positionSeconds,
          bpm: this.bpm
        });
      }

      // Generate test tone for now (WASM will replace this)
      const leftChannel = output[0];
      const rightChannel = output[1] || output[0];
      const frequency = 440;
      const amplitude = 0.1;

      this.port.postMessage({
        type: 'position',
        order,
        row,
        positionSeconds: posSec,
        bpm,
        workletTime: currentTime,
        bufferHealth: this.ringBuffer.health,
        starvationCount: this.starvationCount
      });
      this.lastPositionReportTime = currentTime;
      for (let i = 0; i < numFrames; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * (this.positionSeconds + i / this.sampleRate)) * amplitude;
        if (leftChannel) leftChannel[i] = sample;
        if (rightChannel && rightChannel !== leftChannel) rightChannel[i] = sample;
      }
    } catch (error) {
      console.error('[OpenMPTWorklet] Error in process():', error);
      for (let ch = 0; ch < this.numChannels; ch++) {
        if (output[ch]) output[ch].fill(0);
      }
    }

    return true;
  }
}

registerProcessor('openmpt-processor', OpenMPTProcessor);
console.log('[OpenMPTWorklet] Script loaded, processor registered');
