# OpenMPT WASM Build Solutions

## Problem
Building libopenmpt WASM takes 5-10 minutes and requires significant resources. The build fails in resource-constrained environments.

## Current Status
- ✅ Emscripten 5.0.2-git detected
- ✅ Build script updated
- ❌ Build times out due to compilation time
- ✅ Stub files created for development

## Solutions (Pick One)

### Option 1: Build Locally (Recommended)
Build on your local machine with sufficient resources:

```bash
# On your local machine (not in codespace)
git clone https://github.com/ford442/mod-player.git
cd mod-player
./build-wasm.sh
```

Then upload the built files:
```bash
# After successful build
scp public/worklets/openmpt-worklet.* user@server:/path/to/project/
```

### Option 2: Use Docker
Create a `Dockerfile.build`:

```dockerfile
FROM emscripten/emsdk:latest

WORKDIR /build
COPY . .

RUN ./build-wasm.sh

# Output will be in public/worklets/
```

Build:
```bash
docker build -f Dockerfile.build -t mod-player-build .
docker create --name extract mod-player-build
docker cp extract:/build/public/worklets/openmpt-worklet.js public/worklets/
docker cp extract:/build/public/worklets/openmpt-worklet.wasm public/worklets/
docker rm extract
```

### Option 3: GitHub Actions CI
Add to `.github/workflows/build.yml`:

```yaml
name: Build WASM
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Emscripten
        uses: mymindstorm/setup-emsdk@v11
        with:
          version: latest
          
      - name: Build libopenmpt
        run: ./build-wasm.sh
        
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: wasm-files
          path: |
            public/worklets/openmpt-worklet.js
            public/worklets/openmpt-worklet.wasm
```

### Option 4: Development Mode (Current)
Use stub files for UI development:

```bash
npm run dev
# Audio won't work, but UI is functional
```

## Build Script Changes Made

Updated `build-wasm.sh`:
1. ✅ Uses local emsdk from `/workspaces/codepit/emsdk` (v5.0.2-git)
2. ✅ Sets `EM_CACHE` to user-writable directory
3. ✅ Uses libopenmpt 0.7.12 (stable release)
4. ✅ Recursive clone for submodules

## Manual Build Instructions

If you want to try building manually:

```bash
cd projects/mod-player

# 1. Clean up
rm -rf vendor public/worklets

# 2. Source Emscripten
export EM_CACHE="$HOME/.emscripten_cache"
source /workspaces/codepit/emsdk/emsdk_env.sh

# 3. Clone with submodules
git clone --recursive --branch libopenmpt-0.7.12 \
  https://github.com/OpenMPT/openmpt.git vendor/libopenmpt

# 4. Build libopenmpt
cd vendor/libopenmpt
make CONFIG=emscripten -j4

# 5. Build AudioWorklet
cd ../..
emcc -O3 -std=c++17 \
  -s AUDIO_WORKLET=1 -s WASM_WORKERS=1 \
  -I vendor/libopenmpt/include \
  -L vendor/libopenmpt/bin -lopenmpt \
  cpp/openmpt_wrapper.cpp cpp/worklet_processor.cpp \
  -o public/worklets/openmpt-worklet.js
```

## Expected Output

After successful build:
```
public/worklets/
├── openmpt-worklet.js       (Emscripten glue)
├── openmpt-worklet.wasm     (WASM binary)
└── openmpt-worklet.aw.js    (AudioWorklet bootstrap)
```

## Troubleshooting

### "Emscripten >= 3.1.51 is required"
- Use libopenmpt 0.7.x or older for Emscripten 3.1.50
- Or upgrade Emscripten to latest

### Missing headers
- Ensure `--recursive` clone for submodules
- Check that `src/` directory exists in vendor/libopenmpt

### Build timeout
- Use Option 1 (local build) or Option 2 (Docker)
- Or use Option 3 (CI/CD)

## Current Stub

Stub files are currently in place for development:
- `public/worklets/openmpt-worklet.js` - JavaScript stub
- `public/worklets/openmpt-worklet.wasm` - Placeholder

Replace these with real built files when available.
