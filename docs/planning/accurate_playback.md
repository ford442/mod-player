# Accurate Playback: A/V playhead sync

## Problem Summary
- **ScriptProcessor**: position query runs in the same `onaudioprocess` callback that renders audio → inherently tight A/V sync.
- **AudioWorklet** (historical): main-thread pumps / integer row polling / non-negative extrapolation left the visual playhead **~200–500 ms** behind (or ahead of) the ear, depending on buffer depth and latency handling.
- **Visual effect**: circular/paged shaders trail the music; page boundaries jump late when `playheadRow` is truncated to `u32`.

## Architecture (current)

```
AudioWorklet process()                    Main thread RAF (updateUI)
─────────────────────                     ──────────────────────────
1. Snapshot libopenmpt position           1. Read last WorkletPositionSample
   *before* read_float_stereo                (fractional row + audioTime)
2. Tag audioTime = currentTime            2. heardTime = currentTime
   (timeline of first sample of quantum)      − baseLatency − outputLatency
3. Compute rowFraction via                3. playhead = sample.row
   get_time_at_position(row, row+1)            + (heardTime − sample.workletTime)
4. Render quantum                              × rowsPerSecond
5. postMessage({ type:'position',         4. Light EMA (α=0.94); snap if |Δ|>1
     row, rowFraction, audioTime, … })    5. playbackStateRef.playheadRow (f32)
                                          6. GPU uniforms: playhead as f32
```

**ScriptProcessor path is unchanged**: still queries `_openmpt_module_get_current_*` on the SP/render path with no prediction.

**Native C++ worklet** (optional rebuild): `PositionInfo` includes `audioFramesRendered`, `rowFraction`, `speed`, `sampleRate` for shared-memory sample clocks. Polling still uses prediction between updates.

## Root causes addressed

| Cause | Fix |
|-------|-----|
| Integer row only | Worklet sends `rowFraction` from time-at-position markers |
| Post-render position vs start-of-quantum clock | Snapshot **before** `read_float_stereo`, tag `audioTime = currentTime` |
| `dt ≥ 0` clamp ignored output latency | Allow bounded **negative** dt so playhead can sit slightly behind a fresh sample |
| Heavy visual smoothing | Worklet EMA α = **0.94**; snap when \|Δ\| > 1 row |
| `playheadRow` as `u32` in paged shaders | `usesPlayheadRowAsFloat` for all v0.2x–v0.6x production shaders |

## Measurement method

### A. Automated (CI / local, no browser)

```bash
npm run test:playhead
# or: node utils/__debug__/playheadPrediction.test.cjs
```

Asserts:
- Forward extrapolation math
- **Negative dt** (latency back-extrapolation)
- At 125 BPM, 30 ms device latency ⇒ **&lt; 1 row** of pure latency offset
- Quantum step (128/44100 × rows/sec) ≪ 1 row

### B. Manual browser check (acceptance)

1. Load a steady-tempo module (e.g. `4-mat` / any 125 BPM MOD) in **Chrome**.
2. Ensure engine is **⚡ Worklet** (not ScriptProcessor fallback).
3. Open debug panel (🔍) → note `driftMs`, `bufferMs`, `row`.
4. Watch a **circular / paged** shader (v0.45–v0.50): page flips should land on note attacks, not ~¼ s late.
5. Optional console (DevTools) while playing:

```js
// Paste once; samples ~2s of prediction vs sample row
(() => {
  const start = performance.now();
  const samples = [];
  const id = setInterval(() => {
    const s = window.__PLAYHEAD_DEBUG__; // see below if exposed
    if (s) samples.push({ ...s, t: performance.now() - start });
    if (performance.now() - start > 2000) {
      clearInterval(id);
      console.table(samples);
    }
  }, 50);
})();
```

Optional: set `localStorage.xasm1_playhead_debug = '1'` and use the sync debug HUD (`driftMs` should stay small once rolling).

### C. Engine comparison

| Mode | How | Expected |
|------|-----|----------|
| ScriptProcessor | Force SP fallback or disable worklet | Sync already tight; **must not regress** |
| JS Worklet | Default path | Lag **≤ ~1 row** at 125 BPM / speed 6 |
| Native worklet | After `npm run build:emcc` | Same prediction path + frame clock fields |

**Rule of thumb at 125 BPM** (4 rows/beat):  
`rows/sec ≈ 8.33` → **1 row ≈ 120 ms**.  
Acceptance: visual lag ≤ ~120 ms (≤ 1 row), typically much less after prediction.

## Key files

| File | Role |
|------|------|
| `public/worklets/openmpt-worklet.js` | Pre-render snapshot, `rowFraction`, `audioTime` |
| `utils/playheadPrediction.ts` | `predictPlayheadFromSample`, latency-aware dt, sample apply |
| `hooks/useLibOpenMPT.ts` | RAF `updateUI` prediction + light EMA |
| `hooks/useAudioGraph.ts` | Forwards `rowFraction` / `audioTime` from worklet messages |
| `utils/gpuPacking.ts` + `shaderVersion.ts` | f32 playhead uniform for paged/circular shaders |
| `cpp/openmpt_wrapper.*` / `worklet_processor.cpp` | Shared-memory frame clock + rowFraction (native rebuild) |

## Prevention

- Bump `WORKLET_VERSION` in `useWorkletLoader.ts` when the worklet changes (currently **v4**).
- Do not reintroduce `dt = max(0, …)` without latency compensation.
- Worklet position handlers must **not** overwrite `noteAge` with integer row — `updateUI` owns fractional ages.
- GPU renderers read `channelStatesRef` each frame (not stale React `channelStates` state).
- Keep ScriptProcessor as the reference sync path; never run prediction on it.
- Prefer self-hosted worklet assets; see `public/worklets/README.md`.

---
*Updated: 2026-07-10 — predictive playhead foundation*
