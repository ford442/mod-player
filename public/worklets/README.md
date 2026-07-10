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
# emsdk 3.1.50 (CI pin)
source /path/to/emsdk/emsdk_env.sh
npm run build:emcc
# → openmpt-native.js / .wasm / .aw.js (gitignored until built)
```

| Do | Don’t |
|----|--------|
| `npm run build:emcc` → `openmpt-native.*` | Write Emscripten glue as `openmpt-worklet.js` |
| Keep tracked `openmpt-worklet.js` as JS processor | `rm -rf public/worklets` before build |

Probed at runtime by `OpenMPTWorkletEngine` / `useWorkletLoader`. Root `./build-wasm.sh` only forwards to `scripts/build-wasm.sh`.

## CI / hygiene

```bash
npm run verify:wasm   # every *.wasm under public/ and dist/ must have \0asm magic
```

Never commit failed download bodies (404 HTML) as `.wasm`.
