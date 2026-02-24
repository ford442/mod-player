#!/usr/bin/env bash
# =======================================================================
# build-wasm-fixed.sh  –  OpenMPT Web Worklet build (Emscripten 3.1.50 compatible)
# =======================================================================

set -e

echo "=== OpenMPT Web Worklet Build (Fixed for Emscripten 3.1.50) ==="

# ── 1. Source emsdk ─────────────────────────────────────────────────
if ! command -v emcc &>/dev/null; then
    EMSDK_CANDIDATES=(
        "/opt/emsdk/emsdk_env.sh"
        "$HOME/emsdk/emsdk_env.sh"
        "/usr/local/emsdk/emsdk_env.sh"
    )
    for f in "${EMSDK_CANDIDATES[@]}"; do
        if [ -f "$f" ]; then
            echo "Sourcing emsdk from $f..."
            source "$f"
            break
        fi
    done
fi

if ! command -v emcc &>/dev/null; then
    echo "❌ emcc not found. Please activate emsdk first." >&2
    exit 1
fi

EMCC_VERSION=$(emcc --version | head -1)
echo "📦 Emscripten: $EMCC_VERSION"

# ── 2. Prepare directories ──────────────────────────────────────────
rm -rf vendor/libopenmpt public/worklets
mkdir -p vendor public/worklets

# ── 3. Clone compatible libopenmpt version ──────────────────────────
echo "Cloning libopenmpt 0.7.12 (compatible with Emscripten 3.1.50)..."
git clone --depth 1 --branch libopenmpt-0.7.12 https://github.com/OpenMPT/openmpt.git vendor/libopenmpt

# ── 4. Build libopenmpt ─────────────────────────────────────────────
cd vendor/libopenmpt

echo "Building libopenmpt with CONFIG=emscripten..."
# Set cache to user-writable location
export EM_CACHE="${HOME}/.emscripten_cache"
mkdir -p "$EM_CACHE"

make CONFIG=emscripten -j4 2>&1 | tail -20

echo "=== libopenmpt build artifacts ==="
ls -la bin/ include/ 2>/dev/null || true

cd ../..

# ── 5. Compile AudioWorklet ─────────────────────────────────────────
echo "Compiling custom AudioWorklet..."

DEBUG_FLAGS="-O3 -DNDEBUG"
if [[ "${1:-}" == "--debug" ]]; then
    DEBUG_FLAGS="-O0 -g -DDEBUG -sASSERTIONS=2"
    echo "🔧 Building in DEBUG mode"
else
    echo "🔧 Building in RELEASE mode"
fi

emcc \
    $DEBUG_FLAGS \
    -std=c++17 \
    \
    -s AUDIO_WORKLET=1 \
    -s WASM_WORKERS=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web,worker \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createOpenMPTModule" \
    -s SINGLE_FILE=0 \
    -s INITIAL_MEMORY=33554432 \
    -s STACK_SIZE=131072 \
    \
    -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','getValue','setValue']" \
    -s EXPORTED_FUNCTIONS="['_init_audio','_load_module','_resume_audio','_suspend_audio','_seek_order_row','_set_loop','_set_volume','_poll_position','_get_audio_context','_get_worklet_node','_cleanup_audio','_get_num_channels','_get_num_orders','_get_order_pattern','_get_pattern_num_rows','_get_pattern_row_channel_command','_malloc','_free']" \
    \
    -I vendor/libopenmpt/include \
    -L vendor/libopenmpt/bin \
    -l openmpt \
    \
    cpp/openmpt_wrapper.cpp \
    cpp/worklet_processor.cpp \
    \
    --pre-js cpp/pre.js \
    \
    -o public/worklets/openmpt-worklet.js \
    --no-entry

echo "✅ Build completed successfully!"
ls -la public/worklets/
