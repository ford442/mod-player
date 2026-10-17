# OpenMPT Native WASM Build

## Single supported path

| Command | Output | Notes |
|---------|--------|--------|
| **`npm run build:emcc`** | `public/worklets/openmpt-native.{js,wasm,aw.js}` | **Canonical** |
| `npm run build:worklet` | same | Deprecated alias name → same script |
| `./build-wasm.sh` | same | Deprecated root wrapper → `scripts/build-wasm.sh` |

**Never** writes `public/worklets/openmpt-worklet.js` — that file is the tracked **JS** AudioWorklet processor (production audio path).

## Emscripten pin

CI and docs use **emsdk 3.1.51**:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 3.1.51
./emsdk activate 3.1.51
source ./emsdk_env.sh
```

Override for experiments only: `EMSDK_PIN=latest npm run build:emcc`.

## Flags (scripts/build-wasm.sh)

| Mode | Flags |
|------|--------|
| Release (default) | `-O3 -DNDEBUG -flto=thin -msimd128`, `MALLOC=emmalloc` |
| `--debug` | `-O0 -g -DDEBUG -sASSERTIONS=2`, growth on, `INITIAL_MEMORY=128mb`, `MAXIMUM_MEMORY=256mb` |
| `--safe-heap` | `-sSAFE_HEAP=1` (slow) |
| `--grow` | `ALLOW_MEMORY_GROWTH=1` + `MAXIMUM_MEMORY=512mb` (huge ITs) |
| Always | `AUDIO_WORKLET`, `WASM_WORKERS`, `MODULARIZE`, `EXPORT_ES6=1`, `EXPORT_NAME=createOpenMPTModule`, worklet stack 128 KiB |
| Release heap | `ALLOW_MEMORY_GROWTH=0`, `INITIAL_MEMORY=128mb` (hard cap unless `--grow`) |
| Runtime methods | ccall, cwrap, UTF8ToString, getValue, setValue, emscriptenGetAudioObject, emscriptenRegisterAudioObject |

## Local build

```bash
source ~/emsdk/emsdk_env.sh   # or /opt/emsdk/emsdk_env.sh
cd /path/to/mod-player
npm run build:emcc
# optional: npm run build:emcc -- --debug
ls -lh public/worklets/openmpt-native.*
```

libopenmpt (version + tarball **sha256** in `scripts/lib/libopenmpt-source.sh`, currently **0.8.9**) is downloaded into `vendor/libopenmpt-<ver>+release` automatically if missing, and refused if the hash does not match. Each mode builds in its own version-free tree (`vendor/libopenmpt-native-release`, `…-native-debug`) that records the source version it holds (`.libopenmpt-version`). When that tree's `bin/libopenmpt.a` already exists **and its `bin/.native-flags` stamp matches the current flags and version** (local prior build or CI `actions/cache`), `build-wasm.sh` skips the multi-minute `make` and only re-links thin C++. Editing a flag or bumping libopenmpt changes the stamp, so the archive rebuilds by itself — nothing to delete by hand. `scripts/build-wasm.sh --print-flag-stamp [--debug]` prints the stamp (no emcc needed); CI uses it as the cache key.

### One flag set for both WASM builds (#491)

`scripts/lib/wasm-flags.sh` is sourced by `build-wasm.sh` and `build-js-libopenmpt.sh`:

| Variable | Value | Why |
|---|---|---|
| `WASM_EMSDK_PIN` | `3.1.51` | Any other active emcc is a **hard error** unless `XASM_ALLOW_EMSDK_DRIFT=1`. `EMSDK_ENV=/path/to/emsdk_env.sh` picks a toolchain; an emcc already on `PATH` is never overridden. |
| `WASM_FEATURE_FLAGS` | `-mbulk-memory -mnontrapping-fptoint -msign-ext` | Every AudioWorklet browser has them; LLVM 17 only defaults sign-ext on, so libopenmpt's float→int used trapping `trunc` and its memcpy/memset were byte loops. |
| `WASM_EH_FLAGS` | `-fwasm-exceptions` (compile **and** link) | libopenmpt's C API and loaders catch their own throws. The native link used `DISABLE_EXCEPTION_CATCHING=1` until #491, which let a truncated IT sample block escape `load_module()` into JS. |
| `LIBOPENMPT_*_EXTRA_FLAGS` | `-std=…`, `-fvisibility=hidden`, C `-fno-strict-aliasing` | What libopenmpt's own makefiles add and a command-line `CXXFLAGS=`/`CFLAGS=` replaces (the flags must stay on the command line, or `config-emscripten.mk`'s `-Oz`/full LTO would win). |

Both builds' output is gated at the instruction level by `scripts/verify-wasm-features.mjs` (`--profile native` / `js`, decoder in `scripts/lib/wasm-ops.mjs`): SIMD (native only), try/catch, `trunc_sat`, bulk memory, atomics (native only). `npm run verify:native-wasm` runs the native profile.

### Runtime engine override

After building artifacts, the app still defaults to the JS worklet (`auto`). To opt into native, use `?engine=native` or the UI toggle. To force JS while a stored native preference exists:

- URL: `?engine=js`
- Storage: `localStorage.xasm1_audio_engine = 'js'` (or omit / `auto` for prefer-when-present)

See `public/worklets/README.md` for full precedence. CI: scheduled + path-filtered jobs cache the per-mode tree under the exact key `libopenmpt-native-<os>-<mode>-<stamp>` (no `restore-keys`: a prefix fallback used to restore an archive built with other flags).

## Verify exports stay in sync

```bash
npm run verify:native-exports
```

Checks `EXPORTED_FUNCTIONS` in `scripts/build-wasm.sh` against:

- `EMSCRIPTEN_KEEPALIVE` in `cpp/worklet_processor.cpp`
- Required symbols used by `audio-worklet/OpenMPTWorkletEngine.ts`

## Docker (optional)

```dockerfile
FROM emscripten/emsdk:3.1.51
WORKDIR /build
COPY . .
RUN bash scripts/build-wasm.sh
```

Copy only `public/worklets/openmpt-native.*` out of the image — never replace `openmpt-worklet.js`.

## CI

| Workflow | When | What |
|----------|------|------|
| `ci.yml` → `wasm-smoke-test` | Every PR/push | Script safety, shellcheck (warning+), `verify:native-exports`, emsdk **3.1.51** pin |
| `native-wasm-scheduled.yml` | Weekly + manual | Full `npm run build:emcc`, artifact upload, JS worklet integrity check |

## Historical footgun (fixed)

The old root `build-wasm.sh` (since deleted) used `-o public/worklets/openmpt-worklet.js` and even `rm -rf public/worklets`, destroying the production JS processor. That path is retired; see `public/worklets/README.md` and `AGENTS.md`.
