# Accurate Playback Diagnosis: mod-player

## Problem Summary
- **32-step segment tracking inaccurate** in shaders like `patternv0.40.wgsl` and `patternv0.43.wgsl`.
- **Playhead loses following/sync** with audio.
- **AudioWorklet mode** introduces timing drift.

## Root Causes

### 1. AudioWorklet Buffering Latency
```
Main Thread (RAF ~16ms)          | Worklet Thread (4096 samples ~93ms blocks)
  pump chunks ahead (200-500ms)  | 
  ↓                              | render audio from buffer
libopenmpt position lags audio   |
by buffer depth                  |
```
- **ScriptProcessor**: `onaudioprocess` fires *during* render → position perfectly synced.
- **Worklet**: Main pumps *ahead* → `libopenmpt_module_get_current_row()` lags by buffer (~200ms+).

**Visual Effect**:
```
Actual Audio Row: 45 ───▶ 46 ───▶ 47
Queried Position: 42 ───▶ 43 ───▶ 44  (lag)
Shader Window:   [14-45]▶[15-46]▶[16-47] → jumps erratically
```

### 2. Shader Paging Logic Issues
**v0.40.wgsl** (Paged 32-step):
```wgsl
let pageStart = floor(playheadRow / 32.0) * 32.0;  // truncates fractional → sticky pages
localRow = row - pageStart;
if (localRow <0 || >=32) invisible;
```
- Truncation ignores sub-row progress → page holds until *next* integer row.
- Near boundaries (e.g., row 31.9 → 32.0), window snaps late.

**v0.43.wgsl** (Centered 32-step):
```wgsl
patternRowIdx = playheadRow + visRow - 16;  // center @16
```
- Better, but still truncates `playheadRow` (u32 uniform).

**Shared Issue**: `playheadRowFraction` (f32) → `u32` uniform → `floor()` loss.

### 3. RAF vs Audio Timing Drift
- RAF (vsync ~16.67ms) ≠ audio blocks (93ms).
- No interpolation: position stutters.

## Verification Steps
1. **Toggle Engine**: Button shows `⚡ Worklet` vs `🐌 Script`.
   - Script: Perfect sync.
   - Worklet: ~200-500ms lag → playhead trails audio.

2. **Console Logs** (add to `updateUI`):
```js
console.log({
  audioTime: audioContext.currentTime,
  positionSec,
  rowQuery: row,
  rowEst: positionSeconds * rowsPerSecond,
  bufferEst: workletBufferLevel.current / SAMPLE_RATE
});
```

3. **Shader Debug**: Pass `tickOffset` (sub-row frac) → smooth scroll.

## Fixes (Prioritized)

### Quick Fix: Predict Playhead Position
In `useLibOpenMPT` → `updateUI`:
```js
const now = performance.now() / 1000;
const dt = now - lastUpdate.current;
const predictedRow = fractionalRow + dt * rowsPerSecond;
setPlaybackRowFraction(predictedRow);
lastUpdate.current = now;
```
- Compensates lag using `audioContext.currentTime`.

### Better: Worklet Position Reporting
Worklet `port.postMessage({type: 'position', row: currentRow})` every block.
Main interpolates.

### Shader: Fractional Paging
```wgsl
let pageStart = floor(playheadRow - 16.0) * 32.0;  // center-aware
let scrollFrac = fract(playheadRow);
localRow = f32(row) + scrollFrac - pageStart;
```

### Ultimate: Timestamped Scheduling
- Main schedules notes with `audioContext.currentTime + lookahead`.
- Visual predicts from schedule.

## Shader-Specific Bugs
- **v0.40**: Page snap on integer cross → use `fract(playheadRow)` for smooth.
- **v0.43**: Fixed-size 32x32 → dynamic window via uniforms.

## Recommendations
1. **Default to ScriptProcessor** for demos (perfect sync).
2. **Worklet + Prediction** for production (low CPU).
3. **Add uniform `rowFrac: f32`** separate from `rowInt: u32`.

Test with `4-mat_-_space_debris.mod` (repetitive → drift obvious).

---
*Generated: $(date)*