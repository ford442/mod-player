# Native vs JS worklet — informal main-thread cost notes

**Status:** Methodology + recorded JS rows (main-thread cost baseline; **real-WASM vs wasm2js engine** — see the last subsection under *Recorded runs*). The native column needs
an emsdk 3.1.51 host (see *Recorded runs*).  
**Date:** 2026-07-25 (methodology) / 2026-09-18 (recorded rows)  
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
| Audio render | Worklet thread (real-WASM libopenmpt, `libopenmpt-worklet.wasm`) | C++ AudioWorklet / WASM workers |
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

### 2026-09-18 — JS engine: real WASM vs wasm2js

The default JS engine moved from a ~5 MB **wasm2js** libopenmpt to a **real WebAssembly** build of the same
libopenmpt 0.8.4 (`npm run build:js-libopenmpt`; one `libopenmpt-worklet.{js,wasm}` pair shared by worklet, main thread
and parser worker). This is the measured case for that change. **Old** = `HEAD` before the change built in a separate
git worktree; **new** = this tree. Same machine, same Chrome, same module (`4-mat_madness.mod`).

**Correctness first:** rendered PCM is **bit-identical** between the two engines — sha256 of 10 s of
`4-mat_madness.mod` matches at cubic (`95060f38…`) *and* sinc-8 (`de84429b…`) — so the swap is audio-transparent
(`node scripts/bench-js-libopenmpt.mjs --hash --interp 4,8`, once per glue).

#### A. First-play `initLib` in a real browser (`bench-initlib-browser.mjs`)

Headless Chrome (Playwright), fresh browser context per run, `vite preview` on loopback, `?engine=js`, 5 runs each.
Stamps the app's own `[PLAY]` log lines: *fetch* = main thread starts downloading libopenmpt → assets in hand;
*init/load* = `initLib` post + glue eval + wasm instantiate + module create + `loaded` ack.

| Metric (median of 5) | Old — wasm2js 5 MB glue | New — real WASM | Change |
|----------------------|------------------------|-----------------|--------|
| **initLib (fetch → ready)** | **4105 ms** (2750–5579) | **166 ms** (133–251) | **~25× faster** |
| ↳ fetch | 1094 ms | 103 ms | ~11× |
| ↳ init + module load | 3063 ms | 63 ms | ~49× |
| Play click → first `loaded` ack | 4275 ms | 330 ms | ~13× |

Old-engine `initLib` is on a fast desktop with loopback transfer; on a phone or a real network it is far worse. New
numbers are dominated by the 1.7 MB transfer, not compute.

#### B. Render cost per `process()` quantum (`bench-js-libopenmpt.mjs`, Node 24 / V8)

128-frame quanta @ 48 kHz (budget **2.667 ms**), 30 s of audio, first 2 s dropped (tier-up). "p99 % budget" is the
number that matters for glitches. `synthetic N-ch XM` = deterministic looped-16-bit-sample stress module
(`scripts/lib/synth-xm.mjs`) with `N` voices retriggered every row.

| Module | Interp | Old mean (% budget) | Old p99 (% budget) | Old over-budget quanta | New mean (% budget) | New p99 (% budget) | New over-budget quanta |
|--------|--------|---------------------|--------------------|------------------------|---------------------|--------------------|------------------------|
| `4-mat_madness.mod` (4 ch) | cubic (4) | 0.187 ms (7.0%) | 65% | 37 | 0.010 ms (0.4%) | 1.0% | 1 |
| | sinc-8 | 0.154 ms (5.8%) | 30% | 14 | 0.014 ms (0.5%) | 1.3% | 5 |
| synthetic 32-ch XM | cubic (4) | 0.535 ms (20%) | 92% | 90 | 0.032 ms (1.2%) | 3.0% | 0 |
| | sinc-8 | 0.728 ms (27%) | 128% | 136 | 0.057 ms (2.2%) | 10.4% | 6 |
| synthetic 64-ch XM | cubic (4) | 1.064 ms (40%) | 176% | 364 | 0.086 ms (3.2%) | 21.8% | 11 |
| | sinc-8 | 1.367 ms (51%) | 211% | 550 | 0.106 ms (4.0%) | 9.7% | 14 |

(~11 250 quanta per run. The residual "new" over-budget counts and 20–50 ms `max` outliers are dominated by GC of the
harness's per-quantum `Float32Array` views — the processor itself allocates nothing per quantum — and by V8 tiering;
the old engine's outliers are the same effect plus wasm2js JIT deopts.)

**Decision — interpolation:** sinc-8 costs ≈1.2–1.8× cubic on real wasm but is still ~4% of the quantum budget at
64 channels (mean) — roughly an order of magnitude *cheaper than the old engine's cubic* (0.106 vs 1.064 ms). So the JS worklet now defaults to
**Sinc+LP (8)**, matching native's default (A/B quality comparisons are no longer skewed). Because these are desktop
numbers, `?interp=4` (or `localStorage.xasm1_js_interp=4`) remains as an explicit, documented opt-down for weak
devices; the choice survives module reloads.

#### C. Shipped assets and memory

| | Old | New |
|---|-----|-----|
| JS-engine libopenmpt files | `worklets/libopenmpt-audioworklet.js` 4.77 MiB + `libmpt/libopenmptjs.js` 4.77 MiB + `libmpt/libopenmpt.wasm` 1.20 MiB | `worklets/libopenmpt-worklet.js` 101 KiB + `libopenmpt-worklet.wasm` 1.66 MiB (one pair, shared by worklet / main thread / parser worker) |
| `dist/worklets` + `dist/libmpt` (JS engine, excl. native) | ≈ 10.8 MiB | **1.79 MiB** (`verify-bundle-budget`: `js-engine worklets/=1829.9 KiB`, budget 2.5 MiB) |
| Worklet heap after init | **513 MiB** (wasm2js reserves up front) | **32 MiB** (grows on demand, `MAXIMUM_MEMORY` 1 GiB) |
| Native-engine `WebAssembly` | needed a `window.__NATIVE_WEBASSEMBLY__` snapshot (wasm2js replaced the global) | nothing replaces it; snapshot removed |

#### D. Build variants tried

| Variant | wasm size | 64-ch cubic / sinc-8 mean | Verdict |
|---------|-----------|---------------------------|---------|
| wasm exceptions, no SIMD (**shipped**) | 1.66 MiB | 0.070 / 0.099 ms (2 runs) | baseline; corrupt input returns `NULL` |
| + `-msimd128` | 1.78 MiB (+7.6%) | 0.064 / 0.104 ms (2 runs) | **no measurable win** (cubic ~9% faster, sinc-8 ~5% slower — noise-level), +7.6% size, and hard-fails on wasm-SIMD-less browsers (Safari < 16.4) → **not shipped** |
| emsdk 6.0.6 vs pinned 3.1.51 | 1.68 vs 1.66 MiB | identical output (same peak sample) | script works on both; committed pair built with the **3.1.51 pin** |

The build is **byte-reproducible**: a from-scratch rebuild (clean tree) with the pinned emsdk gave identical sha256 for
glue and wasm, no absolute paths are embedded, and the vendored sources equal the upstream tarball — which is why CI
(`js-libopenmpt-rebuild`) can fail on drift.

**Won't-measure (with reasons):** (1) real AudioWorklet render timing on a phone / low-end laptop — no such device in
this environment; the browser run above only has the worklet's own `?audioDiag=1` counters at 1 ms `Date.now()`
granularity (old: 4.1% of quanta flagged, max 149 ms, at cubic; new: 1.1%, max 31 ms, at **sinc-8**), which
corroborates direction but is too coarse to tabulate. (2) Node/V8 ≠ Chrome's audio thread: treat section B as
*relative* (old vs new, cubic vs sinc), not absolute. (3) The auto audio-lite threshold (`> 16` channels) in the
processor was tuned for wasm2js and could likely be raised now; left unchanged because it alters visuals and needs its
own before/after.

Reproduce:

```bash
node scripts/bench-js-libopenmpt.mjs --synth-xm 64 --interp 4,8 --seconds 30          # B, new
node scripts/bench-js-libopenmpt.mjs --glue <old-glue.js> --synth-xm 64 ...          # B, old (wasm2js auto-detected)
npx vite preview --outDir <dist> --port 4173 --host 127.0.0.1 &                     # A
BASE_URL=http://127.0.0.1:4173 RUNS=5 node scripts/bench-initlib-browser.mjs
```

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
