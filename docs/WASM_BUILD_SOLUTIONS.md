# OpenMPT Native WASM Build

## Single supported path

| Command | Output | Notes |
|---------|--------|--------|
| **`npm run build:emcc`** | `public/worklets/openmpt-native.{js,wasm,aw.js}` | **Canonical** |
| `npm run build:worklet` | same | Deprecated alias name → same script |
| `./build-wasm.sh` | same | Deprecated root wrapper → `scripts/build-wasm.sh` |

**Never** writes `public/worklets/openmpt-worklet.js` — that file is the tracked **JS** AudioWorklet processor (production audio path).

## Emscripten pin

CI and docs use **emsdk 3.1.50**:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 3.1.50
./emsdk activate 3.1.50
source ./emsdk_env.sh
```

Override for experiments only: `EMSDK_PIN=latest npm run build:emcc`.

## Flags (scripts/build-wasm.sh)

| Mode | Flags |
|------|--------|
| Release (default) | `-O3 -DNDEBUG` |
| `--debug` | `-O0 -g -DDEBUG -sASSERTIONS=2` |
| `--safe-heap` | `-sSAFE_HEAP=1` (slow) |
| Always | `AUDIO_WORKLET`, `WASM_WORKERS`, `ALLOW_MEMORY_GROWTH`, `MAXIMUM_MEMORY=512MB`, `INITIAL_MEMORY=32MB`, `STACK_SIZE=128KB`, `MODULARIZE`, `EXPORT_NAME=createOpenMPTModule` |

## Local build

```bash
source ~/emsdk/emsdk_env.sh   # or /opt/emsdk/emsdk_env.sh
cd /path/to/mod-player
npm run build:emcc
# optional: npm run build:emcc -- --debug
ls -lh public/worklets/openmpt-native.*
```

libopenmpt **0.8.4** is downloaded into `vendor/` automatically if missing.

## Verify exports stay in sync

```bash
npm run verify:native-exports
```

Checks `EXPORTED_FUNCTIONS` in `scripts/build-wasm.sh` against:

- `EMSCRIPTEN_KEEPALIVE` in `cpp/worklet_processor.cpp`
- Required symbols used by `audio-worklet/OpenMPTWorkletEngine.ts`

## Docker (optional)

```dockerfile
FROM emscripten/emsdk:3.1.50
WORKDIR /build
COPY . .
RUN bash scripts/build-wasm.sh
```

Copy only `public/worklets/openmpt-native.*` out of the image — never replace `openmpt-worklet.js`.

## Historical footgun (fixed)

Older root `build-wasm.sh` used `-o public/worklets/openmpt-worklet.js` and even `rm -rf public/worklets`, destroying the production JS processor. That path is retired; see `public/worklets/README.md` and `AGENTS.md`.
