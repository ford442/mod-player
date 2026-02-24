#!/usr/bin/env bash
# Simple libopenmpt WASM build script

set -e

echo "=== OpenMPT WASM Build (Simple) ==="

# Source emsdk
source /workspaces/codepit/emsdk/emsdk_env.sh 2>/dev/null || source /opt/emsdk/emsdk_env.sh 2>/dev/null || {
    echo "Emscripten not found"
    exit 1
}

export EM_CACHE="$HOME/.emscripten_cache"
mkdir -p "$EM_CACHE"

cd "$(dirname "$0")"

# Clean up
rm -rf vendor/libopenmpt public/worklets
mkdir -p vendor public/worklets

# Download source
echo "Downloading libopenmpt..."
curl -sL -o libopenmpt.tar.gz "https://github.com/OpenMPT/openmpt/archive/refs/tags/libopenmpt-0.7.12.tar.gz"
tar -xzf libopenmpt.tar.gz
mv openmpt-libopenmpt-0.7.12 vendor/libopenmpt
rm libopenmpt.tar.gz

cd vendor/libopenmpt

# Build with single job to avoid concurrency issues
echo "Building libopenmpt (this may take 5-10 minutes)..."
make CONFIG=emscripten -j1 2>&1 | tee build.log | grep -E "(CXX|AR|Error|error:)" || true

# Check if build succeeded
if [ ! -f "bin/libopenmpt.a" ]; then
    echo "❌ Build failed - checking log..."
    tail -50 build.log
    exit 1
fi

echo "✅ libopenmpt built successfully"
cd ../..

# Build AudioWorklet
echo "Building AudioWorklet..."
emcc -O3 -std=c++17 \
    -s AUDIO_WORKLET=1 \
    -s WASM_WORKERS=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web,worker \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createOpenMPTModule" \
    -s SINGLE_FILE=0 \
    -s INITIAL_MEMORY=33554432 \
    -s STACK_SIZE=131072 \
    -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','getValue','setValue']" \
    -s EXPORTED_FUNCTIONS="['_init_audio','_load_module','_resume_audio','_suspend_audio','_seek_order_row','_set_loop','_set_volume','_poll_position','_malloc','_free']" \
    -I vendor/libopenmpt/include \
    -L vendor/libopenmpt/bin \
    -lopenmpt \
    cpp/openmpt_wrapper.cpp \
    cpp/worklet_processor.cpp \
    --pre-js cpp/pre.js \
    -o public/worklets/openmpt-worklet.js \
    --no-entry

echo "✅ Build complete!"
ls -la public/worklets/
