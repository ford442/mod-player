/**
 * OpenMPT Audio Worklet Processor with Ring Buffer
 * Fixes skipping by buffering data ahead of playback.
 */

class OpenMPTProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Buffer Configuration: 5 seconds @ 44.1kHz (Stereo)
    this.bufferSize = 44100 * 5;
    this.buffer = new Float32Array(this.bufferSize * 2);
    
    // Pointers (Read/Write heads)
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.lastStarvationTime = 0;
    
    // Constants
    this.STARVATION_THROTTLE_SECONDS = 0.1; // Throttle starvation messages to 100ms

    this.port.onmessage = (e) => {
      const { left, right } = e.data;
      if (!left || !right) return;
      this.pushData(left, right);
    };
  }

  // Add incoming data to the Ring Buffer
  pushData(leftData, rightData) {
    const inputLen = leftData.length;
    
    // Check if we have space in the buffer
    const freeSpace = this.bufferSize - this.availableFrames;
    const framesToWrite = Math.min(inputLen, freeSpace);
    
    if (framesToWrite < inputLen) {
      // Buffer overflow - we're writing faster than consuming
      // This shouldn't happen with proper pump management, but log it
      this.port.postMessage({ type: 'overflow', lost: inputLen - framesToWrite });
    }
    
    for (let i = 0; i < framesToWrite; i++) {
      // Write Left
      this.buffer[this.writeIndex * 2] = leftData[i];
      // Write Right
      this.buffer[this.writeIndex * 2 + 1] = rightData[i];
      
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    this.availableFrames = Math.min(this.availableFrames + framesToWrite, this.bufferSize);
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputLeft = output[0];
    const outputRight = output[1];
    
    // Guard against empty output channels (can happen during teardown)
    if (!outputLeft || !outputRight) return true;

    const framesToRead = outputLeft.length; // Usually 128

    // If we are starving (not enough data), output silence and notify
    if (this.availableFrames < framesToRead) {
      // Output zeros to prevent glitches
      outputLeft.fill(0);
      outputRight.fill(0);
      
      // Throttle starvation messages to once per STARVATION_THROTTLE_SECONDS
      const now = currentTime;
      if (now - this.lastStarvationTime > this.STARVATION_THROTTLE_SECONDS) {
        this.port.postMessage({ type: 'starvation', available: this.availableFrames });
        this.lastStarvationTime = now;
      }
      return true;
    }

    // Read from Ring Buffer
    for (let i = 0; i < framesToRead; i++) {
      outputLeft[i] = this.buffer[this.readIndex * 2];
      outputRight[i] = this.buffer[this.readIndex * 2 + 1];

      this.readIndex = (this.readIndex + 1) % this.bufferSize;
    }

    this.availableFrames -= framesToRead;

    // Report buffer level occasionally (every ~1024 frames)
    if (this.readIndex % 1024 === 0) {
        this.port.postMessage({ type: 'bufferLevel', level: this.availableFrames });
    }

    return true;
  }
}

registerProcessor('openmpt-processor', OpenMPTProcessor);
