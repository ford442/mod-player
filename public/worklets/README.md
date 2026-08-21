# Audio worklet assets

Self-hosted worklet and libopenmpt assets served from `public/worklets/` (copied to `dist/worklets/` on build).

## Production JS worklet path (default)

| File | Role |
|------|------|
| `openmpt-worklet.js` | `AudioWorkletProcessor` — renders module audio in `process()` |
| `libopenmpt-audioworklet.js` | **wasm2js** Emscripten glue (~5 MB). Runtime is **embedded in JS** |

There is **no** sibling `libopenmpt.wasm` for this path. The glue is compiled with wasm2js (`isWasm2js: true`); a separate binary is neither loaded nor required.

### Load sequence

1. Main thread: `audioWorklet.addModule(…/openmpt-worklet.js?v=N)` (`hooks/useWorkletLoader.ts`; bump `WORKLET_VERSION` when the processor changes).
2. Main thread creates `AudioWorkletNode` with processor name `openmpt-processor`.
3. Main thread `fetch`es `libopenmpt-audioworklet.js`, detects wasm2js, and **does not** fetch a `.wasm`.
4. Main thread `postMessage({ type: 'initLib', scriptText })` to the worklet.
5. Worklet evaluates the glue via `new Function` (classic-script scope), waits for runtime init, then accepts `load` / `play` / `seek`.

Classic (non–wasm2js) Emscripten builds may add a real `libopenmpt.wasm`. In that case the main thread fetches it, checks the `\0asm` magic header, and transfers it as `wasmBytes`. Corrupt HTML/text is rejected at runtime and by `npm run verify:wasm`.

## Optional native C++ worklet

**Single supported build path** (never overwrites this directory’s JS processor):

```bash
# emsdk 3.1.51 (CI pin)
source /path/to/emsdk/emsdk_env.sh
npm run build:emcc
# → openmpt-native.js / .wasm / .aw.js (gitignored until built)
```

| Do | Don’t |
|----|--------|
| `npm run build:emcc` → `openmpt-native.*` | Write Emscripten glue as `openmpt-worklet.js` |
| Keep tracked `openmpt-worklet.js` as JS processor | `rm -rf public/worklets` before build |

Probed at runtime by `OpenMPTWorkletEngine` / `useWorkletLoader`. Root `./build-wasm.sh` only forwards to `scripts/build-wasm.sh`.

### Engine selection precedence

Production **default is the JS worklet**. Native is explicit opt-in (`?engine=native`) or auto-promoted only when the parity gate is open **and** glue is present. Never flip deploy defaults without a green native playhead report.

| Priority | Source | Values |
|----------|--------|--------|
| 1 (highest) | URL `?engine=` | `js` \| `native` \| `auto` |
| 2 | Public builds (`VITE_PUBLIC_MODE=1`) | Always **force-JS** (ignores sticky localStorage; only URL `native` opts in) |
| 3 | `localStorage.xasm1_audio_engine` | `js` \| `native` \| `auto` (unset = `auto`) |
| 4 | Auto + parity gate | `VITE_NATIVE_PARITY_GATE=1` or `localStorage.xasm1_native_parity_passed=1` — promotes when glue present |
| 5 | Fallback | JS worklet → ScriptProcessor on WASM init failure |

**Parity gate:** `auto` stays on JS until deploy sets `VITE_NATIVE_PARITY_GATE=1` (or local smoke marks `xasm1_native_parity_passed`). Run:

```bash
npm run build:emcc   # emsdk 3.1.51
npm run preview -- --port 4173 &
npm run smoke:playhead:native
# → artifacts/playhead-acceptance/report-native.json + native-parity.ok when green
```

Only then set `VITE_NATIVE_PARITY_GATE=1` **and** ship matching `openmpt-native.*`. Explicit `?engine=native` is never blocked by the gate. Force JS with `?engine=js` / `localStorage.xasm1_audio_engine=js`.

**Opt into native** (when artifacts are built):

```
http://localhost:5173/?engine=native
# or
localStorage.setItem('xasm1_audio_engine', 'native')
```

`?engine=native` without artifacts soft-fails to JS (console warning). The debug panel engine toggle persists `js` / `native` into localStorage.

**Main-thread wasm2js vs native WASM:** `libmpt/libopenmptjs.js` replaces `globalThis.WebAssembly` with a wasm2js stub. The app snapshots the real API in `index.html` (`window.__NATIVE_WEBASSEMBLY__`) and `OpenMPTWorkletEngine` reinstalls it before instantiate — otherwise shared-memory AudioWorklet threads fail (`bad memory`).

**Emscripten 3.1.51 AudioWorklet bootstrap:** `addModule('openmpt-native.aw.js')` is resolved against the **page URL**, not `locateFile`. The engine rewrites that path to `worklets/openmpt-native.aw.js`. C++ must pass a 16-byte-aligned worklet stack into `emscripten_start_wasm_audio_worklet_thread_async` (null stack fails).

**projectM PCM chunks** (`type: 'projectm-pcm'`) are JS-worklet-only. Native uses the ring buffer / AnalyserNode path.

**Performance capture (MediaRecorder)** requires the JS worklet — native uses a separate AudioContext. Use `?engine=js` or the UI toggle before Record clip. See `docs/EXPORT.md`.

## CI / hygiene

```bash
npm run verify:wasm          # every *.wasm under public/ and dist/ must have \0asm magic
npm run verify:native-exports
```

- **Every PR:** script clobber greps + export audit (`ci.yml` → `wasm-smoke-test`); JS `playhead-smoke`.
- **Path-filtered PR / push:** full `build:emcc` when `cpp/**`, `scripts/build-wasm.sh`, `audio-worklet/**`, `hooks/audioGraph/**`, or `native-bridge-processor.js` change — caches `vendor/libopenmpt-0.8.4+release` (`libopenmpt.a`) — then **`smoke:playhead` with `AUDIO_ENGINE=native`** (requires active engine `native-worklet`, lag median &lt; 1 row).
- **Weekly schedule:** `native-wasm-scheduled.yml` full build + artifact upload + **native playhead parity** (same cache).

Never commit failed download bodies (404 HTML) as `.wasm`. Never commit `openmpt-native.*` into git.
