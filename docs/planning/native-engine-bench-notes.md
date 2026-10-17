# Native vs JS worklet — informal main-thread cost notes

**Status:** Methodology + recorded JS rows (main-thread cost baseline; **real-WASM vs wasm2js engine**) + the
**native column (2026-10-17, #491 Phase 3)** — CPU per quantum, real-AudioWorklet underruns, load latency and heap,
measured in CI. Decision: [`docs/ADR-native-engine.md`](../ADR-native-engine.md) (retire the native audio path).  
**Date:** 2026-07-25 (methodology) / 2026-09-18 (JS rows) / 2026-10-17 (native column)  
**Fixture:** Prefer a large multi-channel IT (e.g. 16+ channels). Do not commit multi‑MB modules; use a local file or downloadable test asset.

## Goal

Compare **main-thread** cost of the native C++ engine vs the production JS AudioWorklet on the same module — not audio quality. Production default remains JS until native clears sync + reliability bars.

## Method (manual)

1. Build native artifacts: `npm run build:emcc` (emsdk 3.1.51).
2. `npm run preview` (or `dev`) with COOP/COEP so SharedArrayBuffer works.
3. Load the same large IT twice in separate sessions:
   - Native: `?engine=native` (or leave `auto` with artifacts present)
   - JS: `?engine=js`
4. Play ~30–60 s from the same order/row; keep the visualizer on (`?renderer=webgpu`; `bench:engine` uses this).
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
`PLAY_MS=4000`, 241 samples, `?renderer=webgpu&lite=0` (recorded as `?renderer=webgl2`, which was a silent no-op → WebGPU until WebGL2 became opt-in only in #462 — same backend, so the baseline still holds).

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

### 2026-10-17 — native column: JS vs native engine (#491 Phase 3)

Both engines in their #491 state (libopenmpt 0.8.9, the shared `scripts/lib/wasm-flags.sh` set, Sinc+LP default).
Measured by CI's `native-full-build` job on every native change (informational step, `engine-bench` artifact), with
two harnesses that replace the manual method above:

- `npm run bench:engine-cpu` (`scripts/bench-engines.mjs`): the compiled JS processor and `NativeEngine::process()`
  (built for Node by `npm run build:native-bench`) on the same V8. Reports CPU per quantum, parse time and heap.
- `npm run bench:engine-glitches` (`scripts/bench-engines-browser.mjs`): both engines on the real AudioWorklet in
  headless Chromium. Reports `AudioContext.playbackStats` underruns (steady, track change, a 16 MiB upload), time until
  the module is ready and main-thread time blocked.

CI, commit `3c25b71` (Node 22.23.3), median of 3 interleaved rounds:

| module | interp | JS p50 ms | native p50 ms | native / JS | JS load ms | native load ms | JS heap MiB | native heap MiB |
|---|---|---|---|---|---|---|---|---|
| synthetic 64-ch IT | 8 | 0.0635 | 0.0611 | 0.96 | 14.5 | 5.1 | 32 | 128 |
| synthetic 64-ch IT | 4 | 0.0383 | 0.0372 | 0.97 | 18.8 | 9.0 | 32 | 128 |
| synthetic 32-ch XM | 8 | 0.0329 | 0.0306 | 0.93 | 12.4 | 3.0 | 32 | 128 |
| synthetic 32-ch XM | 4 | 0.0207 | 0.0191 | 0.92 | 15.9 | 6.1 | 32 | 128 |
| 4-mat_madness.mod (4 ch) | 8 | 0.0068 | 0.0047 | 0.69 | 12.2 | 2.5 | 32 | 128 |
| 4-mat_madness.mod (4 ch) | 4 | 0.0054 | 0.0034 | 0.63 | 15.3 | 5.5 | 32 | 128 |

| real AudioWorklet (headless Chromium) | JS, `'playback'` | native, `'playback'` | JS, `'interactive'` | native, `'interactive'` |
|---|---|---|---|---|
| steady underruns / min, 64-ch IT | 0 | 0 | 0 | 0 |
| underruns per track change | 0 | 0 | 0 | 0 |
| load → module ready, ms | 10.5 | 5.4 | 18.2 | 5.2 |
| main thread blocked by the load call, ms | 0.0 | 5.4 | 0.1 | 5.2 |
| 16.1 MiB IT: underruns per change / ready ms | 0 / 12.7 | 0 / 13.3 | 0 / 30.3 | 0 / 13.3 |

- **Native's real advantage is where the parse runs.** JS parses on the audio thread: 22.2 ms for the 16 MiB IT in
  CI. Native parses on the main thread, 10.4 ms.
- **The browser zeros have a floor.** Headless Chromium's fake output device reports 42 ms of latency even at
  `'interactive'`, so they don't cover a real 10 ms device buffer.
- **Native's cost is memory.** It reserves a fixed 128 MiB and cannot load a module over about 32 MiB, because
  `load_module` probes for 4× the file size. The JS heap grows on demand.
- **On heavy modules the CPU gap is 3–11 % across three CI runs**, at most 0.0025 ms of the 2.667 ms budget. Under
  #491's ~10 % rule that means **retire native**. The reasoning and the revisit triggers are in
  [`docs/ADR-native-engine.md`](../ADR-native-engine.md).

## Acceptance for epic #09

- [x] Methodology documented
- [x] Harness: `npm run bench:engine` → `artifacts/engine-bench/`
- [x] At least one recorded row (JS baseline, 2026-09-18 above)
- [x] Native column — 2026-10-17 (#491 Phase 3), measured in CI; decision in `docs/ADR-native-engine.md`

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
