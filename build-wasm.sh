#!/usr/bin/env bash
# =======================================================================
# build-wasm.sh  –  OpenMPT WASM AudioWorklet Build Script
#
# Usage:
#   ./build-wasm.sh [--debug]
#
# Output:
#   public/worklets/openmpt-worklet.js   (Emscripten glue)
#   public/worklets/openmpt-worklet.wasm (WebAssembly binary)
#   public/worklets/openmpt-worklet.aw.js (AudioWorklet bootstrap)
#
# Requirements:
#   - Emscripten 3.1+ (emsdk) installed
#   - git, make in PATH
# =======================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== OpenMPT WASM AudioWorklet Build ==="

# ── 1. Source emsdk ─────────────────────────────────────────────────
if ! command -v emcc &>/dev/null; then
    EMSDK_CANDIDATES=(
        "/opt/emsdk/emsdk_env.sh"
        "/workspaces/codepit/emsdk/emsdk_env.sh"
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
    echo "❌ emcc not found. Please activate emsdk first:" >&2
    echo "   source /path/to/emsdk/emsdk_env.sh" >&2
    exit 1
fi

export EM_CACHE="${HOME}/.emscripten_cache"
mkdir -p "$EM_CACHE"

echo "📦 Emscripten: $(emcc --version | head -1)"

# ── 2. Download libopenmpt ──────────────────────────────────────────
LIBOPENMPT_VERSION="0.8.4"
# Tarball is named *.release.makefile.tar.gz but extracts to libopenmpt-X.Y.Z+release/
LIBOPENMPT_TARBALL="libopenmpt-${LIBOPENMPT_VERSION}+release.makefile.tar.gz"
LIBOPENMPT_DIR="libopenmpt-${LIBOPENMPT_VERSION}+release"

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

if [ ! -d "$LIBOPENMPT_DIR" ]; then
    echo "🔨 Downloading libopenmpt ${LIBOPENMPT_VERSION}..."
    if ! wget -q "https://lib.openmpt.org/files/libopenmpt/src/${LIBOPENMPT_TARBALL}" -O libopenmpt.tar.gz; then
        echo "❌ Failed to download ${LIBOPENMPT_TARBALL}" >&2
        exit 1
    fi
    if ! tar xzf libopenmpt.tar.gz; then
        echo "❌ Failed to extract libopenmpt.tar.gz" >&2
        exit 1
    fi
    rm -f libopenmpt.tar.gz
    if [ ! -d "$LIBOPENMPT_DIR" ]; then
        echo "❌ Expected directory '$LIBOPENMPT_DIR' after extract." >&2
        echo "   Contents: $(ls -1)" >&2
        exit 1
    fi
fi

# ── 3. Build libopenmpt ─────────────────────────────────────────────
if ! find_libopenmpt_lib_dir "$LIBOPENMPT_DIR" >/dev/null; then
    echo "🔨 Building libopenmpt..."
    pushd "$LIBOPENMPT_DIR" >/dev/null
    make CONFIG=emscripten -j"$(nproc 2>/dev/null || echo 2)"
    popd >/dev/null
fi

LIBOPENMPT_INCLUDE="$(find_libopenmpt_include_root "$LIBOPENMPT_DIR")" || {
    echo "❌ libopenmpt headers not found under $LIBOPENMPT_DIR" >&2
    exit 1
}
LIBOPENMPT_LIB="$(find_libopenmpt_lib_dir "$LIBOPENMPT_DIR")" || {
    echo "❌ libopenmpt.a not found under $LIBOPENMPT_DIR" >&2
    exit 1
}

echo "✅ libopenmpt ready! (include=$LIBOPENMPT_INCLUDE lib=$LIBOPENMPT_LIB)"

# ── 4. Clean and prepare output directories ─────────────────────────
rm -rf public/worklets
mkdir -p public/worklets

# ── 5. Compile AudioWorklet ─────────────────────────────────────────
echo "Compiling AudioWorklet..."

DEBUG_FLAGS="-O3 -DNDEBUG"
if [[ "${1:-}" == "--debug" ]]; then
    DEBUG_FLAGS="-O0 -g -DDEBUG -sASSERTIONS=2"
    echo "🔧 DEBUG mode"
else
    echo "🔧 RELEASE mode"
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
    -I"$LIBOPENMPT_INCLUDE" \
    -L"$LIBOPENMPT_LIB" \
    -lopenmpt \
    \
    cpp/openmpt_wrapper.cpp \
    cpp/worklet_processor.cpp \
    \
    --pre-js cpp/pre.js \
    \
    -o public/worklets/openmpt-worklet.js \
    --no-entry

echo "✅ Build complete!"
ls -la public/worklets/
