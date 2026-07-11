# Native C++ Engine Platform Epic

**Status:** Planning (P2–P3)  
**Depends on (done):** dual-build hygiene (`openmpt-native.*` vs `openmpt-worklet.js`), playhead prediction foundation  
**Last audited:** 2026-07-11  

---

## 1. Context

The C++/Emscripten engine exists end-to-end:

| Layer | Path | Notes |
|-------|------|--------|
| C++ core | `cpp/openmpt_wrapper.*`, `cpp/worklet_processor.cpp` | libopenmpt render + `PositionInfo` shared memory |
| Build | `scripts/build-wasm.sh` → `npm run build:emcc` | emsdk **3.1.50**, outputs `openmpt-native.{js,wasm,aw.js}` |
| TS wrapper | `audio-worklet/OpenMPTWorkletEngine.ts` | Dynamic import of glue; polls `_poll_position` |
| Ring bridge | `public/worklets/native-bridge-processor.js` | SAB ring → main-thread graph |
| Main hook | `hooks/useLibOpenMPT.ts` + `useAudioGraph.ts` | Probe → prefer native when glue present |

**Production default remains the JS worklet** (`openmpt-worklet.js` + wasm2js `libopenmpt-audioworklet.js`). Native artifacts are **gitignored** and only appear after a local or CI build.

---

## 2. Goals (epic)

1. Make `npm run build:emcc` **reliable and fast on CI** (cache `libopenmpt.a` / vendor tree).
2. **Progressive enhancement:** if `openmpt-native.js` is present and valid, prefer it (with an explicit override to force JS).
3. **Unify position / VU / PCM reporting** with the JS worklet message *schema* so `useLibOpenMPT` / `useAudioGraph` share one apply path.
4. **Benchmark** main-thread cost of native vs JS worklet on large ITs.
5. **Review emcc flags:** INITIAL_MEMORY, growth, MAXIMUM_MEMORY, EXPORT list completeness, debug ASSERTIONS job.

---

## 3. Acceptance criteria (checklist)

| Criterion | Current | Target |
|-----------|---------|--------|
| CI publishes **or** verifies native build | Weekly schedule publishes artifacts; PR only script/export smoke | PR path: verify (cached rebuild when cpp/scripts change). Schedule: full build + artifact. Optional: debug ASSERTIONS job |
| Feature flag / auto-detect documented | Auto-detect + prefer exists in code; weak docs; **no force-JS flag** | Document precedence + `localStorage` / URL / query override; update `public/worklets/README.md` + AGENTS |
| A/V sync ≥ JS worklet (post-prediction) | Native has `rowFraction` / frame clock + prediction, but clock is **poll-tagged** with main `AudioContext.currentTime`, not quantum `audioTime` | Native samples carry sample-accurate clock; `test:playhead` + manual checklist pass on native |
| No filename collision with JS worklet | **Done** — `openmpt-native.*` only; build refuses clobber | Keep guards + scheduled integrity check |

---

## 4. Current-state audit

### 4.1 Dual-build hygiene (done)

- Output basename hard-coded `openmpt-native`.
- Pre/post `cksum` of tracked `openmpt-worklet.js`; fail if changed.
- Sniff that tracked file still contains `AudioWorkletProcessor` / `registerProcessor`.
- Stray `openmpt-worklet.wasm` cleaned post-build.
- `npm run verify:native-exports` compares `EXPORTED_FUNCTIONS` ↔ C++ `EMSCRIPTEN_KEEPALIVE` ↔ TS usage.
- Docs: `docs/WASM_BUILD_SOLUTIONS.md`, `public/worklets/README.md`, AGENTS/CLAUDE.

### 4.2 CI today

| Workflow | What runs |
|----------|-----------|
| `ci.yml` → `wasm-smoke-test` | emsdk 3.1.50, script safety greps, `verify:native-exports`, `bash -n`, JS worklet guard. **No full emcc link.** |
| `native-wasm-scheduled.yml` | Full `npm run build:emcc`, artifact upload (14d), JS integrity. **No libopenmpt.a cache.** |

Gap: every scheduled run rebuilds libopenmpt from source (~minutes). PR never proves the full link succeeds.

### 4.3 Progressive enhancement today

```
INIT:
  isNativeGlueAvailable(openmpt-native.js)
    → createOpenMPTModule factory present
    → not an AudioWorkletProcessor script
  if ok: OpenMPTWorkletEngine.init() → setActiveEngine('native-worklet')
  else: JS worklet path
```

- **Prefer-when-present is already implemented.**
- Engine toggle exists at runtime (`toggleAudioEngine`: native ↔ JS).
- Missing: durable **force JS** (`?engine=js` / `localStorage.xasm1_audio_engine=js`) for debugging without deleting artifacts.
- Missing: single source of truth doc for precedence (probe → flag → fallback).

### 4.4 Position / VU / PCM schema (not unified)

**JS worklet** (`openmpt-worklet.js`) posts every quantum:

```js
{ type: 'position',
  order, row, rowFraction, positionSeconds, bpm, speed,
  audioTime, workletTime, samplesWritten, sampleRate, channelVU[] }

{ type: 'projectm-pcm', buffer, channels, sampleRate, samplesPerChannel }
```

**Native** path:

- C++ writes `PositionInfo` (shared memory); TS polls ~16 ms and emits `position` events as `WorkletPositionData` (`currentOrder`/`currentRow` naming).
- `useAudioGraph` maps to `applyWorkletPositionSample` with `workletTime = data.workletTime ?? ctx.currentTime` — **main-thread clock**, not pre-render quantum time.
- Extended fields (`audioFramesRendered`, `rowFraction`, `speed`, `sampleRate`) exist in C++ after rebuild.
- **No `projectm-pcm`** from native; oscilloscope/projectM rely on AnalyserNode / MediaStream bridge instead of authentic WASM PCM chunks.

Implication: two adapters in `useAudioGraph` (message handler vs `engine.on('position')`). Unification goal is a **single normalized sample type** + optional PCM tap adapter, not necessarily postMessage from C++.

### 4.5 A/V sync (partial)

| Capability | JS worklet | Native |
|------------|------------|--------|
| Pre-render row snapshot | Yes | fillPositionInfo each quantum (post-render row is still current) |
| `rowFraction` via time-at-position | Yes | Yes (`openmpt_wrapper.cpp`) |
| Quantum `audioTime` | Yes (`currentTime` in process) | **Missing** — poll uses main ctx time |
| Frame clock | `samplesWritten` + rate | `audioFramesRendered` + `sampleRate` |
| Main prediction | `playheadPrediction.ts` | Same apply path once sample is shaped |

Acceptance requires tagging native samples with a clock that prediction can trust (prefer `audioFramesRendered/sampleRate` as primary, or stash quantum audio time in `PositionInfo`).

### 4.6 emcc flags (as of `scripts/build-wasm.sh`)

| Flag | Value | Assessment |
|------|-------|------------|
| `INITIAL_MEMORY` | 32 MiB (`33554432`) | Reasonable for module+heap; large ITs grow via growth |
| `ALLOW_MEMORY_GROWTH` | 1 | Required |
| `MAXIMUM_MEMORY` | 512 MiB (`536870912`) | **Present** (epic brief was stale if it said “missing”) |
| `STACK_SIZE` | 128 KiB | OK for quantum stack temps |
| `AUDIO_WORKLET` + `WASM_WORKERS` | 1 | Required for C++ worklet thread |
| `MODULARIZE` / `EXPORT_NAME` | `createOpenMPTModule` | Matches TS import |
| `EXPORTED_FUNCTIONS` | init/load/seek/poll/ring/pattern… | Audited by `verify:native-exports` |
| `EXPORTED_RUNTIME_METHODS` | ccall, cwrap, UTF8ToString, getValue, setValue | Confirm if `emscriptenGetAudioObject` needs explicit export (may be auto with AUDIO_WORKLET) |
| Release | `-O3 -DNDEBUG` | Default |
| `--debug` | `-O0 -g -sASSERTIONS=2` | Local only today |
| `--safe-heap` | `SAFE_HEAP=1` | Local only |

**Actionable gaps:** CI job for `--debug` (or ASSERTIONS=1 release smoke), document MAXIMUM_MEMORY rationale, optional `ASSERTIONS=1` on weekly release build without full `-O0`.

### 4.7 Benchmarks

- `scripts/benchmark_loadFromURL.cjs` exists for load path, not engine main-thread cost.
- No headless/Playwright harness comparing native vs JS RAF/`updateUI` / GC / message rate on large ITs.

---

## 5. Design

### 5.1 CI: reliable build + cache `libopenmpt.a`

**Strategy: cache the expensive static library; always re-link thin C++ when sources change.**

Cache key (suggested):

```
libopenmpt-a-${{ runner.os }}-emsdk-3.1.50-v0.8.4-static1-${{ hashFiles('scripts/build-wasm.sh') }}
```

Cached paths:

- `vendor/libopenmpt-0.8.4+release/bin/libopenmpt.a` (and include tree if needed)
- or entire `vendor/libopenmpt-0.8.4+release/` after first successful make

Workflow changes:

1. **`native-wasm-scheduled.yml`**
   - Restore cache → `npm run build:emcc` (skips make if `.a` resolves)
   - Upload `openmpt-native.*` artifacts (keep)
   - Optional second matrix cell: `npm run build:emcc -- --debug` (timeout budget)

2. **`ci.yml` path-filtered job** (or extend `wasm-smoke-test` when paths match)
   - Paths: `cpp/**`, `scripts/build-wasm.sh`, `audio-worklet/**`, `public/worklets/native-bridge-processor.js`
   - Same cache + full `build:emcc` + artifact optional (short retention)
   - Always: `verify:native-exports` (already every PR)

3. **Document** cache invalidation: bump libopenmpt version or change `LIBOPENMPT_MAKE_FLAGS` → new key automatically via script hash / version string.

Do **not** commit `libopenmpt.a` or `openmpt-native.*` into git (size + binary churn). CI artifacts are the publish surface.

### 5.2 Feature flag / auto-detect

**Precedence (high → low):**

1. Explicit override: `?engine=js|native` or `localStorage.xasm1_audio_engine` (`js` \| `native` \| `auto`)
2. Auto: if override is `auto`/unset → probe `openmpt-native.js` via `isNativeGlueAvailable`
3. If probe succeeds and override ≠ `js` → `native-worklet`
4. Else → JS worklet
5. Last resort → ScriptProcessor (existing failure path)

**Default production:** `auto`. Without deployed native artifacts, always JS.

**Debug:** toggle in existing engine cycle UI remains; persist override when user forces a mode.

Document in:

- `public/worklets/README.md` (operator-facing)
- `docs/WASM_BUILD_SOLUTIONS.md` (build + deploy)
- One paragraph in AGENTS.md “Native vs JS”

### 5.3 Schema unification

Introduce a single adapter module (name TBD, e.g. `utils/workletPositionAdapter.ts` or extend `playheadPrediction.ts`):

```ts
// Canonical sample (already partially exists as WorkletPositionSample)
{
  order, row, rowFraction?, positionSeconds, workletTime,
  bpm?, speed?, sampleRate?, samplesWritten?,
  channelVU?: Float32Array | number[],
  source: 'js-worklet' | 'native' | 'scriptprocessor'
}
```

| Source | Adapter responsibility |
|--------|------------------------|
| JS `port.onmessage` `type==='position'` | Map fields 1:1 (already close) |
| Native `engine.on('position')` | Map `currentOrder→order`, `positionMs/1000`, set `workletTime` from **frame clock** when available: `t0 + audioFramesRendered/sampleRate` or new `PositionInfo.audioTime` |
| Both | `applyWorkletPositionSample` only |

**PCM:**

- Short term: document that projectM PCM is JS-worklet-only; native uses ring buffer + AnalyserNode.
- Medium term: optional native PCM path — either:
  - **A.** Main thread reads ring buffer copy at ~60 Hz and emits synthetic `projectm-pcm` (simple, slight lag), or
  - **B.** Extend `native-bridge-processor.js` to postMessage PCM chunks (closer to JS schema).

Prefer **B** if projectM quality on native is required; otherwise A is enough for meters.

**Do not** force C++ to speak JS postMessage types; keep shared memory for position (lower main-thread cost — a primary reason for native).

### 5.4 A/V sync parity

1. In C++ process callback: fill `PositionInfo` **before** render (mirror JS pre-snapshot) and set `rowFraction` from time-at-position using pre-render row.
2. Add either:
   - `double audioTimeSeconds` derived from frames (`audioFramesRendered/sampleRate`), or
   - document that main thread must use frame clock exclusively for native.
3. In `OpenMPTWorkletEngine.pollPositionOnce`, set `workletTime` from frame clock, not only leave it undefined for main ctx tagging.
4. Reuse `npm run test:playhead` for pure math; add a thin fixture that feeds native-shaped samples through the same prediction helper.
5. Manual: `docs/planning/accurate_playback.md` § Engine comparison — require native row after `build:emcc`.

### 5.5 Benchmark plan

**Script:** `scripts/benchmark-engine-mainthread.mjs` (Playwright against `npm run preview`).

Metrics (per engine, same large IT fixture):

- `performance.now()` cost of RAF `updateUI` slice (expose debug hook or measure via `window.__ENGINE_BENCH__`)
- Message/poll rate (JS: position messages/s; native: successful polls/s)
- Optional: long-task attribution if available
- Load time to first audio

Output: markdown table under `artifacts/engine-bench/` (CI optional, manual default).

Fixtures: one large `.it` in `public/` or downloadable test asset (do not bloat repo — URL or git-lfs optional).

### 5.6 emcc flag review conclusions

| Decision | Rationale |
|----------|-----------|
| Keep `INITIAL_MEMORY=32MB` | Avoids large fixed commit; growth handles big modules |
| Keep `MAXIMUM_MEMORY=512MB` | Caps runaway growth; large multi-MB modules + pattern extract headroom |
| Keep growth enabled | Required for variable module size |
| Release CI: no ASSERTIONS | Perf / size |
| Weekly or path CI: optional `--debug` matrix | Catches heap errors without slowing every PR |
| EXPORT list | Maintain via `verify:native-exports` only — no duplicate hand lists in docs |
| Runtime methods | Audit bridge path for `emscriptenGetAudioObject` / `emscriptenRegisterAudioObject`; add to `EXPORTED_RUNTIME_METHODS` if missing in 3.1.50 |

---

## 6. Key decisions

1. **Native remains optional progressive enhancement** — never block production on missing `openmpt-native.*`.
2. **Do not commit native binaries** — CI artifacts + local `build:emcc` only.
3. **Cache `libopenmpt.a`, not the final glue** — C++ relink is cheap; libopenmpt make is not.
4. **Unify at the main-thread adapter**, not by rewriting C++ to postMessage.
5. **Frame/sample clock is the native sync source of truth**; do not trust main-thread `currentTime` alone.
6. **Filename policy is frozen:** `openmpt-native.*` vs `openmpt-worklet.js` — any PR that reverses this is rejected.
7. **Force-JS override is mandatory** before shipping “prefer native” as a deploy feature (operators must escape bad native builds).

---

## 7. Non-goals

- Replacing the JS worklet in production without explicit deploy of native artifacts.
- Shipping libopenmpt source or `.a` in the app repo.
- Full ProjectM feature parity on native in the first PR.
- Changing emsdk pin without a dedicated upgrade PR (stay on **3.1.50**).

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| SAB / COOP-COEP required for ring bridge | Already documented; MediaStream fallback remains |
| Prefer-native surprises users after deploy of artifacts | Default `auto` + force-JS + UI engine indicator |
| Cache serves stale `.a` after flag change | Key includes script hash + lib version |
| Native A/V worse than JS if clock wrong | Block “prefer in prod” on sync acceptance |
| Dual AudioContext latency (native own ctx) | Prefer ring bridge into main graph; measure |

---

## 9. PR Plan

### PR1 — CI cache + path-triggered full build
- **Files:** `.github/workflows/native-wasm-scheduled.yml`, `.github/workflows/ci.yml`, maybe `scripts/build-wasm.sh` (cache-friendly log lines)
- **Deps:** none
- **Work:** actions/cache for vendor libopenmpt static lib; scheduled job uses cache; path-filtered full build on `cpp/**` / build script; keep artifact upload
- **Acceptance:** scheduled job &lt; previous wall time when cache hits; path PR produces `openmpt-native.wasm` with `\0asm`

### PR2 — Engine override flag + docs
- **Files:** `hooks/useLibOpenMPT.ts`, `hooks/useWorkletLoader.ts` (or small `utils/audioEngineSelection.ts`), `public/worklets/README.md`, `docs/WASM_BUILD_SOLUTIONS.md`, AGENTS.md
- **Deps:** none (can parallel PR1)
- **Work:** `auto|js|native` precedence; document; ensure toggle writes override
- **Acceptance:** with artifacts present, `?engine=js` stays on JS worklet; without artifacts, `?engine=native` fails soft to JS

### PR3 — Position adapter + native clock for A/V parity
- **Files:** `cpp/openmpt_wrapper.*`, `cpp/worklet_processor.cpp`, `audio-worklet/OpenMPTWorkletEngine.ts`, `audio-worklet/types.ts`, `hooks/useAudioGraph.ts`, `utils/playheadPrediction.ts` (+ tests)
- **Deps:** ideally after PR1 so CI can rebuild native
- **Work:** pre-render position fill; `workletTime` from frame clock; single adapter into `applyWorkletPositionSample`; extend `test:playhead`
- **Acceptance:** prediction tests green; manual accurate_playback checklist on native ≤ ~1 row lag

### PR4 — Optional PCM parity (projectM)
- **Files:** `public/worklets/native-bridge-processor.js`, `hooks/useAudioGraph.ts`
- **Deps:** PR3 recommended
- **Work:** bridge posts `projectm-pcm`-compatible messages from ring reads
- **Acceptance:** projectM (if enabled) receives PCM on native without Analyser-only path

### PR5 — Main-thread benchmark harness
- **Files:** `scripts/benchmark-engine-mainthread.mjs`, package.json script, short note in this doc or `docs/WASM_BUILD_SOLUTIONS.md`
- **Deps:** PR1 (artifacts) + PR2 (engine force)
- **Work:** Playwright dual-run on large IT; report main-thread cost
- **Acceptance:** reproducible local command; table in artifacts

### PR6 — emcc debug/ASSERTIONS CI cell + export audit
- **Files:** workflows, possibly `EXPORTED_RUNTIME_METHODS` in `build-wasm.sh`
- **Deps:** PR1
- **Work:** matrix or weekly `--debug` job; confirm audio object runtime exports; document flag table (already mostly in WASM_BUILD_SOLUTIONS — refresh from this epic)
- **Acceptance:** debug build green weekly; export verify still hard-fails on drift

---

## 10. Implementation order (recommended)

```
PR1 (CI cache) ─┬─► PR3 (sync/schema) ─► PR4 (PCM)
PR2 (flags)   ─┘         │
                         └─► PR5 (bench)
PR1 ─► PR6 (debug job)
```

Ship PR1+PR2 first (platform safety). PR3 is the product-quality gate for “prefer native” in any environment that deploys artifacts. PR4–PR6 are polish / evidence.

---

## 11. Open questions

1. **Should production deploys ever include `openmpt-native.*` by default?**  
   Recommendation: no until PR3 acceptance + bench (PR5) show main-thread win without sync regression. Stay opt-in via deploy pipeline copying CI artifacts.

2. **Cache host: GitHub Actions cache only, or also container image with prebuilt `.a`?**  
   Recommendation: Actions cache first; Docker image later if cache miss rate hurts.

3. **Is projectM-on-native in-scope for this epic?**  
   Recommendation: PR4 optional; mark out of critical path for acceptance “A/V sync”.

---

## 12. Mapping epic goals → PRs

| Goal | PRs |
|------|-----|
| 1 Reliable CI + cache libopenmpt.a | PR1 |
| 2 Progressive enhancement + docs/flag | PR2 |
| 3 Unify position/VU/PCM schema | PR3, PR4 |
| 4 Benchmark main-thread cost | PR5 |
| 5 emcc flag review + ASSERTIONS job | PR6 (+ docs in PR1/PR2) |

---

*End of design — ready for implementation when prioritized after current mainline work.*
