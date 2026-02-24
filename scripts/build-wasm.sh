#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# build-wasm.sh – Build the C++ AudioWorklet module with Emscripten
#
# Prerequisites:
#   1. Install Emscripten SDK (emsdk) 4.0+:
#        git clone https://github.com/emscripten-core/emsdk.git
#        cd emsdk && ./emsdk install latest && ./emsdk activate latest
#        source ./emsdk_env.sh
#
#   2. Build libopenmpt for Emscripten (or use pre-built):
#        # Option A: Build from source
#        cd libopenmpt && make CONFIG=emscripten
#        # Option B: Use pre-built .a from a known location
#        export LIBOPENMPT_DIR=/path/to/libopenmpt
#
#   3. Set environment:
#        export LIBOPENMPT_DIR=/path/to/libopenmpt  (contains include/ and lib/)
#
# Usage:
#   ./scripts/build-wasm.sh [--debug]
#
# Output:
#   public/worklets/openmpt-native.js   (Emscripten glue + AudioWorklet)
#   public/worklets/openmpt-native.wasm (WebAssembly binary)
#   public/worklets/openmpt-native.aw.js (AudioWorklet thread bootstrap)
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CPP_DIR="$PROJECT_ROOT/cpp"
OUTPUT_DIR="$PROJECT_ROOT/public/worklets"

# libopenmpt paths (override with env vars)
LIBOPENMPT_DIR="${LIBOPENMPT_DIR:-/usr/local/libopenmpt}"
LIBOPENMPT_INCLUDE="${LIBOPENMPT_INCLUDE:-$LIBOPENMPT_DIR/include}"
LIBOPENMPT_LIB="${LIBOPENMPT_LIB:-$LIBOPENMPT_DIR/lib}"

# Debug mode
DEBUG_FLAGS="-O3 -DNDEBUG"
if [[ "${1:-}" == "--debug" ]]; then
    DEBUG_FLAGS="-O0 -g -DDEBUG -sASSERTIONS=2"
    echo "🔧 Building in DEBUG mode"
else
    echo "🔧 Building in RELEASE mode"
fi

# Verify emcc is available
if ! command -v emcc &> /dev/null; then
    echo "❌ emcc not found. Please activate emsdk:"
    echo "   source /path/to/emsdk/emsdk_env.sh"
    exit 1
fi

echo "📦 Emscripten version: $(emcc --version | head -1)"

# Verify libopenmpt
if [[ ! -f "$LIBOPENMPT_INCLUDE/libopenmpt/libopenmpt.h" ]]; then
    echo "❌ libopenmpt headers not found at: $LIBOPENMPT_INCLUDE"
    echo "   Set LIBOPENMPT_DIR or LIBOPENMPT_INCLUDE environment variable"
    exit 1
fi

echo "📁 Source:  $CPP_DIR"
echo "📁 Output:  $OUTPUT_DIR"
echo "📁 libopenmpt: $LIBOPENMPT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR"

# ── Compile ──────────────────────────────────────────────────────────
echo "🔨 Compiling C++ → WebAssembly..."

emcc \
    $DEBUG_FLAGS \
    -std=c++17 \
    \
    -I"$LIBOPENMPT_INCLUDE" \
    -L"$LIBOPENMPT_LIB" \
    -lopenmpt \
    \
    "$CPP_DIR/openmpt_wrapper.cpp" \
    "$CPP_DIR/worklet_processor.cpp" \
    \
    -sAUDIO_WORKLET=1 \
    -sWASM_WORKERS=1 \
    -sASYNCIFY=1 \
    -sSINGLE_FILE=0 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT=web \
    -sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','getValue','setValue']" \
    -sEXPORTED_FUNCTIONS="['_init_audio','_load_module','_resume_audio','_suspend_audio','_seek_order_row','_set_loop','_set_volume','_poll_position','_get_audio_context','_get_worklet_node','_cleanup_audio','_malloc','_free']" \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="createOpenMPTModule" \
    -sINITIAL_MEMORY=33554432 \
    -sSTACK_SIZE=131072 \
    --pre-js "$CPP_DIR/pre.js" \
    \
    -o "$OUTPUT_DIR/openmpt-native.js"

echo ""
echo "✅ Build complete!"
echo ""
echo "Generated files:"
ls -lh "$OUTPUT_DIR/openmpt-native"* 2>/dev/null || echo "   (check output directory)"
echo ""
echo "📋 Next steps:"
echo "   1. Copy public/worklets/openmpt-native.* to your deployment"
echo "   2. The TypeScript engine (audio-worklet/OpenMPTWorkletEngine.ts)"
echo "      will load these files automatically"
