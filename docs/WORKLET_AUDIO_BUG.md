# AudioWorklet Playback Bug — Post-Mortem

> **Status:** Fixed (2026-05-09)  
> **Affected:** All deployments between 2026-05-08 and 2026-05-09  
> **Symptom:** UI showed "Playing" and pattern display animated, but audio output was either a 440Hz test tone or silence.

---

## Root Cause

### 1. The worklet file was replaced with a non-functional stub

On 2026-05-08, commit `499a862` replaced `public/worklets/openmpt-worklet.js` (205-line direct-rendering processor) with a 128-line stub that:
- Stored module data but never passed it to libopenmpt.
- Generated a 440Hz sine wave in `process()` with a comment saying `"WASM will replace this"`.
- Sent fake `position` messages so the UI appeared alive.

The stub was then retained through several subsequent commits.

### 2. AudioWorklet caching prevented the fix from reaching users

Even after the direct-rendering worklet was restored (~250 lines), browsers continued executing the **cached stub** because:
- `audioWorklet.addModule(url)` is cached **extremely aggressively** — sometimes across normal reloads.
- The worklet URL had **no cache-busting query parameter**, so the browser treated the new deploy as the same resource.
- DevTools console showed `openmpt-worklet.js:130` (the old stub's last line) instead of `openmpt-worklet.js:250+` (the restored version).

### 3. The `setTimeout` polyfill corrupted Emscripten timer state

The restored worklet initially contained a microtask-based `setTimeout` polyfill:

```js
globalThis.setTimeout = function (callback) {
  Promise.resolve().then(callback);
  return 0;
};
```

This is **harmful** because:
- Chrome 116+ already provides `setTimeout` in `AudioWorkletGlobalScope`.
- When the polyfill *did* apply (older browsers), it **ignored the `delay` argument**, causing Emscripten's internal timers (`safeSetTimeout`, `__setitimer_js`, runtime init timeout) to fire **immediately** instead of after their scheduled delays.
- This could abort WASM initialization prematurely or corrupt the wasm2js runtime.

### 4. Native engine probe crashed on init

`audio-worklet/OpenMPTWorkletEngine.ts` attempted to dynamically `import()` `openmpt-worklet.js` on the **main thread**. That file references `AudioWorkletProcessor` and `registerProcessor`, which do not exist outside `AudioWorkletGlobalScope`, causing an immediate `ReferenceError`.

This didn't break playback directly (the error was caught and the app fell back to the JS worklet), but it produced confusing console noise and meant the native C++ engine path could never initialize even if built.

---

## The Fix

| File | Change |
|------|--------|
| `public/worklets/openmpt-worklet.js` | Restored direct-rendering `XMPlayerProcessor` with `_openmpt_module_read_float_stereo()` calls. Removed the `setTimeout` polyfill. Added `hasEnded` flag to prevent `ended` message spam. |
| `hooks/useWorkletLoader.ts` | Added `WORKLET_VERSION = '2'` and appended `?v=${WORKLET_VERSION}` to the worklet URL. **This is critical — bump this version whenever the worklet file changes.** |
| `audio-worklet/OpenMPTWorkletEngine.ts` | Removed the incorrect `import()` of `openmpt-worklet.js` on the main thread. Only attempts to load `openmpt-native.js`. |
| `hooks/useAudioGraph.ts` | ScriptProcessorNode fallback now loops back to `(0, 0)` when EOF is reached and `isLooping` is enabled. |

---

## Prevention Checklist

Before modifying the worklet or AudioWorklet-related code:

- [ ] **Bump `WORKLET_VERSION`** in `hooks/useWorkletLoader.ts` if `openmpt-worklet.js` changes.
- [ ] **Extend `audio-worklet/protocol.ts`** (not ad-hoc string literals) when adding worklet message types; update `worklet-protocol-constants.js` and parity tests.
- [ ] **Validate at the receive boundary** via `parseWorkletToMainMessage` / `parseMainToWorkletMessage` — never destructure `e.data` blindly.
- [ ] **Native `PositionInfo` changes** must update `audio-worklet/positionInfoLayout.ts` and `tests/positionInfoLayout.test.ts`.
- [ ] **Never re-init libopenmpt** on module reload — reuse `AudioWorkletNode` + shared-scope singleton (`#329`).
- [ ] **Never suspend `AudioContext`** on normal `stopMusic(false)` / module reload (`#330`).
- [ ] **Throttle worklet `position` postMessage** to ~60 Hz; main thread extrapolates fractional playhead (`playheadPrediction`).
- [ ] **Skip `node.disconnect()`** when hot-reloading module data into an existing worklet node.
- [ ] **Never add a `setTimeout` polyfill** that ignores the `delay` argument. Chrome 116+ has native `setTimeout` in AudioWorklet; for older browsers, use `currentTime`-based timing in `process()` instead.
- [ ] **Never `import()` an AudioWorklet processor file on the main thread.** Use `audioContext.audioWorklet.addModule()` for JS processors, or Emscripten's native API for `AUDIO_WORKLET` builds.
- [ ] **Verify line numbers in browser console.** After deploy, a hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) should show line numbers matching the current source (e.g., ~250), not the old stub (~130).
- [ ] **Never commit HTML/404 bodies as `*.wasm`.** Production glue is wasm2js (`libopenmpt-audioworklet.js`); a sibling `libopenmpt.wasm` is not required. Run `npm run verify:wasm` before commit/deploy.
- [ ] **Run `npm test`** — Vitest guards in `tests/workletAudioLifecycle.test.ts` cover #329 (shared-scope libopenmpt singleton / hot `load`) and #330 (no `AudioContext.suspend()` on normal `stopMusic(false)`). `tests/workletRegressionGuards.test.ts` covers #354 (≤~60 Hz position throttle + hot-reload node reuse / load-token ack).

### Automated regression harness (#329 / #330 / #354)

| Guard | What it catches |
|-------|-----------------|
| `utils/workletAudioLifecycle.ts` + `tests/workletAudioLifecycle.test.ts` | `play()` re-sending `initLib` on module reload; `stopMusic` suspending the context; #354 helper smoke |
| `tests/workletRegressionGuards.test.ts` | Position postMessage flood (fake-clock ≤~60 Hz); hot-reload disconnect; stale `loaded` ack token; SP structural immunity |
| `utils/workletLibSingleton.ts` | Re-evaluating ~5 MB wasm2js glue when `__openmptWorkletLib` already exists |
| Source invariants | `stopMusic` body must not call `.suspend()`; worklet must keep `ensureSharedLibOpenMPT` singleton + position throttle `if`; hooks must call token helpers |

CI runs the full Vitest suite (`npm test`) on every PR via `lint-and-build`.

### Manual audible checklist (still required)

Headless CI cannot assert speaker output. After audio-path changes, verify **with sound**:

1. **Default auto-load** — fresh tab, default `4-mat_madness.mod` plays after Play.
2. **File picker** — load a local `.mod` / `.xm`, play, stop, play again.
3. **Storage playlist** — pick a remote module, auto-play after load.
4. **Share URL** — open `?module=…` deep link; playback starts without a second click when policy allows.
5. **MOD ↔ XM switch** — load MOD, play, switch to XM (or vice versa); no silent output, no runaway `ended → seek 0` loop in console.
6. **Stop → play** — `stopMusic(false)` then `play()` without extra user gesture beyond the initial unlock.

---

## Worklet asset path (wasm2js) — 2026-07 fix

### Problem

`public/worklets/libopenmpt.wasm` was a **236-byte HTML 404 document** (`<!DOCTYPE HTML…>`), not a WebAssembly binary (magic `\0asm`). The main thread still fetched it and passed it as `wasmBinary` into the worklet.

Production `libopenmpt-audioworklet.js` is a **wasm2js** build (`isWasm2js:!0`, ~5 MB). The runtime is embedded in the JS; `findWasmBinary` is a no-op. Seeding a fake `Module.wasmBinary` overwrites the empty binary wasm2js expects and risks silent init failure / ScriptProcessor fallback.

### Fix

| Change | Detail |
|--------|--------|
| Remove stub | Deleted corrupt `public/worklets/libopenmpt.wasm` |
| `useAudioGraph.ts` | Fetch JS only when glue is wasm2js; optional real `.wasm` only for classic builds, with `\0asm` validation |
| `openmpt-worklet.js` | `wasmBytes` optional; do not set `wasmBinary` for wasm2js |
| `WORKLET_VERSION` | Bumped to `3` (cache bust) |
| CI | `npm run verify:wasm` rejects any `*.wasm` under `public/`/`dist/` that is tiny, HTML, or missing `\0asm` |

See also `public/worklets/README.md`.

---

## Position report flood — MOD hiccups (2026-07)

### Problem

`openmpt-worklet.js` posted a `position` message on **every** `process()` quantum (~350 Hz at 128-sample blocks). That flooded the main-thread message queue and caused audible MOD stutter, especially alongside React/GPU work.

### Fix

| Change | Detail |
|--------|--------|
| `openmpt-worklet.js` | Restore ~60 Hz `position` throttle (`positionReportInterval`); keep audio render + SAB VU update every quantum |
| `playheadPrediction.ts` | Main thread extrapolates fractional playhead between reports |
| `WORKLET_VERSION` | Bumped to `7` (cache bust) |

---

## #354 regression lock — invariants + automated tripwires (2026-07-31)

Two failure modes shipped in #354 (`21cb5b6`) without a test that would have gone red on the pre-fix code. Both are now locked by pure decision helpers + behavioral Vitest coverage.

### Invariant A — position postMessage ≤ ~60 Hz

| Item | Detail |
|------|--------|
| Failure | Worklet posts `position` every audio quantum (~350 Hz) → main-thread flood → MOD hiccups |
| Production guard | `public/worklets/openmpt-worklet.js`: `positionReportInterval = 1/60` gates `port.postMessage({ type: 'position', … })` |
| Pure helper | `shouldReportWorkletPosition` / `countThrottledPositionReports` in `utils/workletAudioLifecycle.ts` |
| Tests | `tests/workletRegressionGuards.test.ts` — fake-clock quantum simulation asserts ≤~60 Hz and ≪ unthrottled; source invariant requires the throttle `if` around the position post |
| Not a sleep test | Cadence is asserted by advancing a synthetic `currentTime` in `128/44100` steps — no real-time waits |

### Invariant B — hot module reload reuses node + ignores stale `loaded` acks

| Item | Detail |
|------|--------|
| Failure | Second `loadModule` disconnects/reconnects `AudioWorkletNode` and/or accepts a stale `loaded` ack → XM silence / UI “Playing” with no audio |
| Production guards | `canReuseWorkletNode` + skip `disconnect`/`connect` on hot path; `workletModuleTokenRef` bumped in `processModuleData`; `forceModuleLoad` from `loadModule`; `shouldAcceptWorkletLoadedAck` drops mismatched tokens in `useAudioGraph.ts` |
| Pure helpers | `planJsWorkletHotReloadPlay`, `shouldForceWorkletModuleLoad`, `shouldAcceptWorkletLoadedAck` in `utils/workletAudioLifecycle.ts` |
| Tests | `tests/workletRegressionGuards.test.ts` — two-load session keeps one node identity / zero disconnects / single `initLib`; stale token ack rejected; source invariants require hooks call the helpers |
| Related | #329 singleton/`initLib` once; #330 never `AudioContext.suspend()` on normal stop — still covered by `tests/workletAudioLifecycle.test.ts` |

### ScriptProcessor fallback (structurally immune)

| Concern | Why SP cannot reintroduce the #354 failures |
|---------|-----------------------------------------------|
| Position flood | SP updates position via direct `applyWorkletPositionSample` in `onaudioprocess` — **no** `port.postMessage({ type: 'position' })`. Buffer is `SP_BUFFER = 4096` → ≈10.8 Hz @ 44.1 kHz ≪ 350 Hz. |
| Silent reload / stale ack | `stopMusic` always `disconnect()`s and nulls `scriptProcessorRef` and clears `spFallbackTriggered`. There is no deferred `loaded` ack on the SP path; playback starts synchronously after node creation. Next play rebuilds SP against the new main-thread module pointer. |

Native engine (`OpenMPTWorkletEngine`) polls shared-memory position at `setInterval(16)` (~60 Hz) — already capped; out of scope for the JS-worklet #354 postMessage flood.

### Test map (CI: `npm test`)

| File | Guards |
|------|--------|
| `tests/workletAudioLifecycle.test.ts` | #329 reuse/`initLib`, #330 no suspend, source invariants, #354 helper smoke |
| `tests/workletRegressionGuards.test.ts` | #354 behavioral throttle + hot-reload token/node identity + SP immunity docs-as-tests |
| `utils/workletAudioLifecycle.ts` | Single source of pure lifecycle decisions used by hooks **and** tests |

**Do not** weaken `canReuseWorkletNode`, the position throttle interval, or the loaded-ack token check to make a test pass — fix the test.

---

## Typed / validated postMessage boundary (2026-07-31)

### Problem

Three consecutive weekly regressions (#329 → #330 → #354) patched symptoms at the
main-thread↔worklet boundary without a shared contract. Message-type string literals,
`e.data` destructuring, and native `PositionInfo` byte offsets were duplicated across
`openmpt-worklet.js`, `useAudioGraph.ts`, `useLibOpenMPT.ts`, and
`OpenMPTWorkletEngine.ts` with no compile-time or runtime validation.

### Durable fix

| Layer | Location | Role |
|-------|----------|------|
| Constants | `audio-worklet/workletProtocolConstants.ts` + `public/worklets/worklet-protocol-constants.js` | Single source of message-type strings (parity tested) |
| Types + zod | `audio-worklet/protocol.ts` | Discriminated unions + `parseWorkletToMainMessage` / `parseMainToWorkletMessage` |
| JS dispatch | `audio-worklet/jsWorkletDispatch.ts` | Testable `onmessage` handler (position, loaded token, seekAck, error, projectm-pcm) |
| Native layout | `audio-worklet/positionInfoLayout.ts` | Documented `PositionInfo` offsets + `decodePositionInfo` (replaces hardcoded `DataView` reads) |
| Receive guards | `useAudioGraph.ts`, `useLibOpenMPT.ts`, `openmpt-worklet.js` | Validate before destructuring; reject/log malformed messages |

`useAudioGraph` loads `worklet-protocol-constants.js` before `openmpt-worklet.js`.
`WORKLET_VERSION` bumped to `8` (cache bust).

### Test map (CI: `npm test`)

| File | Guards |
|------|--------|
| `tests/workletProtocol.test.ts` | Constant parity, zod accept/reject, oscBuffer SAB size |
| `tests/jsWorkletDispatch.test.ts` | Dispatch path: position, stale loaded token, seekAck, SP-fallback flag |
| `tests/positionInfoLayout.test.ts` | Fixture encode/decode; offset table size 188 B |
| `tests/workletAudioLifecycle.test.ts` | #329/#330 invariants + dispatch integration |
| `tests/workletRegressionGuards.test.ts` | #354 throttle + hot-reload source invariants |

This supersedes per-incident string-literal patches as the long-term guard for the
audio message boundary. Incident-specific helpers in `utils/workletAudioLifecycle.ts`
remain the source for pure lifecycle decisions (reuse node, throttle cadence, load tokens).

---

## XM pattern-boundary stutter (2026-08)

### Problem

After #354 fixed MOD hiccups (position flood), **XM** still glitched at **order/pattern changes**. XM typically has more channels and heavier row-0 voice activity; the worklet still ran every audio quantum (~350 Hz):

- up to 3× `get_time_at_position` (only needed for fractional row in position posts)
- up to 32× `get_current_channel_vu_mono`
- full `_updateAudioReactive` sample scan
- `projectm-pcm` allocate + `postMessage` (~88 Hz) even when no Project-M host listens
- interpolation filter length **8** (max sinc) on wasm2js

At pattern starts those extras tipped `process()` past the ~2.9 ms quantum budget → audible underrun. MOD (4ch) often stayed under budget.

### Fix

| Change | Detail |
|--------|--------|
| Gate helpers | `get_time_at_position`, VU, audio-reactive SAB update only on ~60 Hz position path |
| Opt-in PCM | `_pcmEmitEnabled` default false; `setPcmEmit` enables Project-M worklet PCM |
| Interpolation | render param length **8 → 4** (worklet + ScriptProcessor) |
| Order UI | `startTransition` around `setSequencerMatrix` on order change |
| Cache | `WORKLET_VERSION` → `9`; protocol constants `?v=2` |

### Guards

`tests/workletRegressionGuards.test.ts` asserts VU/time_at_position sit inside the throttle block, PCM default off, and filter length 4.

---

## How to Verify the Fix Post-Deploy

1. Open DevTools → Network → check "Disable cache".
2. Hard refresh (`Ctrl+Shift+R`).
3. In Console, filter for `[Worklet]` logs. You should see:
   - `WASM base URL resolved to: ...`
   - `libopenmpt ready ✅`
   - `Module loaded ✅ ptr= ...`
4. The Network tab should show `openmpt-worklet.js?v=2` (or current version) loaded successfully.
5. Audio should play the actual MOD/XM file, not a test tone.

---

## Pattern-Boundary Hitches — Per-Quantum Worklet Budget

`process()` runs ~350×/s and has one quantum of wall time to finish
(128 frames ≈ 2.9 ms @ 44.1 kHz). At row 0 libopenmpt retriggers notes and its
own DSP gets heavier, so any fixed per-quantum overhead is most likely to push
the callback past its deadline exactly at a pattern boundary — audible as a
hitch. #354 removed the position `postMessage` flood; three other per-quantum
costs remained and are now gated:

| Work | Before | Now |
|------|--------|-----|
| `get_time_at_position` (up to 3 WASM calls, for `rowFraction`) | every quantum | only when a position report is due (~60 Hz) |
| Per-channel VU sweep (up to 32 WASM calls) | every quantum | sampled at report rate; last snapshot reused in between |
| `projectm-pcm` interleave + `postMessage` (~88/s) | always | only when a Project-M consumer exists (popup/iframe) |

The report gate is the hoisted `shouldReportPosition` boolean — it drives both
the report-only work and the `postMessage` itself, so they cannot drift apart.
`tests/workletRegressionGuards.test.ts` asserts all three.

### `?audioDiag=1` — process() timing

Add `?audioDiag=1` (or set `localStorage.xasm1_audio_diag = '1'`) and reload.
The worklet then times every `process()` call and posts a rolling summary with
each position report. Read it from the console while playing:

```js
window.__AUDIO_DIAG__
// { budgetMs, quanta, avgProcessMs, maxProcessMs, overruns,
//   totalQuanta, totalOverruns,
//   wraps, wrapMaxProcessMs, wrapOverruns, order, row, updatedAt }
```

`wrap*` fields cover only the quanta where the row counter went backwards — a
pattern wrap or order change — and are worst-case-since-enabled so a hitch every
few patterns stays visible. Any `wrapOverruns > 0` also logs an
`[AudioDiag] process() overran…` console warning naming the order/row.

Interpretation:

- `wrapMaxProcessMs > budgetMs` with `overruns` near zero elsewhere → the
  boundary itself is over budget (worklet/libopenmpt — hypothesis A).
- `maxProcessMs` high everywhere → general worklet overload, not boundary-specific.
- Both near zero while a hitch is still audible → the problem is main-thread/GPU
  or the visual playhead snap, not the DSP. Re-test with `?renderer=html`.

Diagnostics are off unless requested; the timing code costs two
`performance.now()` calls per quantum only when enabled.
