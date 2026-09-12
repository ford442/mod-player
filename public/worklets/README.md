# Audio worklet assets

Self-hosted worklet and libopenmpt assets served from `public/worklets/` (copied to `dist/worklets/` on build).

> ⚠️ **`openmpt-worklet.js` and `native-bridge-processor.js` are generated — do not hand-edit them.**
> Their source of record is `src/worklets/*.ts`; `scripts/build-worklet-js.mjs` (esbuild, IIFE, no
> minify) compiles them. See [Generated worklets](#generated-worklets) below.

## Production JS worklet path (default)

| File | Role | Source |
|------|------|--------|
| `openmpt-worklet.js` | `AudioWorkletProcessor` — renders module audio in `process()` | generated from `src/worklets/openmpt-processor.ts` |
| `native-bridge-processor.js` | SAB ring-buffer bridge for the native C++ engine | generated from `src/worklets/native-bridge.ts` |
| `libopenmpt-audioworklet.js` | **wasm2js** Emscripten glue (~5 MB). Runtime is **embedded in JS** | vendor blob — never typechecked or rebuilt |

<a id="generated-worklets"></a>
### Generated worklets

```bash
npm run build:worklet-js    # regenerate (also runs as predev / prebuild)
npm run verify:worklet-js   # CI gate: fails if the tracked output is stale
npm run typecheck:worklet   # tsc -p tsconfig.worklet.json (ES2020, no DOM lib)
```

Why compile instead of hand-writing: `AudioWorkletGlobalScope` cannot `import()` or
`importScripts()`, so the processor used to duplicate the message-type constants and the
main→worklet receive guard as a second classic script
(`worklet-protocol-constants.js`, removed). Bundling lets the processor share the real TS
modules — `audio-worklet/workletProtocolConstants.ts`,
`audio-worklet/mainToWorkletMessages.ts`, `utils/audioReactive.ts` — so adding a message type
is one TypeScript change, and there is a single `addModule()` at load time.

`tsconfig.worklet.json` compiles with `lib: ["ES2020"]` and **no DOM lib**: a `document` /
`fetch` / `window` reference in the processor is a compile error, not a runtime crash on the
audio thread. Ambient worklet globals live in `src/worklets/audioworklet-env.d.ts`.

Output is never minified — `tests/workletRegressionGuards.test.ts` and
`tests/workletAudioLifecycle.test.ts` pattern-match the generated file to keep the
#329 / #330 / #354 invariants locked. **Bump `WORKLET_VERSION` in `hooks/useWorkletLoader.ts`
whenever the generated file changes.**

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

**projectM PCM chunks** are posted from both engines: JS `projectm-pcm` and native ring copy → `broadcastPcmBlock`.

**Performance capture (MediaRecorder)** uses the shared main `AudioContext` on default native (`?engine=native`). Dual-context (`?nativeCtx=legacy`) still blocks Record clip. See `docs/EXPORT.md`.

**Heap:** release native WASM is a **fixed 128mb** heap. Use `npm run build:emcc -- --grow` for huge ITs (`MAXIMUM_MEMORY=512mb`).

## CI / hygiene

```bash
npm run verify:wasm          # every *.wasm under public/ and dist/ must have \0asm magic
npm run verify:native-exports
```

- **Every PR:** script clobber greps + export audit (`ci.yml` → `wasm-smoke-test`); JS `playhead-smoke`.
- **Path-filtered PR / push:** full `build:emcc` when `cpp/**`, `scripts/build-wasm.sh`, `audio-worklet/**`, `hooks/audioGraph/**`, or `native-bridge-processor.js` change — caches `vendor/libopenmpt-0.8.4+release` (`libopenmpt.a`) — then **`smoke:playhead` with `AUDIO_ENGINE=native`** (requires active engine `native-worklet`, lag median &lt; 1 row).
- **Weekly schedule:** `native-wasm-scheduled.yml` full build + artifact upload + **native playhead parity** (same cache).

Never commit failed download bodies (404 HTML) as `.wasm`. Never commit `openmpt-native.*` into git.
