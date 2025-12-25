/**
 * OpenMPT Audio Worklet Processor
 * Provides better performance and lower latency than ScriptProcessorNode
 * 
 * This processor receives pre-rendered audio buffers from the main thread
 * and outputs them to the audio context with proper buffering.
 */

class OpenMPTProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Ring buffer for smooth audio playback
    // Size: 8192 samples (2x the main buffer size of 4096)
    // Provides ~185ms of buffering at 44.1kHz to prevent underruns
    this.bufferSize = 8192;
    this.leftBuffer = new Float32Array(this.bufferSize);
    this.rightBuffer = new Float32Array(this.bufferSize);
    this.readPos = 0;
    this.writePos = 0;
    this.available = 0;
    
    // Handle messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'audioData') {
        this.enqueueAudio(event.data.left, event.data.right);
      } else if (event.data.type === 'reset') {
        this.reset();
      }
    };
  }

  enqueueAudio(leftData, rightData) {
    const samples = leftData.length;
    
    for (let i = 0; i < samples; i++) {
      this.leftBuffer[this.writePos] = leftData[i];
      this.rightBuffer[this.writePos] = rightData[i];
      this.writePos = (this.writePos + 1) % this.bufferSize;
      this.available++;
      
      // Prevent buffer overflow
      if (this.available >= this.bufferSize) {
        this.readPos = (this.readPos + 1) % this.bufferSize;
        this.available--;
      }
    }
  }

  reset() {
    this.readPos = 0;
    this.writePos = 0;
    this.available = 0;
    this.leftBuffer.fill(0);
    this.rightBuffer.fill(0);
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    
    if (!output || output.length < 2) {
      return true;
    }

    const leftChannel = output[0];
    const rightChannel = output[1];
    const framesToProcess = leftChannel.length;

    // Output buffered samples or silence
    for (let i = 0; i < framesToProcess; i++) {
      if (this.available > 0) {
        leftChannel[i] = this.leftBuffer[this.readPos];
        rightChannel[i] = this.rightBuffer[this.readPos];
        this.readPos = (this.readPos + 1) % this.bufferSize;
        this.available--;
      } else {
        // No data available, output silence
        leftChannel[i] = 0;
        rightChannel[i] = 0;
      }
    }

    // Request more data if buffer is running low (less than 2x quantum)
    if (this.available < framesToProcess * 2) {
      this.port.postMessage({ type: 'needData' });
    }

    return true; // Keep processor alive
  }
}

registerProcessor('openmpt-processor', OpenMPTProcessor);
