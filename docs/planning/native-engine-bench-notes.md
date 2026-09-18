# Native vs JS worklet — informal main-thread cost notes

**Status:** Methodology + one recorded JS baseline row. The native column needs
an emsdk 3.1.51 host (see *Recorded runs*).  
**Date:** 2026-07-25 (methodology) / 2026-09-18 (first recorded row)  
**Fixture:** Prefer a large multi-channel IT (e.g. 16+ channels). Do not commit multi‑MB modules; use a local file or downloadable test asset.

## Goal

Compare **main-thread** cost of the native C++ engine vs the production JS AudioWorklet on the same module — not audio quality. Production default remains JS until native clears sync + reliability bars.

## Method (manual)

1. Build native artifacts: `npm run build:emcc` (emsdk 3.1.51).
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
| projectM PCM chunks | Yes (`projectm-pcm`) | Yes (ring copy → `broadcastPcmBlock`) |
| Dual AudioContext | No | No — both attach to the one `utils/audioContextFactory.ts` context |

Native should typically show **lower main-thread message overhead** (poll vs high-rate postMessage) and **higher one-time init cost** (glue + wasm compile). Large ITs stress pattern extract / matrix packing more than the engine apply path.

## Recorded runs

### 2026-09-18 — default module, headless Chromium (CI-style container)

`npm run build && npm run preview -- --port 4173 && npm run bench:engine`,
`PLAY_MS=4000`, 241 samples, `?renderer=webgl2&lite=0`.

| Metric | JS (`?engine=js`) | Native (`?engine=native`) |
|--------|-------------------|---------------------------|
| Module | default bundled module (not a large IT) | — |
| Observed engine | `worklet` | not run |
| Median `getPlayheadDebug` (ms) | **0.005** | — |
| Mean / max (ms) | 0.005 / 0.035 | — |
| Notes | Playhead read is free at this module size — the RAF budget is spent elsewhere (pattern packing, GPU upload), so this row is a floor, not a comparison. | `nativeArtifactsPresent: false` |

The native column is blank because `public/worklets/openmpt-native.*` is a
gitignored build artifact and the recording host had no **emsdk 3.1.51**, which
`npm run build:emcc` requires. The harness detects this and skips the native leg
rather than reporting a bogus row.

**Won't-measure (native column), with the reason:** a native-vs-JS row cannot be
produced anywhere the toolchain is absent — that includes the default CI job and
any container without emsdk. It needs an operator (or a job that installs emsdk
3.1.51) to run `npm run build:emcc` first, on a large IT rather than the default
module. Until someone with that setup records one, the native column stays empty
on purpose; it is **not** a release gate and nothing should wait on it.

To add a row: run the command above with a large multi-channel IT loaded, and
paste the numbers from `artifacts/engine-bench/report.json` into a new dated
subsection.

## Acceptance for epic #09

- [x] Methodology documented
- [x] Harness: `npm run bench:engine` → `artifacts/engine-bench/`
- [x] At least one recorded row (JS baseline, 2026-09-18 above)
- [ ] Native column — **won't-measure without emsdk 3.1.51**; operator-filled, not a release gate

Harness: `npm run bench:engine` compares JS postMessage vs native poll. After a large-IT run, paste median `getPlayheadDebug` / load→audio into a new dated subsection above. Default-module smoke is enough to keep the script green; large-IT numbers remain operator-filled.

CI does **not** gate on this benchmark. A/V parity is gated by `smoke:playhead:native` (path-filtered + scheduled). This note is DX/perf awareness only; do not flip defaults on vibes alone.

### Quick harness (default module)

```bash
npm run build:emcc   # when comparing native
npm run preview -- --port 4173 &
npm run bench:engine
# → artifacts/engine-bench/report.json (median getPlayheadDebug ms per engine)
```

Add a dated subsection under *Recorded runs* after a local run on a large IT when available.
