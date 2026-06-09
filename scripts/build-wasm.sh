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

# Source Emscripten
CANDIDATES=(
    "/workspaces/codepit/emsdk/emsdk_env.sh"   # GitHub Codespace
    "/content/build_space/emsdk/emsdk_env.sh"  # Colab
    "$PROJECT_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then source "$f"; break; fi
done

CPP_DIR="$PROJECT_ROOT/cpp"
OUTPUT_DIR="$PROJECT_ROOT/public/worklets"
VENDOR_DIR="$PROJECT_ROOT/vendor/libopenmpt"

# libopenmpt paths (override with env vars or auto-clone below)
LIBOPENMPT_DIR="${LIBOPENMPT_DIR:-$VENDOR_DIR}"

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

# ── libopenmpt discovery / build ─────────────────────────────────────
# Installed layout (post `make CONFIG=emscripten`):  include/libopenmpt/libopenmpt.h
# Git source layout (pre-make):                      libopenmpt/libopenmpt.h at repo root
libopenmpt_header_path() {
    local include_root="$1"
    echo "$include_root/libopenmpt/libopenmpt.h"
}

find_libopenmpt_include_root() {
    local dir="$1"
    local candidate
    for candidate in "$dir/include" "$dir"; do
        if [[ -f "$(libopenmpt_header_path "$candidate")" ]]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

find_libopenmpt_lib_dir() {
    local dir="$1"
    local candidate
    for candidate in "$dir/bin" "$dir/lib"; do
        if [[ -f "$candidate/libopenmpt.a" ]]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

resolve_libopenmpt_paths() {
    local include_root lib_dir

    if [[ -n "${LIBOPENMPT_INCLUDE:-}" ]] && [[ -f "$(libopenmpt_header_path "$LIBOPENMPT_INCLUDE")" ]]; then
        LIBOPENMPT_INCLUDE="$LIBOPENMPT_INCLUDE"
    elif include_root="$(find_libopenmpt_include_root "$LIBOPENMPT_DIR")"; then
        LIBOPENMPT_INCLUDE="$include_root"
    else
        return 1
    fi

    if [[ -n "${LIBOPENMPT_LIB:-}" ]] && [[ -f "$LIBOPENMPT_LIB/libopenmpt.a" ]]; then
        LIBOPENMPT_LIB="$LIBOPENMPT_LIB"
    elif lib_dir="$(find_libopenmpt_lib_dir "$LIBOPENMPT_DIR")"; then
        LIBOPENMPT_LIB="$lib_dir"
    else
        return 1
    fi

    return 0
}

build_libopenmpt_in_place() {
    echo "🔨 Building libopenmpt for Emscripten (this takes a few minutes)…"
    pushd "$LIBOPENMPT_DIR" >/dev/null
    make CONFIG=emscripten -j"$(nproc 2>/dev/null || echo 2)"
    popd >/dev/null
}

ensure_libopenmpt() {
    if resolve_libopenmpt_paths; then
        echo "✅ libopenmpt ready at $LIBOPENMPT_DIR"
        return 0
    fi

    mkdir -p "$PROJECT_ROOT/vendor"

    if [[ ! -d "$LIBOPENMPT_DIR" ]]; then
        echo "📥 libopenmpt not found – cloning from GitHub…"
        git clone --depth 1 --branch OpenMPT-1.31 \
            https://github.com/OpenMPT/openmpt.git "$VENDOR_DIR"
    elif [[ ! -f "$LIBOPENMPT_DIR/Makefile" ]]; then
        echo "⚠️  $LIBOPENMPT_DIR exists but is not an OpenMPT checkout – recloning…"
        rm -rf "$LIBOPENMPT_DIR"
        git clone --depth 1 --branch OpenMPT-1.31 \
            https://github.com/OpenMPT/openmpt.git "$VENDOR_DIR"
    else
        echo "📦 Using existing OpenMPT checkout at $LIBOPENMPT_DIR"
    fi

    if ! find_libopenmpt_lib_dir "$LIBOPENMPT_DIR" >/dev/null; then
        build_libopenmpt_in_place
    fi

    if ! resolve_libopenmpt_paths; then
        echo "❌ libopenmpt headers or static library still missing after build." >&2
        echo "   Expected header: <include-root>/libopenmpt/libopenmpt.h" >&2
        echo "   Searched include roots: $LIBOPENMPT_DIR/include, $LIBOPENMPT_DIR" >&2
        echo "   Searched lib dirs:     $LIBOPENMPT_DIR/bin, $LIBOPENMPT_DIR/lib" >&2
        echo "   Try: rm -rf $LIBOPENMPT_DIR && $0" >&2
        exit 1
    fi

    echo "✅ libopenmpt built at $LIBOPENMPT_DIR"
}

ensure_libopenmpt

echo "📁 Source:     $CPP_DIR"
echo "📁 Output:     $OUTPUT_DIR"
echo "📁 libopenmpt: include=$LIBOPENMPT_INCLUDE  lib=$LIBOPENMPT_LIB"
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
    -sSINGLE_FILE=0 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT=web,worker \
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
