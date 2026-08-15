# Native vs JS worklet — informal main-thread cost notes

**Status:** Methodology + expected shape (run locally after `npm run build:emcc`).  
**Date:** 2026-07-25  
**Fixture:** Prefer a large multi-channel IT (e.g. 16+ channels). Do not commit multi‑MB modules; use a local file or downloadable test asset.

## Goal

Compare **main-thread** cost of the native C++ engine vs the production JS AudioWorklet on the same module — not audio quality. Production default remains JS until native clears sync + reliability bars.

## Method (manual)

1. Build native artifacts: `npm run build:emcc` (emsdk 3.1.50).
2. `npm run preview` (or `dev`) with COOP/COEP so SharedArrayBuffer works.
3. Load the same large IT twice in separate sessions:
   - Native: `?engine=native` (or leave `auto` with artifacts present)
   - JS: `?engine=js`
4. Play ~30–60 s from the same order/row; keep the visualizer on (WebGL2 is fine: `?renderer=webgl2`).
5. Record:

| Metric | How to capture |
|--------|----------------|
| Load → first audible sample | Performance panel / console timestamps around `load` + `play` |
| Position update rate | JS: `position` messages/s (DevTools Performance or temporary counter). Native: successful `pollPositionOnce` emits/s (~60 Hz target) |
| RAF `updateUI` slice | Chrome Performance → Main → `updateUI` / Animation frame duration |
| Long tasks | Performance long-task attribution if available |
| Peak JS heap | Memory panel after 60 s play |

Optional debug hook (future): expose `window.__ENGINE_BENCH__` with poll/message counters — not required for this note.

## Expected shape (qualitative)

| Aspect | JS worklet | Native |
|--------|------------|--------|
| Audio render | Worklet thread (wasm2js libopenmpt) | C++ AudioWorklet / WASM workers |
| Position to main | `postMessage` every quantum (~350 Hz possible; UI applies ~as received) | Shared-memory poll ~16 ms (~60 Hz) |
| Main-thread decode of position | Message handler + shared `applyNormalizedPosition` | Poll + same apply path |
| projectM PCM chunks | Yes (`projectm-pcm`) | No — Analyser / ring bridge only |
| Dual AudioContext | No | Yes (capture blocked — see `docs/EXPORT.md`) |

Native should typically show **lower main-thread message overhead** (poll vs high-rate postMessage) and **higher one-time init cost** (glue + wasm compile). Large ITs stress pattern extract / matrix packing more than the engine apply path.

## Results template

Fill in after a local run (example placeholders):

| Metric | JS (`?engine=js`) | Native (`?engine=native`) |
|--------|-------------------|---------------------------|
| Module | _(name / channels / patterns)_ | same |
| Load → first audio (ms) | | |
| Position updates/s | | |
| Median RAF updateUI (ms) | | |
| Long tasks >50 ms (count / 60 s) | | |
| Notes | | |

## Acceptance for epic #09

- [x] Methodology documented
- [x] Harness: `npm run bench:engine` → `artifacts/engine-bench/`
- [ ] Numbers filled from at least one large-IT local run (operator) — **not a release gate**

CI does **not** gate on this benchmark. A/V parity is gated by `smoke:playhead:native` (path-filtered + scheduled). This note is DX/perf awareness only; do not flip defaults on vibes alone.

### Quick harness (default module)

```bash
npm run build:emcc   # when comparing native
npm run preview -- --port 4173 &
npm run bench:engine
# → artifacts/engine-bench/report.json (median getPlayheadDebug ms per engine)
```

Paste results into the table above after a local run on a large IT when available.
