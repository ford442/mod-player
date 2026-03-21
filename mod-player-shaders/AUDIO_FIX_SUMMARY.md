# AudioWorklet Stuttering Fix - Implementation Summary

## Issue #72: AudioWorklet Stuttering & Sample Rate Mismatch

### Root Causes
1. **Hardcoded 44100 sample rate** - Didn't match device's actual audio rate
2. **Real-time WASM rendering** - `process()` callback was calling libopenmpt directly, causing glitches if WASM was slow
3. **No lookahead buffering** - Audio rendered just-in-time, prone to underruns

---

## Changes Made

### 1. public/worklets/openmpt-worklet.js (AudioWorklet Processor)

#### Added Ring Buffer Class
```javascript
class AudioRingBuffer {
  constructor(capacitySeconds, sampleRate, numChannels)
  get writeAvailable() / readAvailable()
  write(channelData) / read(outputChannels, frames)
  clear() / get health()
}
```

#### Key Features
- **5-second capacity** ring buffer (`RING_BUFFER_SECONDS = 5`)
- **Low watermark** at 500ms - requests refill when buffer drops below this
- **Starvation tracking** - counts and reports buffer underruns
- **Non-blocking reads** - `process()` only reads from ring buffer, never calls WASM

#### New Message Types
- `audioData` - Receive audio chunks from main thread
- `needData` - Request refill when buffer is low
- `starvation` - Report buffer underrun events

#### Process() Flow
```
1. Read from ring buffer into output channels
2. If buffer underrun, count starvation
3. If buffer < low watermark, request refill
4. Report position at 60Hz
```

---

### 2. hooks/useLibOpenMPT.ts (Main Thread)

#### Sample Rate Fix
**Before:**
```typescript
const SAMPLE_RATE = 44100;  // Hardcoded
```

**After:**
```typescript
const sampleRate = audioContextRef.current?.sampleRate || 48000;
// Used in render call:
lib._openmpt_module_read_float_stereo(modPtr, sampleRate, ...)
```

The render function now uses `audioContextRef.current.sampleRate` instead of hardcoded 44100.

#### Data Pump Implementation

**New State:**
```typescript
const audioPumpIntervalRef = useRef(null);
const audioChunkBuffersRef = useRef({ left: null, right: null });
```

**Pump Settings:**
```typescript
const AUDIO_PUMP_INTERVAL_MS = 20;  // Pump every 20ms
const CHUNK_SIZE_FRAMES = 2048;      // Frames per chunk
const PRE_BUFFER_CHUNKS = 10;        // Pre-buffer 10 chunks before start
```

**Pump Flow:**
```
1. Allocate chunk buffers in WASM heap
2. Pre-buffer 10 chunks before starting
3. Every 20ms, render 2 more chunks
4. Send to worklet via postMessage
```

**Code:**
```typescript
const startAudioPump = useCallback(() => {
  audioPumpIntervalRef.current = setInterval(() => {
    // Render CHUNK_SIZE_FRAMES at actual sample rate
    const written = lib._openmpt_module_read_float_stereo(
      modPtr, sampleRate, CHUNK_SIZE_FRAMES, leftPtr, rightPtr
    );
    
    // Send to worklet
    worklet.port.postMessage({
      type: 'audioData',
      audioData: [new Float32Array(left), new Float32Array(right)]
    });
  }, AUDIO_PUMP_INTERVAL_MS);
}, []);
```

#### ScriptProcessorNode Fallback
Still works correctly, also uses actual `ctx.sampleRate`:
```typescript
const sampleRate = ctx.sampleRate;
spNode.onaudioprocess = (audioEvt) => {
  const written = mLib._openmpt_module_read_float_stereo(
    mPtr, sampleRate, SP_BUFFER, leftPtr, rightPtr
  );
};
```

#### Lifecycle Integration
- `startAudioPump()` called when worklet sends `loaded` message
- `stopAudioPump()` called in `stopMusic()` and cleanup
- Pump stops automatically on pause/stop

---

## Buffer Flow Architecture

```
┌─────────────────┐     postMessage      ┌─────────────────┐
│   Main Thread   │ ───────────────────▶ │   AudioWorklet  │
│   (Data Pump)   │   audioData chunks   │  (Ring Buffer)  │
│                 │                      │                 │
│  ┌───────────┐  │                      │  ┌───────────┐  │
│  │ libopenmpt│  │                      │  │  Ring     │  │
│  │  (WASM)   │  │                      │  │  Buffer   │  │
│  └─────┬─────┘  │                      │  │ (5 sec)   │  │
│        │        │                      │  └─────┬─────┘  │
│        ▼        │                      │        │        │
│  ┌───────────┐  │                      │        ▼        │
│  │  Render   │  │                      │  ┌───────────┐  │
│  │  Audio    │──┘                      │  │  process  │  │
│  │  Chunks   │                         │  │ callback  │  │
│  └───────────┘                         │  └─────┬─────┘  │
│                                        │        │        │
│  ┌───────────┐                         │        ▼        │
│  │ setInterval│◀──20ms─────────────────│  ┌───────────┐  │
│  │   Pump    │                         │  │  Output   │──┼──▶ Speakers
│  └───────────┘                         │  │  Buffer   │  │
└─────────────────┘                      └─────────────────┘
                                                  ▲
                                                  │
                                         ┌────────┴────────┐
                                         │  needData msg   │
                                         │  (when low)     │
                                         └─────────────────┘
```

---

## Benefits

| Before | After |
|--------|-------|
| Glitches when WASM busy | Smooth playback with 5s buffer |
| Wrong pitch on 48kHz devices | Correct pitch everywhere |
| Real-time rendering | Pre-rendered with lookahead |
| No visibility into underruns | Starvation counting/debugging |
| Single-threaded audio | Decoupled render/playback threads |

---

## Migration Guide

### To apply these changes:

1. **Replace the worklet file:**
   ```bash
   cp openmpt-worklet.js public/worklets/openmpt-worklet.js
   ```

2. **Replace the hook file:**
   ```bash
   cp useLibOpenMPT.ts hooks/useLibOpenMPT.ts
   ```

3. **Clear browser cache** - Worklets are aggressively cached

4. **Test on different devices:**
   - macOS (usually 48kHz)
   - Windows (varies: 44.1kHz or 48kHz)
   - Mobile (varies)

---

## Debugging

### New console messages:
```
[AudioPump] Starting with sample rate: 48000
[AudioPump] Pre-buffering complete, starting playback
[PLAY] Worklet loaded, sample rate: 48000
```

### Starvation warnings:
```
[PLAY] Buffer starvation detected: 3
```

### Buffer health in syncDebug:
```typescript
syncDebug.bufferMs      // Buffered audio in milliseconds
syncDebug.starvationCount // Total underruns
```

---

## Future Enhancements

1. **Adaptive buffer sizing** - Adjust based on detected underruns
2. **Buffer visualization** - Show buffer health in UI
3. **Resume from starvation** - Auto-recover by seeking forward
4. **SharedArrayBuffer** - Zero-copy audio transfer (requires COOP/COEP)
