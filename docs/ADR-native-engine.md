# ADR: Native C++ engine — retire its audio path; the JS AudioWorklet stays the only engine (#491)

**Status:** proposed · 2026-10-17 (accepted when #505 merges)
**Decision:** retire the native engine's **audio path**. The JS AudioWorklet engine
(`audio-worklet/js/openmpt-processor.ts` + the real-WASM `libopenmpt-worklet.{js,wasm}`)
stays the only playback engine. A follow-up PR deletes the native audio path;
`cpp/openmpt_wrapper.{h,cpp}` stays for the editable-module work (#493). Until that PR
lands, native stays exactly as opt-in as it is today (`?engine=native`, never automatic).

## Context

The native engine is a second libopenmpt build, linked with Emscripten `AUDIO_WORKLET` +
`WASM_WORKERS`. It parses on the main thread in shared memory and renders in a Wasm Audio
Worklet (`cpp/native_engine.{h,cpp}`, glue in `cpp/worklet_processor.cpp`,
`audio-worklet/OpenMPTWorkletEngine.ts`, `hooks/audioGraph/startNativePlayback.ts`). It has
never been the default:

- production resolves to the JS worklet (`utils/audioEngineSelection.ts`);
- its release artifacts are gitignored and optional in `deploy.py`;
- until #502 it never rendered at all, because its processor was never registered. Every
  "native" session before that fell back to JS.

#491 Phase 1 and Phase 2 made it correct: lock-free load handoff, no parse or free on the audio
thread, a command ring, real wasm exceptions, one audited flag set, libopenmpt 0.8.9. Phase 3
asks whether it is worth keeping. **Rule, fixed in the issue before measuring:**

> If JS (+ `--simd`, if it helps) is within ~10 %, retire native (delete
> `cpp/worklet_processor.cpp`'s audio path, keep the wrapper for the editable-module work).
> Otherwise promote native to the default where `crossOriginIsolated` holds.

Both engines were measured in their #491 state: same libopenmpt 0.8.9, same shared wasm
feature flags (`scripts/lib/wasm-flags.sh`), same Sinc+LP default.

## Method

Two harnesses. Both run in CI's `native-full-build` job (informational step, `engine-bench`
artifact), so the numbers can be regenerated on every native change.

1. **CPU per render quantum, load and heap** — `scripts/bench-engines.mjs`
   (`npm run bench:engine-cpu`), Node/V8:
   - **JS:** the compiled processor (`public/worklets/openmpt-worklet.js`) with the committed
     libopenmpt pair, in a fake `AudioWorkletGlobalScope`. This is the exact `process()` the
     AudioWorklet runs, position and VU reporting included.
   - **Native:** `NativeEngine::process()`, built for Node by `scripts/build-native-bench.sh`
     with the shipped engine's flags and `libopenmpt.a`.
   - Each pass is 20 s of audio in 128-frame quanta at 48 kHz (budget 2.667 ms) after a 2 s
     warm-up. Engines are interleaved, 3 rounds, median of rounds.
   - Modules: a synthetic 64-channel IT (`scripts/lib/synth-it.mjs`, every channel live, the
     workload #491 names), a synthetic 32-channel XM (`scripts/lib/synth-xm.mjs`) and
     `4-mat_madness.mod`. Each runs at Sinc+LP (8, the app default) and cubic (4).
   - *load* is the parse; *heap* is the engine's wasm memory after it.
   - A big-upload pass parses a 64-channel IT carrying 16 MiB of sample data.
2. **Real AudioWorklet, headless Chromium** — `scripts/bench-engines-browser.mjs`
   (`npm run bench:engine-glitches`):
   - Engine-level pages without the React app, whose UI work for a 64-channel grid would
     dominate. Each engine is wired as the app wires it, on the one 48 kHz context.
   - Underruns come from `AudioContext.playbackStats`, measured over:
     - 20 s of steady playback of the 64-channel IT;
     - 5 track changes between two different 64-channel ITs;
     - 6 changes to and from the 16 MiB IT.
   - Also recorded: time until the engine has the new module, and how long the load call
     blocked the main thread.
   - Run at both latency hints: `'playback'`, the app default, and `'interactive'`, stage
     mode's.
   - Fresh browser per run, engines interleaved, 3 rounds.

**JS `--simd`:** re-measured in #504 with the shared flags. It brought no measurable win
(p50 within noise at cubic and sinc-8) and +7.6 % wasm size. "JS + `--simd`" is therefore the
shipped, non-SIMD JS engine.

## Results

### CPU per quantum

CI (GitHub runner, Node 22.23.3), commit `3c25b71`:

| module | interp | JS p50 ms | native p50 ms | native / JS | JS p99 ms | native p99 ms | JS load ms | native load ms | JS heap MiB | native heap MiB |
|---|---|---|---|---|---|---|---|---|---|---|
| synthetic 64-ch IT | 8 | 0.0635 | 0.0611 | **0.96** | 0.091 | 0.092 | 14.5 | 5.1 | 32 | 128 |
| synthetic 64-ch IT | 4 | 0.0383 | 0.0372 | **0.97** | 0.062 | 0.060 | 18.8 | 9.0 | 32 | 128 |
| synthetic 32-ch XM | 8 | 0.0329 | 0.0306 | 0.93 | 0.049 | 0.045 | 12.4 | 3.0 | 32 | 128 |
| synthetic 32-ch XM | 4 | 0.0207 | 0.0191 | 0.92 | 0.035 | 0.032 | 15.9 | 6.1 | 32 | 128 |
| 4-mat_madness.mod (4 ch) | 8 | 0.0068 | 0.0047 | 0.69 | 0.013 | 0.009 | 12.2 | 2.5 | 32 | 128 |
| 4-mat_madness.mod (4 ch) | 4 | 0.0054 | 0.0034 | 0.63 | 0.010 | 0.007 | 15.3 | 5.5 | 32 | 128 |

Ratios across the three CI runs (`f2acc69`, `545ed29`, `3c25b71`):

| module | native / JS range |
|---|---|
| 64-channel IT | 0.94–0.97 |
| 32-channel XM | 0.89–0.93 |
| 4-channel MOD | 0.61–0.74 |

The first run's runner was faster, at about 0.6× these absolute times, but gave the same
ratios.

**Big upload** (16.1 MiB 64-channel IT, median parse):

| engine | parse | where it runs | heap after |
|---|---|---|---|
| JS | 22.2 ms | audio thread | grows to 38 MiB |
| native | 10.4 ms | main thread | fixed 128 MiB |

A local run on a loaded 8-vCPU machine took 125 ms (JS) and 46 ms (native).

**Module-size cap:** the native release engine cannot load a 33.6 MB IT at all. `load_module`
probes for 4× the file size inside its fixed 128 MiB heap, and returns `ERR_*`. The JS engine
grows on demand up to 1 GiB.

### Real AudioWorklet, headless Chromium

CI, commit `3c25b71`. `'playback'` is the app default; `'interactive'` is stage mode's
create-time choice (pitfall 12).

| metric | JS, playback | native, playback | JS, interactive | native, interactive |
|---|---|---|---|---|
| context base + output latency, ms | 85.3 | 85.3 | 42.0 | 42.0 |
| steady underruns / min (64-ch IT) | 0 | 0 | 0 | 0 |
| underruns per track change | 0 | 0 | 0 | 0 |
| load → module ready, ms | 10.5 | 5.4 | 18.2 | 5.2 |
| main thread blocked by the load call, ms | 0.0 | 5.4 | 0.1 | 5.2 |
| big upload (16.1 MiB IT): underruns per change | 0 | 0 | 0 | 0 |
| big upload: load → module ready, ms | 12.7 | 13.3 | 30.3 | 13.3 |
| big upload: main thread blocked, ms | 0.2 | 13.3 | 0.2 | 13.3 |

Headless Chromium renders into a fake output device. At `'interactive'` it still reports
42 ms of base + output latency. A real sound card at `'interactive'` often runs a buffer of
10–20 ms, so these zeros say the JS parse stall fits a 42 ms buffer, not a 10 ms one.

The same `'interactive'` run on the dev box underran hundreds of times a minute for **both**
engines, even in steady playback. Its load average was about 9, so that measured the machine,
not the engines.

## Decision

By the rule, **retire**.

**CPU is within ~10 %.** On the 64-channel IT, the workload #491 names, native is 3–6 %
cheaper per quantum across three CI runs. On the 32-channel XM it is 7–11 % cheaper. Either
way the gap is at most 0.0025 ms of a 2.667 ms budget (0.1 %), and the JS engine's heaviest
p50 is 2.4 % of the budget.

The 26–39 % on the 4-channel MOD is fixed per-quantum overhead on a 0.005 ms quantum: about
0.002 ms, or 0.08 % of the budget. That overhead is the JS processor's position and VU
reporting, not mixing. It shrinks as a share once there is real mixing work, which is the case
the budget is about.

**Neither engine underran anywhere it was measured,** at either latency hint.

Promoting native would buy nothing audible and would cost:

- **4× the heap:** a fixed 128 MiB reservation, against 32 MiB that grows on demand.
- **A module-size cap of about 32 MiB.**
- **A `crossOriginIsolated` + SharedArrayBuffer requirement** for the engine that plays audio.
- **A second libopenmpt build with its own toolchain hazards.**
  - emsdk 3.1.51 never initialises main-thread TLS under `WASM_WORKERS`, which silently broke
    every typed `catch` until #504 added `cpp/wasm_workers_tls.cpp`.
  - emsdk 6.0.2 cannot link wasm exceptions with `WASM_WORKERS` at all, so native also pins
    the emsdk upgrade.
  - The JS build has neither problem.
- **The C++ engine and everything around it to maintain:** the host sanitizer harness, the
  native smokes, and three CI jobs (two in `ci.yml`, one scheduled), for an engine no build
  ships by default.

### What retiring gives up

Native's real advantages, recorded so that a revisit starts from them:

1. **Parse off the audio thread.** The JS engine parses inside its AudioWorklet message
   handler, so a load stalls the whole audio graph for the parse: 22 ms for the 16 MiB IT in
   CI. Measured underruns were zero at both latency hints, but only down to a 42 ms buffer. On
   a real device at stage mode's `'interactive'` latency, a big upload may well glitch. Today a
   track change is a hard cut in both engines (no crossfade, no gapless transition), so the
   stall falls inside the cut.
2. **Faster "module ready" for ordinary modules:** 5.4 ms against 10.5 ms (18 ms at
   `'interactive'`). That is not perceptible next to the app's own load path.
3. **Shared-memory position polling instead of `postMessage`.** The main-thread cost of the
   JS path is already negligible: `getPlayheadDebug` takes a median of 0.005 ms
   (`docs/planning/native-engine-bench-notes.md`).

## Consequences

### The follow-up PR, after #505 merges

**Deletes:**

- the native audio path: `cpp/worklet_processor.cpp`, `cpp/native_engine.{h,cpp}` and
  `cpp/wasm_workers_tls.cpp`;
- its TypeScript side: `audio-worklet/OpenMPTWorkletEngine.ts`,
  `audio-worklet/NativePatternReader.ts` and `hooks/audioGraph/startNativePlayback.ts`;
- native engine selection: `?engine=native`, `utils/nativeParityGate.ts` and the native
  branch of `utils/audioEngineSelection.ts`;
- the native smokes (`smoke:playhead:native`, `smoke:native-reload`) and the old
  `bench:engine` main-thread harness;
- this ADR's benchmark scripts (`bench-engines*.mjs`, `build-native-bench.sh`,
  `cpp/bench/`), which compare against native; they stay in git history at #505;
- `build-wasm.sh`'s AudioWorklet link;
- the `native-full-build` and `native-host-sanitizers` CI jobs, and
  `native-wasm-scheduled.yml`;
- `deploy.py`'s native-trio check;
- CLAUDE.md pitfall 13.

**Keeps:** `cpp/openmpt_wrapper.{h,cpp}`, as #491 asks.

### What #491 leaves in place

Phase 2's toolchain work all applies to the JS build (`scripts/build-js-libopenmpt.sh`) and
stays:

- the shared flag file;
- the sha256-pinned libopenmpt 0.8.9;
- the fatal emsdk drift check;
- the instruction-level wasm checks.

The host build of libopenmpt under TSan and ASan+UBSan (`scripts/native-host-test.sh`) is the
natural base for testing #493's `xasm_edit` C++. Its engine tests go with the engine.

### Effect on related issues

- **#493 (editable modules):** already targets the JS pair (its Phase 0 patches
  `libopenmpt-worklet.wasm`), so there is now one libopenmpt build to patch instead of two.
- **#416 / #448 (live mute / solo):** become JS-engine-only, through #448's
  `libopenmpt_ext` interactive route. The native command-ring leg of #416 is dropped.
- **emsdk upgrade:** stops being blocked by the `WASM_WORKERS` + wasm-EH link failure. The
  JS build was already shown to build on emsdk 6.0.6 (`native-engine-bench-notes.md`,
  2026-09-18); it now needs `XASM_ALLOW_EMSDK_DRIFT=1` until the pin moves.

### Revisit if

- **Loads have to happen while audio plays,** or the JS parse stall becomes audible:
  - a crossfade, gapless playback or a live-set feature;
  - big uploads glitching on a real device at stage mode's `'interactive'` latency, which
    headless CI cannot measure.

  Either needs a parse-off-audio-thread design for the JS engine, or this engine back.
- **A target device runs the JS engine's p99 near the budget.** Rerun the benchmarks from
  #505's tree (*Reproduce*, below).
- **The JS engine needs threads,** for example mixing several modules. Then #503's design is
  the reference: shared heap, SPSC command ring, handoff and graveyard slots, seqlock position
  and acked teardown.

## Reproduce

From #505's tree (the follow-up PR removes the native leg):

```bash
npm run build:emcc && npm run build:native-bench     # emsdk 3.1.51
npm run bench:engine-cpu -- --seconds 20 --rounds 3 --markdown cpu.md
npm run build && npm run preview -- --port 4391 &
BASE_URL=http://127.0.0.1:4391 npm run bench:engine-glitches -- --rounds 3 --markdown browser.md
#   --latency interactive   stage mode's latencyHint;  --steady-ms / --changes / --big-frames shorten or resize it
```
