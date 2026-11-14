# Fault reports (observability, phase 1)

The player records every fault it can see, locally, always on. Nothing is uploaded: a user who
hears a crackle or sees the visualizer die opens the debug panel (🔍) and presses **Copy
diagnostics**; the JSON they paste into an issue is the whole report.

## What is captured

`utils/faultReport.ts` (`recordFault`) is called from:

| Kind | Where |
|---|---|
| `error`, `unhandledrejection` | `installGlobalFaultCapture()` in `index.tsx` (window listeners, observed — never `preventDefault()`ed) |
| `worklet-fault` | `handleWorkletFault` (`hooks/audioGraph/startJsWorkletPlayback.ts`): a `processorerror` or a trapped `process()` (`fatal` WT.error) |
| `sp-fallback` | `runScriptProcessorFallback` (`hooks/audioGraph/scriptProcessorFallback.ts`) |
| `gpu-device-lost` | the WebGPU renderer's `device.lost` handler (`src/renderers/webgpu/WebGPURenderer.ts`) |
| `gpu-error` | `attachUncapturedErrorHandler` (`utils/gpuShaderCompile.ts`) |
| `worker-error` | the parser / export worker `error` listeners (`utils/parserWorker.ts`, `utils/exportWorker.ts`) and the create worker (`hooks/audioGraph/createWorkerHost.ts`) |

Each entry carries a context snapshot:

- `assets`: the `?v=` cache key of both libopenmpt pairs and both worklets, plus the libopenmpt and emsdk versions — what `scripts/symbolicate.mjs` needs.
- `transport`: FSM phase, engine (`worklet` / `scriptprocessor`), module format and the last 30 transitions (registered by `PlayerEngine`).
- `renderer`: backend, reason, shader (registered by `PatternDisplay`).
- `gpu`: the WebGPU probe report (stage, adapter info).
- `env`: user agent, cores, device memory, `crossOriginIsolated`, page visibility.
- `song.fingerprint`: the SHA-256 song fingerprint (`utils/songIdentity.ts`) — never the bytes or the name.
- `wasmHeapBytes`, and `audioDiag` when `?audioDiag=1` is on.

`wasmPair` says which libopenmpt pair a `wasm-function[N]` in the entry most likely belongs to: the
AudioWorklet runs `libopenmpt-playback` on a crossOriginIsolated page and `libopenmpt-worklet`
otherwise; the create worker always runs the playback pair; everything else the shared pair.

Other modules add a section with `registerFaultContext(name, provider)`.

## Storage

A ring of the last 50 entries in IndexedDB (`xasm1-fault-reports` / `faults`), with an in-memory
copy for when IndexedDB is unavailable (private mode, blocked). The same kind + source + message
again within 2 s is counted in the next entry's `repeats`, not stored again; at most 20 entries are
stored per minute and the rest counted in `recorder.dropped`. `recordFault` never throws.

## Privacy

Enforced in `sanitizeFaultText` / `sanitizeFaultValue` and pinned by `tests/unit/faultReport.test.ts`
(a regex over a serialised bundle):

- file names with a module, archive or audio extension become `<file:fnv32>.ext` — bare, quoted
  (`"My Song.xm"`) or parenthesised (`(My Song.xm)`), the shapes the loader logs; a context value
  that *is* a file name or path is hashed whole. An unquoted name with spaces in free text keeps the
  words before its last one: best effort, so don't put file names in error messages unquoted;
- a URL that names a module becomes `<url:fnv32>.ext`; every other URL loses its origin (the path
  and the `?v=` key stay); `file://` paths are hashed;
- binary values (typed arrays, buffers) become `[binary N bytes]`; arrays, objects and depth are capped.

No upload exists in this phase. If one is added it must be opt-in (off by default), go to the
existing storage API (`VITE_STORAGE_API_URL`) with the same payload, and must not add a third-party
SDK (a cross-origin script needs CORP under COEP `require-corp`, pitfall 3).

## Symbolication

Release wasm has no name section; the build writes the index → name map instead
(`vendor/symbol-maps/<pair>.<?v= key>.symbols`, `public/worklets/README.md`). CI uploads them as the
`libopenmpt-symbol-maps` artifact of the `js-libopenmpt-rebuild` job.

```bash
node scripts/symbolicate.mjs report.json
```

```bash
node scripts/symbolicate.mjs report.json --maps ~/Downloads/libopenmpt-symbol-maps --json > decoded.json
```

Every line with a `wasm-function[N]` frame gets `→ <function name>`, taken from the map of the pair
named in the frame's URL, else the entry's `wasmPair`, at the key in the entry's `context.assets`. A
plain-text stack trace works too (`--pair`, `--key`; the key defaults to the wasm committed in the
checkout). Exit status 1 means a frame stayed unnamed or a map was missing; the missing file names
are printed.
