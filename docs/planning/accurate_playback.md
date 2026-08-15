# Accurate Playback: A/V playhead sync

## Problem Summary
- **ScriptProcessor**: position query runs in the same `onaudioprocess` callback that renders audio → inherently tight A/V sync.
- **AudioWorklet** (historical): main-thread pumps / integer row polling / non-negative extrapolation left the visual playhead **~200–500 ms** behind (or ahead of) the ear, depending on buffer depth and latency handling.
- **Visual effect**: circular/paged shaders trail the music; page boundaries jump late when `playheadRow` is truncated to `u32`.

**Status (2026-07-25):** The prediction pipeline below closes the historical gap. Headless acceptance on `4-mat_madness.mod` @ 125 BPM (worklet, `patternv0.44.wgsl`, webgl2) measured **median |predictionLagRows| ≈ 0.44** (max ≈ 1.09 rows, steady-state after 1.5 s warmup) — well under the 1-row (~120 ms) budget. The old ~200–500 ms lag is no longer observed on the worklet path when prediction + f32 uniforms are active.

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
5. postMessage({ type:'position',         4. Light EMA (α=0.98); snap if |Δ|>0.5
     row, rowFraction, audioTime, … })       (same order) or >1.0 (order change)
                                          5. playbackStateRef.playheadRow (f32)
                                          6. GPU uniforms: playhead as f32
```

**ScriptProcessor path is unchanged**: still queries `_openmpt_module_get_current_*` on the SP/render path with no prediction.

**Native C++ worklet** (optional rebuild): `PositionInfo` includes pre-render `audioFramesRendered`, `rowFraction`, `speed`, `sampleRate`. Main thread maps the frame clock onto heard-time via `utils/nativeClockAnchor.ts` (C++ zeros frames on load/seek; TS re-anchors at `frameSecondsAtAnchor=0`). Same `playheadPrediction` path as JS.

## Root causes addressed

| Cause | Fix |
|-------|-----|
| Integer row only | Worklet sends `rowFraction` from time-at-position markers |
| Post-render position vs start-of-quantum clock | Snapshot **before** `read_float_stereo`, tag `audioTime = currentTime` |
| `dt ≥ 0` clamp ignored output latency | Allow bounded **negative** dt so playhead can sit slightly behind a fresh sample |
| Heavy visual smoothing | Worklet EMA α = **0.98**; snap when \|Δ\| > 0.5 row (same order) or > 1 row (order change) |
| `playheadRow` as `u32` in paged shaders | `usesPlayheadRowAsFloat` for all v0.2x–v0.6x production shaders |

## Measurement method

### A. Automated unit tests (CI / local, no browser)

```bash
npm run test:playhead          # focused
npm test                       # includes tests/playheadPrediction.test.ts + tests/circularPaging.test.ts
```

Asserts:
- Forward extrapolation math
- **Negative dt** (latency back-extrapolation)
- At 125 BPM, 30 ms device latency ⇒ **< 1 row** of pure latency offset
- Quantum step (128/44100 × rows/sec) ≪ 1 row
- Circular paging helpers (`circularPageStart`, `overlayActualRow`)

### B. Browser acceptance (local)

```bash
npm run preview -- --port 4173 &
npm run smoke:playhead
# report → artifacts/playhead-acceptance/report.json
```

| Scenario | Shader | Checks |
|----------|--------|--------|
| Square lag | `patternv0.44.wgsl` | Worklet `predictionLagRows` median < 1 row (steady-state) |
| Circular paging | `patternv0.46.wgsl` | `pageStart ≥ 64` at playhead ≥ 64; paging oracle mismatches confirm paged fetch |

**Measured (2026-07-25, headless Chrome, preview build):**

| Metric | Square v0.44 | Circular v0.46 |
|--------|--------------|----------------|
| Engine | worklet | worklet |
| Median \|lagRows\| | 0.44 | (lag not sampled — GPU-heavy shader starves RAF in headless) |
| Max \|lagRows\| | 1.09 | — |
| Pass ratio (≥1.5 s warmup) | 97% | paging boundary OK |

### C. Manual browser checklist (sign-off)

| Step | Pass? |
|------|-------|
| Chrome, **worklet** engine (not ScriptProcessor fallback) | ☐ |
| `localStorage.xasm1_playhead_debug = '1'` → 🔍 panel shows `lagRows` near 0 while playing | ☐ |
| **Circular** shader (v0.45–v0.50): page flip at row 64 aligns with note attack | ☐ |
| **Square** shader (e.g. v0.44): playhead advances smoothly (f32 uniform) | ☐ |
| ScriptProcessor fallback still tight; worklet remains default | ☐ |

### D. Debug telemetry

Enable in production:

```js
localStorage.xasm1_playhead_debug = '1';
// reload — also auto-enabled in Vite dev (import.meta.env.DEV)
```

Surfaces:
- **🔍 PatternDisplay debug panel** — `sampleRow`, `predictedRow`, `smoothedRow`, `lagRows`, `driftMs`, `mode`
- **3D studio HUD** — same fields under Audio Engine
- **`window.__PLAYHEAD_DEBUG__`** — live snapshot every RAF when debug enabled
- **`window.__TEST_HOOKS__.getPlayheadDebug()`** — Playwright / CI hook

Console sampler:

```js
(() => {
  const start = performance.now();
  const samples = [];
  const id = setInterval(() => {
    const s = window.__PLAYHEAD_DEBUG__;
    if (s) samples.push({ ...s, t: performance.now() - start });
    if (performance.now() - start > 2000) {
      clearInterval(id);
      console.table(samples);
    }
  }, 50);
})();
```

### E. Engine comparison

| Mode | How | Expected |
|------|-----|----------|
| ScriptProcessor | Force SP fallback or disable worklet | Sync already tight; **must not regress** |
| JS Worklet | Default path (`?engine=js` or no native artifacts) | Lag **≤ ~1 row** at 125 BPM / speed 6; measured median ≈ **0.44** (2026-07-25) |
| Native worklet | After `npm run build:emcc`, `?engine=native` / `npm run smoke:playhead:native` | Same prediction path + frame clock + main-context anchor; **same lag budget** (median \|lagRows\| &lt; 1). Soft-fail to JS does **not** count as parity. |

**Native acceptance commands:**

```bash
npm run build:emcc
npm run preview -- --port 4173 &
npm run smoke:playhead:native
# report → artifacts/playhead-acceptance/report-native.json
# CI: path-filtered native-full-build + weekly native-wasm-scheduled.yml
```

Record measured native median/max from the latest green `report-native.json` below when available (do not invent numbers):

| Metric | JS (reference) | Native |
|--------|----------------|--------|
| Fixture | `4-mat_madness.mod` @ 125 BPM | same |
| Shader / renderer | `patternv0.44.wgsl` / webgl2 | same |
| Median \|lagRows\| | ≈ 0.44 (2026-07-25) | *(fill from CI/local report-native.json)* |
| Max \|lagRows\| | ≈ 1.09 | *(fill from report)* |
| Active engine asserted | `worklet` | **must be** `native-worklet` |

**Rule of thumb at 125 BPM** (4 rows/beat):  
`rows/sec ≈ 8.33` → **1 row ≈ 120 ms**.  
Acceptance: visual lag ≤ ~120 ms (≤ 1 row), typically **< 0.5 row** after prediction in steady state.

**Main-thread contract (do not regress):**
- Worklet `position` handlers must **not** call React `setState` (especially `setModuleInfo`) — samples update refs only (~350 Hz).
- `updateUI` writes fractional playhead to `playbackStateRef` every RAF; React UI state updates only on integer row/order/BPM changes (and throttled sync HUD).
- RAF loop must reschedule via `updateUIRef`, never a closed-over `updateUI` identity.
- GPU renderers read `playbackStateRef` / `channelStatesRef` each frame.

## Key files

| File | Role |
|------|------|
| `public/worklets/openmpt-worklet.js` | Pre-render snapshot, `rowFraction`, `audioTime` |
| `utils/playheadPrediction.ts` | `predictPlayheadFromSample`, latency-aware dt, sample apply |
| `hooks/useLibOpenMPT.ts` | RAF `updateUI` prediction + light EMA |
| `hooks/useAudioGraph.ts` | Forwards `rowFraction` / `audioTime` from worklet messages |
| `tests/playheadPrediction.test.ts` | Vitest math regression (CI via `npm test`) |
| `scripts/playhead-acceptance.mjs` | Browser lag + paging acceptance (`npm run smoke:playhead`) |
| `utils/gpuPacking.ts` + `shaderVersion.ts` | f32 playhead uniform for paged/circular shaders |
| `cpp/openmpt_wrapper.*` / `worklet_processor.cpp` | Shared-memory frame clock + rowFraction; reset frames on load/seek |
| `utils/nativeClockAnchor.ts` / `nativeParityGate.ts` | Map native frames → heard-time; gate auto-prefer |
| `utils/workletPositionAdapter.ts` | Unified JS + native → `applyWorkletPositionSample` |

## Prevention

- Bump `WORKLET_VERSION` in `useWorkletLoader.ts` when the worklet changes (currently **v4**).
- Do not reintroduce `dt = max(0, …)` without latency compensation.
- Worklet position handlers must **not** overwrite `noteAge` with integer row — `updateUI` owns fractional ages.
- Worklet position handlers must **not** call React `setState` (no `setModuleInfo` / BPM UI at quantum rate).
- GPU renderers read `channelStatesRef` each frame (not stale React `channelStates` state).
- Keep ScriptProcessor as the reference sync path; never run prediction on it.
- Prefer self-hosted worklet assets; see `public/worklets/README.md`.

---
*Updated: 2026-07-25 — Vitest playhead tests, debug HUD, smoke:playhead acceptance, measured lag evidence*
