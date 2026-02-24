#!/usr/bin/env bash
# =======================================================================
# build-wasm.sh  –  Self-contained OpenMPT Web Worklet build (2026)
#
# What it does:
#   1. Sources Emscripten (emsdk) from well-known locations or $PATH.
#   2. Clones the latest libopenmpt from GitHub into vendor/libopenmpt.
#   3. Builds libopenmpt for Emscripten (make CONFIG=emscripten).
#   4. Compiles the C++ AudioWorklet source → public/worklets/.
#
# Requirements:
#   - Emscripten 5.0+ (emsdk) already installed / activated, OR available
#     at one of the candidate paths listed below.
#   - git, make in PATH.
#   - No system libopenmpt needed; this script clones it fresh every run.
#
# Usage:
#   bash ./build-wasm.sh [--debug]
#
# Output:
#   public/worklets/openmpt-worklet.js   (Emscripten glue + module factory)
#   public/worklets/openmpt-worklet.wasm (WebAssembly binary)
#   public/worklets/openmpt-worklet.aw.js (AudioWorklet thread bootstrap)
# =======================================================================

set -e

echo "=== OpenMPT Web Worklet Build (2026) ==="

# ── 1. Source emsdk ─────────────────────────────────────────────────
# Prioritize local codepit emsdk over system emsdk for newer version
EMSDK_CANDIDATES=(
    "/workspaces/codepit/emsdk/emsdk_env.sh"   # GitHub Codespace (newer)
    "/content/build_space/emsdk/emsdk_env.sh"  # Colab
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
    "$(dirname "$0")/emsdk/emsdk_env.sh"
)
for f in "${EMSDK_CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
        echo "Sourcing emsdk from $f..."
        # shellcheck disable=SC1090
        source "$f"
        break
    fi
done

if ! command -v emcc &>/dev/null; then
    echo "❌ emcc not found. Please activate emsdk first:" >&2
    echo "   source /path/to/emsdk/emsdk_env.sh" >&2
    exit 1
fi

# Set cache to user-writable location
export EM_CACHE="${HOME}/.emscripten_cache"
mkdir -p "$EM_CACHE"

echo "📦 Emscripten: $(emcc --version | head -1)"

# ── 2. Clean and prepare directories ────────────────────────────────
rm -rf vendor/libopenmpt public/worklets
mkdir -p vendor public/worklets

# ── 3. Clone libopenmpt ─────────────────────────────────────────────
echo "Cloning libopenmpt 0.7.12 (minimal)..."
# Shallow clone without submodules (not needed for Emscripten build)
git clone --depth 1 --branch libopenmpt-0.7.12 https://github.com/OpenMPT/openmpt.git vendor/libopenmpt

# ── 4. Build libopenmpt for Emscripten ──────────────────────────────
cd vendor/libopenmpt

echo "Building libopenmpt with CONFIG=emscripten..."
make CONFIG=emscripten -j55

echo "=== libopenmpt build artifacts ==="
ls -la bin/ include/ 2>/dev/null || true

cd ../..

# ── 5. Compile the custom AudioWorklet ──────────────────────────────
echo "Compiling custom AudioWorklet..."

# Debug vs release flags
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
