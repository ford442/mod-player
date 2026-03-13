# Audio Glitch & Timing Fix Plan - mod-player

## Executive Summary

The mod-player exhibits **severe audio-visual sync issues** and **intermittent audio glitches** across both AudioWorklet and ScriptProcessor playback modes. This document provides a root cause analysis and prioritized fix roadmap.

**Severity**: Critical - affects core playback functionality  
**Scope**: Audio engine, UI sync, shader rendering  
**Estimated Fix Time**: 2-3 days

---

## 1. Root Cause Analysis

### 1.1 AudioWorklet Mode - Buffer Latency Desync (CRITICAL)

```
Timeline of Audio vs Visual:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Main Thread (JS)              | Audio Thread (Worklet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━|━━━━━━━━━━━━━━━━━━━━━━━━
Pump chunk 1 (0-4096)         |
Pump chunk 2 (4096-8192)      |
Pump chunk 3 (8192-12288)     |
libopenmpt position: row 12   |
↓                             | render chunk 1 (0-4096) ▶ speakers
↓                             | render chunk 2 (4096-8192)
Query row → returns 12        | actually playing row 3
↓                             |
UI shows row 12               | audio at row 3
↓                             |
VISUAL LAG: ~9 rows (200ms+)  |
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**The Problem**:
- Main thread pumps audio **ahead** into the worklet ring buffer (target: 500ms)
- `libopenmpt_module_read_float_stereo()` advances the module position while filling buffer
- UI queries position after pumping → gets **future position**, not current playback position
- Result: Visuals lead audio by 200-500ms (buffer depth)

**Code Location**:
```typescript
// hooks/useLibOpenMPT.ts ~lines 417-477 (processAudioChunk)
// Pump advances libopenmpt position but audio isn't played yet
const framesRead = lib._openmpt_module_read_float_stereo(...)
// ...copy to worklet buffer...
audioWorkletNodeRef.current.port.postMessage({ left: leftSend, right: rightSend })
```

### 1.2 ScriptProcessor Mode - Synchronous but Coarse (MODERATE)

**The Problem**:
- Uses 4096-sample buffer (~93ms latency at 44.1kHz)
- `onaudioprocess` fires synchronously during audio render
- Position query happens after render → accurate for that block
- But 93ms is still perceptible latency for visual feedback
- No sub-block timing information

**Code Location**:
```typescript
// hooks/useLibOpenMPT.ts ~lines 617-651
scriptNodeRef.current.onaudioprocess = (e) => {
  const frames = lib._openmpt_module_read_float_stereo(...)
  // Position advanced here, but we're rendering this block NOW
  // ...copy to output...
}
```

### 1.3 UI Position Prediction - Wall Clock Drift (MODERATE)

**The Problem**:
- Current prediction uses `performance.now()` (wall clock), not `audioContext.currentTime`
- Wall clock and audio clock can drift
- Prediction accumulates error over time: `predictedRow = fractionalRow + dt * rowsPerSecond`
- No correction mechanism when prediction diverges from actual

**Code Location**:
```typescript
// hooks/useLibOpenMPT.ts ~lines 356-362
const now = performance.now() / 1000;
const dt = now - lastUpdateTimeRef.current;
const predictedRow = fractionalRow + dt * rowsPerSecond;  // Drifts!
```

### 1.4 Shader Uniform Precision Loss (MINOR but visible)

**The Problem**:
- `playheadRow` passed to shaders as `u32` (uint at offset 2 in uniforms)
- Fractional part in separate `tickOffset` field
- Shaders using `floor(playheadRow / 32.0)` for paging get sticky transitions
- No smooth sub-row interpolation in visual grid

**Code Location**:
```typescript
// components/PatternDisplay.tsx ~lines 93-96
uint[2] = Math.max(0, params.playheadRow) >>> 0;  // Loses fraction!
// ...
float[8] = params.tickOffset;  // Separate field
```

**Shader Impact**:
```wgsl
// shaders/patternv0.43.wgsl ~line 39
let activeCol = params.playheadRow % 32u;  // Integer modulo = jumpy
```

### 1.5 Worklet Buffer Management - Starvation/Overflow (CRITICAL)

**The Problem**:
- Buffer level tracking is estimate-based, not timestamp-based
- Emergency refill on starvation pumps 4x chunks immediately without smooth transition
- No buffer flush on seek → old audio plays before new position
- Overflow can occur if pump rate exceeds consumption

**Code Location**:
```typescript
// public/worklets/openmpt-processor.js ~lines 67-79
if (this.availableFrames < framesToRead) {
  outputLeft.fill(0);  // Silent gap!
  this.port.postMessage({ type: 'starvation', ... })
}

// hooks/useLibOpenMPT.ts ~lines 543-549
// Emergency refill - pumps multiple chunks at once
for (let i = 0; i < chunksToRefill; i++) {
  processAudioChunk(CHUNK_SIZE);  // Position jumps!
}
```

### 1.6 Missing Features for Accurate Sync

| Feature | Status | Impact |
|---------|--------|--------|
| Worklet reports render timestamp | ❌ Missing | Cannot calculate true latency |
| Buffer flush on seek | ❌ Missing | Old position audio plays after seek |
| Sample-accurate position tracking | ❌ Missing | Position is quantized to chunks |
| Audio clock based prediction | ❌ Missing | Wall clock drift over time |
| Shader fractional row position | ❌ Missing | Jumpy visual updates |

---

## 2. Prioritized Fix Roadmap

### Phase 1: Critical Fixes (Audio Stability) - 1 day

#### Fix 1.1: Fix Buffer Starvation Handling
**File**: `hooks/useLibOpenMPT.ts`, `public/worklets/openmpt-processor.js`

```typescript
// In worklet - add render timestamp reporting
process(inputs, outputs, parameters) {
  // ...existing code...
  
  // Report exact render time for this block
  if (this.readIndex % 128 === 0) {  // Every block
    this.port.postMessage({
      type: 'renderPosition',
      currentTime: currentTime,  // AudioContext time
      framesRendered: this.totalFramesRendered,  // Cumulative
      bufferLevel: this.availableFrames
    })
  }
}
```

```typescript
// In main thread - use timestamp for position calculation
if (event.data.type === 'renderPosition') {
  // Calculate actual playback position
  const audioTime = event.data.currentTime;
  const framesRendered = event.data.framesRendered;
  
  // Position in module = (frames pumped - frames in buffer) / samples per row
  const framesInBuffer = workletBufferLevel.current;
  const actualPlaybackFrame = totalFramesPumped - framesInBuffer;
  const actualRow = actualPlaybackFrame / framesPerRow;
  
  // Use this for UI instead of querying libopenmpt directly
}
```

#### Fix 1.2: Implement Buffer Flush on Seek
**File**: `hooks/useLibOpenMPT.ts`, `public/worklets/openmpt-processor.js`

```javascript
// Add to worklet
handleMessage(e) {
  if (e.data.type === 'flush') {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.buffer.fill(0);
  }
}
```

```typescript
// In seekToStep
audioWorkletNodeRef.current?.port.postMessage({ type: 'flush' });
workletBufferLevel.current = 0;
// Then set position in libopenmpt
lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);
```

### Phase 2: Sync Accuracy (Visual Alignment) - 1 day

#### Fix 2.1: Track Sample-Accurate Position
**File**: `hooks/useLibOpenMPT.ts`

```typescript
// Add refs for position tracking
const totalFramesPumpedRef = useRef<number>(0);
const framesPerRowRef = useRef<number>(0);

// In processAudioChunk
const framesRead = lib._openmpt_module_read_float_stereo(...);
totalFramesPumpedRef.current += framesRead;

// Calculate position for UI
const getAccuratePosition = () => {
  const framesInBuffer = workletBufferLevel.current;
  const framesPlayed = totalFramesPumpedRef.current - framesInBuffer;
  const row = framesPlayed / framesPerRowRef.current;
  return row;
}
```

#### Fix 2.2: Use Audio Clock for Prediction
**File**: `hooks/useLibOpenMPT.ts`

```typescript
// Replace wall clock with audio clock
const audioTime = audioContextRef.current.currentTime;
const dt = audioTime - lastAudioTimeRef.current;

// For worklet mode, calculate position from audio timeline
if (activeEngine === 'worklet') {
  const elapsedFrames = audioTime * SAMPLE_RATE;
  const row = (elapsedFrames % (framesPerRow * patternRows)) / framesPerRow;
  setPlaybackRowFraction(row);
}
```

#### Fix 2.3: Pass Fractional Position to Shaders
**File**: `components/PatternDisplay.tsx`

```typescript
// In createUniformPayload - change playheadRow to float
// Current: uint[2] = Math.max(0, params.playheadRow) >>> 0;
// Fix: 
float[2] = params.playheadRow;  // Now fractional!

// Update Uniforms struct in shaders
struct Uniforms {
  // ...
  playheadRow: f32,  // Was u32
  // ...
}
```

### Phase 3: Visual Playhead Tightening (All Shader Modes) - 0.5 days

This section addresses the **jumpy, imprecise playhead following** across all visualization modes.

#### Current State Analysis

| Shader | Layout | Playhead Method | Issues |
|--------|--------|-----------------|--------|
| `v0.43.wgsl` | Horizontal 32-step | `playheadRow % 32u` | Integer only, jumps between columns |
| `v0.44.wgsl` | Horizontal 64-step | `playheadRow % 64u` | Integer only, no smooth scroll |
| `v0.42.wgsl` | Circular 64-step | `playheadRow % 64u` | Hard snap between wedges |
| `v0.46.wgsl` | Horizontal 32-step | `playheadRow % 32u` | Same as v0.43 |
| WebGL Overlay | Cap-based | `mod(u_playhead, stepsPerPage)` | Vertex shader updates, but still integer |

**Core Problem**: All shaders receive `playheadRow` as `u32` (integer), causing the playhead to jump from column N to column N+1 instantly, rather than smoothly scrolling.

#### Fix 3.1: Unified Fractional Playhead Uniform

**File**: `components/PatternDisplay.tsx`

Change `playheadRow` from `u32` to `f32` in uniform buffer:

```typescript
// In createUniformPayload() - Extended layout
// CURRENT (loses fraction):
uint[2] = Math.max(0, params.playheadRow) >>> 0;

// FIX (preserves fraction):
float[2] = params.playheadRow;  // Now fractional! e.g., 12.34

// Remove tickOffset from separate field, it's now in playheadRow
// Repurpose tickOffset field for something else if needed
```

**Update Uniforms struct in ALL shaders**:
```wgsl
struct Uniforms {
  numRows: u32, numChannels: u32, 
  playheadRow: f32,  // ← Changed from u32 to f32
  isPlaying: u32,
  // ...
}
```

#### Fix 3.2: Horizontal Grid Shaders (v0.43, v0.44, v0.46)

**Files**: `shaders/patternv0.43.wgsl`, `shaders/patternv0.44.wgsl`, `shaders/patternv0.46.wgsl`

Replace hard integer comparison with smooth interpolation:

```wgsl
// BEFORE (jumpy):
let activeCol = params.playheadRow % 32u;
if (u32(stepID) == activeCol) {
    col = mix(col, vec3<f32>(0.0, 0.3, 0.4), 0.3);
}

// AFTER (smooth scroll):
let cols = 32.0;
let playheadFract = fract(params.playheadRow);  // 0.0 - 0.999
let playheadInt = floor(params.playheadRow);    // Integer part

// Calculate which column SHOULD be active with sub-column precision
let exactCol = params.playheadRow % cols;  // 0.0 - 31.999

// Distance from this pixel's column to playhead (in column units)
let thisCol = floor(uv.x * cols);
let dist = abs(f32(thisCol) - exactCol);

// Smooth highlight that spans partial columns
// When playhead is at 12.3, columns 12 and 13 both get partial highlight
let highlightWidth = 1.5;  // How many columns wide is the highlight
let intensity = 1.0 - smoothstep(0.0, highlightWidth, dist);

// Add gradient within the active column for "scanline" effect
let subColPos = fract(exactCol);  // 0.0-0.999 within column
let scanLine = 1.0 - abs(uv.x * cols - exactCol);

if (intensity > 0.0) {
    let baseColor = vec3<f32>(0.0, 0.3, 0.4);
    let glowColor = vec3<f32>(0.0, 0.6, 0.8);  // Brighter center
    let finalColor = mix(baseColor, glowColor, scanLine * intensity);
    col = mix(col, finalColor, 0.3 * intensity);
}

// Accent line at exact playhead position (like a needle)
let needleWidth = 0.1;  // In column units
let needleDist = abs(uv.x * cols - exactCol);
if (needleDist < needleWidth) {
    col += vec3<f32>(0.0, 0.8, 1.0) * (1.0 - needleDist / needleWidth);
}
```

#### Fix 3.3: Circular Shaders (v0.42)

**File**: `shaders/patternv0.42.wgsl`

Replace wedge-snap with smooth angular interpolation:

```wgsl
// BEFORE (hard wedge):
let activeRow = params.playheadRow % 64u;
let stepAngle = 6.28318 / steps;
let currentAngle = -1.570796 + f32(activeRow) * stepAngle;
let diff = abs(atan2(sin(a - currentAngle), cos(a - currentAngle)));
if (diff < (stepAngle * 0.5)) {
    col += vec3<f32>(0.2, 0.4, 0.5);
}

// AFTER (smooth rotating highlight):
let steps = 64.0;
let stepAngle = 6.28318 / steps;

// Exact angular position of playhead (not quantized)
let exactRow = params.playheadRow % steps;  // 0.0 - 63.999
let playheadAngle = -1.570796 + exactRow * stepAngle;

// Angular distance from this pixel to playhead (shortest path)
var angleDiff = a - playheadAngle;
// Normalize to -PI to PI
angleDiff = atan2(sin(angleDiff), cos(angleDiff));

// Smooth wedge highlight with gradient edges
let wedgeWidth = stepAngle * 1.5;  // Wider than one step
let intensity = 1.0 - smoothstep(0.0, wedgeWidth * 0.5, abs(angleDiff));

// Inner "dot" at exact playhead position
let centerGlow = exp(-length(p - vec2(cos(playheadAngle), sin(playheadAngle)) * (minRadius + maxRadius) * 0.5) * 20.0);

// Apply
if (intensity > 0.0) {
    let highlightColor = vec3<f32>(0.2, 0.4, 0.5) * intensity;
    col += highlightColor;
}
col += vec3<f32>(0.0, 0.8, 1.0) * centerGlow * 0.5;
```

#### Fix 3.4: WebGL Overlay Playhead (PatternDisplay.tsx)

**File**: `components/PatternDisplay.tsx` (WebGL vertex shader)

```glsl
// BEFORE (vertex shader):
float relativePlayhead = mod(u_playhead, stepsPerPage);
if (abs(float(row) - relativePlayhead) < 0.5) {
    scale *= 1.15;
    v_active = 1.0;
}

// AFTER (smooth cap scaling):
float relativePlayhead = mod(u_playhead, stepsPerPage);
float distToPlayhead = abs(float(row) - relativePlayhead);

// Smooth falloff over 1.5 cells
float activation = 1.0 - smoothstep(0.0, 1.5, distToPlayhead);

// Scale caps near playhead (subtle pop effect)
scale *= 1.0 + (0.15 * activation);
v_active = activation;  // 0.0-1.0 instead of bool

// In fragment shader, use v_active for smooth color blending
// Instead of: if (v_active > 0.5) { color = orange; }
// Use: color = mix(idleColor, activeColor, v_active);
```

#### Fix 3.5: Predictive Page Boundaries (All Shaders)

For shaders that page through pattern data (32/64 step windows):

```wgsl
// Smooth page transition when crossing boundary
let pageSize = 32.0;
let pageProgress = fract(params.playheadRow / pageSize);  // 0.0-0.999

// Fade intensity near page boundaries to hide the "jump"
let boundaryFade = 1.0;
if (pageProgress < 0.05) {
    // Near start of page - fade in
    boundaryFade = smoothstep(0.0, 0.05, pageProgress);
} else if (pageProgress > 0.95) {
    // Near end of page - fade out
    boundaryFade = 1.0 - smoothstep(0.95, 1.0, pageProgress);
}

// Apply to final color
finalColor *= boundaryFade;
```

#### Fix 3.6: Add Playhead Trail Effect

For better visual following, add a "trail" behind the playhead:

```wgsl
// Horizontal grid trail
let trailLength = 3.0;  // columns
let trailDist = exactCol - f32(thisCol);
if (trailDist > 0.0 && trailDist < trailLength) {
    let trailIntensity = (1.0 - trailDist / trailLength) * 0.3;
    col += vec3<f32>(0.0, 0.2, 0.3) * trailIntensity;
}
```

---

#### Visual Playhead Comparison: Before vs After

```
BEFORE (Current Integer-Based):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Playhead at row 12.7:
│   │   │   │[██│██]│   │   │   │   │   │
             ↑ Jump between columns 12 and 13
             No indication of 0.7 fractional position

Page boundary at row 32:
[showing rows 0-31] → [showing rows 32-63]
         ↑ Instant page flip, jarring

Circular (v0.42):
    ↖↗     Playhead jumps between wedges
   /  \
  │ ██ │   Hard edge at wedge boundary
  │ ██ │
   \
  /

AFTER (Fractional with Smoothing):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Playhead at row 12.7:
│   │   │[░░│██▓│▓░]│   │   │   │   │   │
             ↑ Smooth gradient across columns
             Needle at exact 12.7 position
             Trail fading behind

Page boundary at row 32:
[showing rows 0-31] → [fades] → [showing rows 32-63]
                    ↑ Smooth crossfade during transition

Circular (v0.42):
    ↖↗     Playhead rotates smoothly
   /  \
  │ ▓▓ │   Gradient edge, glow follows angle
  │▓██▓│   Center dot at exact position
   \
  /
```

**Key Improvements**:
1. **Sub-column precision**: Playhead position shows exactly where in the row we are
2. **Smooth transitions**: No more snapping between grid cells
3. **Visual trail**: Easier to track fast-moving playhead
4. **Page boundary fade**: Eliminates jarring jumps when changing pages
5. **Needle indicator**: Precise visual reference for exact position

### Phase 4: Performance & Polish - 0.5 days

#### Fix 4.1: Reduce Buffer Latency
**File**: `hooks/useLibOpenMPT.ts`

```typescript
// Reduce target buffer for tighter sync
const BUFFER_TARGET_FRAMES = SAMPLE_RATE * 0.2;  // 200ms instead of 500ms
const BUFFER_MIN_FRAMES = SAMPLE_RATE * 0.1;     // 100ms minimum
```

#### Fix 4.2: Add Sync Debug Overlay
**File**: `components/Controls.tsx` or new debug component

```typescript
// Show sync metrics
const SyncDebug = () => (
  <div className="sync-debug">
    <div>Buffer: {bufferLevelMs.toFixed(0)}ms</div>
    <div>Drift: {audioVisualDrift.toFixed(1)}ms</div>
    <div>Mode: {activeEngine}</div>
  </div>
);
```

---

## 3. Implementation Checklist

### Critical (Must Fix)
- [ ] Add render timestamp reporting from worklet
- [ ] Implement buffer flush on seek
- [ ] Fix starvation recovery to not skip positions
- [ ] Reduce default buffer target from 500ms to 200ms

### High Priority (Should Fix)
- [ ] Track sample-accurate position in main thread
- [ ] Use audio clock instead of wall clock for prediction
- [ ] Add fractional playheadRow to shader uniforms

### Medium Priority (Visual Polish)
- [ ] Smooth shader transitions using fractional row
- [ ] Add playhead "trail" effect for better tracking
- [ ] Add sync debug overlay
- [ ] Option to select latency (low/medium/high)

### Visual Playhead Fixes (New)
- [ ] **v0.43/v0.46 (32-step horizontal)**: Smooth column interpolation with "needle" indicator
- [ ] **v0.44 (64-step horizontal)**: Same as v0.43 with adjusted column count
- [ ] **v0.42 (circular)**: Smooth angular interpolation with center glow dot
- [ ] **WebGL Overlay**: Smooth cap scaling instead of binary on/off
- [ ] **All shaders**: Page boundary fade to hide paging transitions
- [ ] **Uniform change**: `playheadRow: f32` instead of `u32` in all shaders
- [ ] **PatternDisplay.tsx**: Update uniform packing to preserve fractional row

---

## 4. Testing Strategy

### Test Cases

1. **Basic Sync Test**
   - Load repetitive module (4-mat_madness.mod)
   - Toggle between Script/Worklet modes
   - Visual playhead should align with audio beat

2. **Seek Test**
   - Play module, wait 10 seconds
   - Click seek to beginning
   - Audio should restart immediately without old buffer playing

3. **Stress Test**
   - Rapid play/stop/seek cycles
   - No buffer underruns or overflow warnings

4. **Long-Running Drift Test**
   - Play for 5 minutes
   - Visual should not drift from audio

5. **Starvation Recovery**
   - Induce CPU load (dev tools performance throttling)
   - Should recover gracefully without position jumps

### Debug Logging

Enable detailed logging during development:
```typescript
// Add to useLibOpenMPT
const DEBUG_AUDIO = true;
if (DEBUG_AUDIO) {
  console.log({
    mode: activeEngine,
    bufferLevel: workletBufferLevel.current,
    pumpedFrames: totalFramesPumpedRef.current,
    queriedRow: row,
    calculatedRow: accurateRow,
    drift: row - accurateRow
  });
}
```

---

## 5. Architecture Diagram (Post-Fix)

### Audio Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                      MAIN THREAD                            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ libopenmpt   │    │ Position     │    │ UI/Shader    │  │
│  │ (WASM)       │───▶│ Calculator   │───▶│ Render       │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   ▲                              │
│         │ Pump audio        │ Use accurate position        │
│         ▼                   │ (sample-accurate)            │
│  ┌──────────────────────────────────────┐                  │
│  │ Ring Buffer (200ms target)           │                  │
│  └──────────────────────────────────────┘                  │
│         │                                                   │
│         │ postMessage                                       │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────┼───────────────────────────────────────────────────┐
│         ▼         AUDIO WORKLET THREAD                      │
│  ┌──────────────────────────────────────┐                  │
│  │ OpenMPTProcessor                     │                  │
│  │  - Ring buffer management            │                  │
│  │  - Render timestamp reporting        │                  │
│  │  - Flush command handling            │                  │
│  └──────────────────────────────────────┘                  │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────────────────────────┐                  │
│  │ Web Audio API → Speakers             │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Visual Playhead Pipeline (NEW - Fractional Support)

```
┌──────────────────────────────────────────────────────────────┐
│                    VISUAL RENDER PIPELINE                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐      ┌─────────────────┐               │
│  │ Position Tracker│      │ Uniform Builder │               │
│  │                 │      │                 │               │
│  │ ┌─────────────┐ │      │ ┌─────────────┐ │               │
│  │ │Sample-Accurate│─────▶│ │playheadRow: │ │               │
│  │ │Row (12.734) │ │      │ │    f32      │ │               │
│  │ └─────────────┘ │      │ │(12.734, not │ │               │
│  └─────────────────┘      │ │    12)      │ │               │
│                           │ └─────────────┘ │               │
│                           └────────┬────────┘               │
│                                    │                         │
│                                    ▼                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Shader Branch                      │   │
│  ├──────────────────┬──────────────────┬────────────────┤   │
│  │  Horizontal      │   Circular       │   WebGL        │   │
│  │  (v0.43/v0.44)   │   (v0.42)        │   Overlay      │   │
│  ├──────────────────┼──────────────────┼────────────────┤   │
│  │                  │                  │                │   │
│  │ Smooth column    │ Angular          │ Smooth cap     │   │
│  │ interpolation    │ interpolation    │ scaling        │   │
│  │ Needle at exact  │ Glow follows     │ v_active is    │   │
│  │ position         │ angle            │ float 0-1      │   │
│  │ Trail effect     │ Center dot       │ not bool       │   │
│  │                  │                  │                │   │
│  └──────────────────┴──────────────────┴────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Compositor (Page Boundary Fade)               │   │
│  │    Smooth crossfade at 32/64 step boundaries         │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  WebGPU/WebGL Output                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Related Files

| File | Purpose |
|------|---------|
| `hooks/useLibOpenMPT.ts` | Main audio engine, position tracking |
| `public/worklets/openmpt-processor.js` | AudioWorklet processor |
| `components/PatternDisplay.tsx` | Shader uniform management |
| `shaders/patternv0.4*.wgsl` | Pattern visualization shaders |
| `accurate_playback.md` | Previous timing analysis |

---

## 7. References

- [Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [AudioWorklet Timing](https://webaudio.github.io/web-audio-api/#audioworklet)
- [libopenmpt API Docs](https://lib.openmpt.org/doc/)

---

*Generated: 2026-02-12*  
*Status: Ready for implementation*
