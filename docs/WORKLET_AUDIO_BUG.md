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
- [ ] **Never add a `setTimeout` polyfill** that ignores the `delay` argument. Chrome 116+ has native `setTimeout` in AudioWorklet; for older browsers, use `currentTime`-based timing in `process()` instead.
- [ ] **Never `import()` an AudioWorklet processor file on the main thread.** Use `audioContext.audioWorklet.addModule()` for JS processors, or Emscripten's native API for `AUDIO_WORKLET` builds.
- [ ] **Verify line numbers in browser console.** After deploy, a hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) should show line numbers matching the current source (e.g., ~250), not the old stub (~130).
- [ ] **Never commit HTML/404 bodies as `*.wasm`.** Production glue is wasm2js (`libopenmpt-audioworklet.js`); a sibling `libopenmpt.wasm` is not required. Run `npm run verify:wasm` before commit/deploy.

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

## How to Verify the Fix Post-Deploy

1. Open DevTools → Network → check "Disable cache".
2. Hard refresh (`Ctrl+Shift+R`).
3. In Console, filter for `[Worklet]` logs. You should see:
   - `WASM base URL resolved to: ...`
   - `libopenmpt ready ✅`
   - `Module loaded ✅ ptr= ...`
4. The Network tab should show `openmpt-worklet.js?v=2` (or current version) loaded successfully.
5. Audio should play the actual MOD/XM file, not a test tone.
