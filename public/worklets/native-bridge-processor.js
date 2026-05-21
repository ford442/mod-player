/**
 * native-bridge-processor.js
 *
 * AudioWorkletProcessor that reads stereo audio samples from a SharedArrayBuffer
 * ring buffer written by the native C++/Wasm OpenMPT engine and re-outputs them
 * through the main-thread Web Audio graph.
 *
 * This makes GainNode (volume), AnalyserNode (oscilloscope), StereoPannerNode,
 * and AudioContext.resume() work correctly with the native engine.
 *
 * Ring buffer layout (in WASM linear memory, which is a SharedArrayBuffer):
 *   Bytes [byteOffset +  0 ..  3]  writeHead (Int32) – written atomically by C++
 *   Bytes [byteOffset +  4 ..  7]  readHead  (Int32) – written atomically here
 *   Bytes [byteOffset +  8 .. N ]  stereo samples (Float32, interleaved L/R)
 *
 * processorOptions (passed from main thread via new AudioWorkletNode(...)):
 *   wasmMemory       {SharedArrayBuffer}  The WASM linear memory buffer
 *   ringBufByteOffset {number}            Byte offset of the ring buffer in wasmMemory
 *   frameCapacity    {number}             Ring buffer size in stereo frames
 */

const STARVATION_LOG_INTERVAL_MS = 2000;

class NativeBridgeProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);

        const { wasmMemory, ringBufByteOffset, frameCapacity } =
            (options && options.processorOptions) ? options.processorOptions : {};

        this._active = false;
        this._starvationCount = 0;
        this._lastStarvationLog = 0;

        if (
            wasmMemory instanceof SharedArrayBuffer &&
            typeof ringBufByteOffset === 'number' && ringBufByteOffset >= 0 &&
            typeof frameCapacity === 'number' && frameCapacity > 0
        ) {
            // Int32 header: writeHead at [0], readHead at [1]
            this._writeHeadView = new Int32Array(wasmMemory, ringBufByteOffset,     1);
            this._readHeadView  = new Int32Array(wasmMemory, ringBufByteOffset + 4, 1);
            // Float32 sample area starting at byteOffset + 8
            this._samplesView = new Float32Array(
                wasmMemory,
                ringBufByteOffset + 8,
                frameCapacity * 2  // 2 channels per frame
            );
            this._frameCapacity = frameCapacity;
            this._active = true;
        } else {
            console.warn(
                '[NativeBridgeProcessor] Missing or invalid processorOptions; outputting silence.',
                { wasmMemory, ringBufByteOffset, frameCapacity }
            );
        }
    }

    process(_inputs, outputs) {
        const output = outputs[0];
        const outL = output ? output[0] : null;
        const outR = output ? output[1] : null;

        if (!this._active || !outL) return true;

        const blockSize = outL.length; // typically 128 frames
        const capacity  = this._frameCapacity;

        const writeHead = Atomics.load(this._writeHeadView, 0);
        const readHead  = Atomics.load(this._readHeadView,  0);

        // Number of frames the C++ worklet has written ahead of our read position
        const available = (writeHead - readHead + capacity) % capacity;
        const toRead    = Math.min(blockSize, available);

        // Copy samples from ring buffer (both channels if available)
        if (outR) {
            for (let i = 0; i < toRead; i++) {
                const pos = (readHead + i) % capacity;
                outL[i] = this._samplesView[pos * 2];
                outR[i] = this._samplesView[pos * 2 + 1];
            }
        } else {
            // Mono output — mix down both channels
            for (let i = 0; i < toRead; i++) {
                const pos = (readHead + i) % capacity;
                outL[i] = (this._samplesView[pos * 2] + this._samplesView[pos * 2 + 1]) * 0.5;
            }
        }

        // Zero-fill any frames not supplied (ring buffer underrun / starvation)
        if (toRead < blockSize) {
            outL.fill(0, toRead);
            if (outR) outR.fill(0, toRead);
            this._starvationCount++;
            // Throttle log to avoid console spam; use this._frameCount as a clock
            this._frameCount = (this._frameCount || 0) + blockSize;
            const nowApprox = this._frameCount / sampleRate; // sampleRate is global in AudioWorkletGlobalScope
            if (nowApprox - this._lastStarvationLog > STARVATION_LOG_INTERVAL_MS / 1000) {
                console.warn('[NativeBridgeProcessor] Ring buffer starvation ×' +
                    this._starvationCount + ' (available=' + available + ')');
                this._starvationCount = 0;
                this._lastStarvationLog = nowApprox;
            }
        }

        // Advance read head
        Atomics.store(this._readHeadView, 0, (readHead + toRead) % capacity);

        return true; // keep processor alive
    }
}

registerProcessor('native-bridge-processor', NativeBridgeProcessor);
