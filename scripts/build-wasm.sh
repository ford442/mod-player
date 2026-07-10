#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/build-wasm.sh – SINGLE supported C++/Emscripten native worklet build
#
# ⚠️  NEVER write public/worklets/openmpt-worklet.js — that file is the tracked
#     JS AudioWorklet processor (production path). Native glue is openmpt-native.*.
#
# Prerequisites:
#   1. Emscripten SDK — **pinned to 3.1.50** (matches CI `.github/workflows/ci.yml`):
#        git clone https://github.com/emscripten-core/emsdk.git
#        cd emsdk && ./emsdk install 3.1.50 && ./emsdk activate 3.1.50
#        source ./emsdk_env.sh
#      Newer emsdk often works; CI and docs treat 3.1.50 as the verified pin.
#
#   2. libopenmpt source (auto-downloaded if missing):
#        vendor/libopenmpt-0.8.4+release  (from lib.openmpt.org tarball)
#        Or override: export LIBOPENMPT_DIR=/path/to/libopenmpt
#
#   3. Emscripten builds need STATIC_LIB=1 (handled automatically) to produce
#      bin/libopenmpt.a for linking with emcc.
#
# Usage:
#   ./scripts/build-wasm.sh              # release (-O3)
#   ./scripts/build-wasm.sh --debug      # -O0 -g -sASSERTIONS=2
#   ./scripts/build-wasm.sh --safe-heap  # + SAFE_HEAP (slow; debug memory)
#   npm run build:emcc                   # preferred package.json entry
#   npm run build:worklet                # deprecated alias → this script
#
# Output (gitignored until built):
#   public/worklets/openmpt-native.js
#   public/worklets/openmpt-native.wasm
#   public/worklets/openmpt-native.aw.js
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Pinned emsdk version (must match CI) ─────────────────────────────
# Override only for local experiments: EMSDK_PIN=latest ./scripts/build-wasm.sh
EMSDK_PIN="${EMSDK_PIN:-3.1.50}"

# Source Emscripten
CANDIDATES=(
    "/opt/emsdk/emsdk_env.sh"
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
# Hard-coded basename — never openmpt-worklet (tracked JS processor).
OUTPUT_BASENAME="openmpt-native"
TRACKED_JS_WORKLET="$OUTPUT_DIR/openmpt-worklet.js"
VENDOR_ROOT="$PROJECT_ROOT/vendor"
LIBOPENMPT_VERSION="0.8.4"
LIBOPENMPT_TARBALL="libopenmpt-${LIBOPENMPT_VERSION}+release.makefile.tar.gz"
LIBOPENMPT_VENDOR_NAME="libopenmpt-${LIBOPENMPT_VERSION}+release"
LIBOPENMPT_VENDOR_DIR="$VENDOR_ROOT/$LIBOPENMPT_VENDOR_NAME"
LEGACY_VENDOR_DIR="$VENDOR_ROOT/libopenmpt"

# libopenmpt paths (override with LIBOPENMPT_DIR env var)
LIBOPENMPT_DIR="${LIBOPENMPT_DIR:-$LIBOPENMPT_VENDOR_DIR}"
LIBOPENMPT_MAKE_FLAGS=(
    CONFIG=emscripten
    STATIC_LIB=1
    SHARED_LIB=0
    DYNLINK=0
    EXAMPLES=0
    OPENMPT123=0
)

# ── Flags from argv ──────────────────────────────────────────────────
DEBUG_MODE=0
SAFE_HEAP=0
for arg in "$@"; do
    case "$arg" in
        --debug) DEBUG_MODE=1 ;;
        --safe-heap) SAFE_HEAP=1 ;;
        -h|--help)
            sed -n '2,35p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (use --debug and/or --safe-heap)" >&2
            exit 1
            ;;
    esac
done

DEBUG_FLAGS="-O3 -DNDEBUG"
if [[ "$DEBUG_MODE" -eq 1 ]]; then
    # ASSERTIONS=2: expensive runtime checks — CI/debug builds only
    DEBUG_FLAGS="-O0 -g -DDEBUG -sASSERTIONS=2"
    echo "🔧 Building in DEBUG mode (ASSERTIONS=2)"
else
    echo "🔧 Building in RELEASE mode"
fi

EXTRA_SANITIZER_FLAGS=()
if [[ "$SAFE_HEAP" -eq 1 ]]; then
    EXTRA_SANITIZER_FLAGS+=(-sSAFE_HEAP=1)
    echo "🔧 SAFE_HEAP=1 enabled (slow; debug memory corruption)"
fi

# Verify emcc is available
if ! command -v emcc &> /dev/null; then
    echo "❌ emcc not found. Please activate emsdk ${EMSDK_PIN}:"
    echo "   git clone https://github.com/emscripten-core/emsdk.git && cd emsdk"
    echo "   ./emsdk install ${EMSDK_PIN} && ./emsdk activate ${EMSDK_PIN}"
    echo "   source ./emsdk_env.sh"
    exit 1
fi

echo "📦 Emscripten version: $(emcc --version | head -1)"
echo "📌 Documented pin (CI): emsdk ${EMSDK_PIN}"

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
    local candidate found

    for candidate in "$dir/bin" "$dir/lib"; do
        if [[ -f "$candidate/libopenmpt.a" ]]; then
            echo "$candidate"
            return 0
        fi
    done

    found="$(find "$dir/bin" -maxdepth 2 -name 'libopenmpt.a' -print -quit 2>/dev/null || true)"
    if [[ -n "$found" ]]; then
        dirname "$found"
        return 0
    fi

    return 1
}

is_valid_openmpt_source() {
    local dir="$1"
    [[ -f "$dir/Makefile" ]] && find_libopenmpt_include_root "$dir" >/dev/null
}

download_libopenmpt_tarball() {
    local dest_parent="$1"
    local dest="$dest_parent/$LIBOPENMPT_VENDOR_NAME"
    local archive="$dest_parent/$LIBOPENMPT_TARBALL"

    mkdir -p "$dest_parent"
    echo "📥 Downloading libopenmpt ${LIBOPENMPT_VERSION}…"
    if ! wget -q "https://lib.openmpt.org/files/libopenmpt/src/${LIBOPENMPT_TARBALL}" -O "$archive"; then
        echo "❌ Failed to download ${LIBOPENMPT_TARBALL}" >&2
        exit 1
    fi
    if ! tar xzf "$archive" -C "$dest_parent"; then
        echo "❌ Failed to extract ${LIBOPENMPT_TARBALL}" >&2
        exit 1
    fi
    rm -f "$archive"
    if [[ ! -d "$dest" ]]; then
        echo "❌ Expected directory '$dest' after extract." >&2
        exit 1
    fi
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
    echo "🔨 Building libopenmpt for Emscripten (STATIC_LIB=1; this takes a few minutes)…"
    pushd "$LIBOPENMPT_DIR" >/dev/null
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" -j"$(nproc 2>/dev/null || echo 2)" bin/libopenmpt.a
    popd >/dev/null
}

report_libopenmpt_failure() {
  echo "❌ libopenmpt is not ready after build." >&2
  if ! find_libopenmpt_include_root "$LIBOPENMPT_DIR" >/dev/null; then
    echo "   Missing header: libopenmpt/libopenmpt.h" >&2
    echo "   Checked: $LIBOPENMPT_DIR/include and $LIBOPENMPT_DIR" >&2
  fi
  if ! find_libopenmpt_lib_dir "$LIBOPENMPT_DIR" >/dev/null; then
    echo "   Missing static library: libopenmpt.a" >&2
    echo "   Checked: $LIBOPENMPT_DIR/bin and $LIBOPENMPT_DIR/lib" >&2
    echo "   Note: emscripten defaults to STATIC_LIB=0; this script forces STATIC_LIB=1." >&2
  fi
  echo "   Try: rm -rf $VENDOR_ROOT && $0" >&2
  exit 1
}

ensure_libopenmpt() {
    if resolve_libopenmpt_paths; then
        echo "✅ libopenmpt ready at $LIBOPENMPT_DIR"
        return 0
    fi

    if [[ -n "${LIBOPENMPT_DIR:-}" ]] && [[ "$LIBOPENMPT_DIR" != "$LIBOPENMPT_VENDOR_DIR" ]] && is_valid_openmpt_source "$LIBOPENMPT_DIR"; then
        echo "📦 Using LIBOPENMPT_DIR=$LIBOPENMPT_DIR"
    elif is_valid_openmpt_source "$LIBOPENMPT_VENDOR_DIR"; then
        LIBOPENMPT_DIR="$LIBOPENMPT_VENDOR_DIR"
        echo "📦 Using vendored libopenmpt at $LIBOPENMPT_DIR"
    elif is_valid_openmpt_source "$LEGACY_VENDOR_DIR"; then
        LIBOPENMPT_DIR="$LEGACY_VENDOR_DIR"
        echo "📦 Using legacy vendor checkout at $LIBOPENMPT_DIR"
    else
        if [[ -d "$LEGACY_VENDOR_DIR" ]] && ! is_valid_openmpt_source "$LEGACY_VENDOR_DIR"; then
            echo "⚠️  Removing incomplete legacy vendor tree at $LEGACY_VENDOR_DIR"
            rm -rf "$LEGACY_VENDOR_DIR"
        fi
        if [[ -d "$LIBOPENMPT_VENDOR_DIR" ]] && ! is_valid_openmpt_source "$LIBOPENMPT_VENDOR_DIR"; then
            echo "⚠️  Removing incomplete vendor tree at $LIBOPENMPT_VENDOR_DIR"
            rm -rf "$LIBOPENMPT_VENDOR_DIR"
        fi
        download_libopenmpt_tarball "$VENDOR_ROOT"
        LIBOPENMPT_DIR="$LIBOPENMPT_VENDOR_DIR"
    fi

    if ! find_libopenmpt_lib_dir "$LIBOPENMPT_DIR" >/dev/null; then
        build_libopenmpt_in_place
    fi

    if ! resolve_libopenmpt_paths; then
        report_libopenmpt_failure
    fi

    echo "✅ libopenmpt built at $LIBOPENMPT_DIR"
}

ensure_libopenmpt

echo "📁 Source:     $CPP_DIR"
echo "📁 Output:     $OUTPUT_DIR/${OUTPUT_BASENAME}.*"
echo "📁 libopenmpt: include=$LIBOPENMPT_INCLUDE  lib=$LIBOPENMPT_LIB"
echo ""

# Safety: never use the production JS worklet basename
if [[ "$OUTPUT_BASENAME" == "openmpt-worklet" ]]; then
    echo "❌ Refusing to write openmpt-worklet.* — that basename is the tracked JS processor." >&2
    exit 1
fi

# Snapshot tracked JS worklet so we can detect accidental clobber
TRACKED_BEFORE_HASH=""
if [[ -f "$TRACKED_JS_WORKLET" ]]; then
    TRACKED_BEFORE_HASH="$(cksum "$TRACKED_JS_WORKLET" | awk '{print $1" "$2}')"
fi

mkdir -p "$OUTPUT_DIR"

# ── EXPORTED_FUNCTIONS ───────────────────────────────────────────────
# Must match EMSCRIPTEN_KEEPALIVE in cpp/worklet_processor.cpp and
# usage in audio-worklet/OpenMPTWorkletEngine.ts (+ types.ts).
# Keep in sync; CI runs scripts/verify-native-exports.mjs.
EXPORTED_FUNCTIONS=$(cat <<'EOF'
[
  '_init_audio',
  '_init_audio_with_context',
  '_load_module',
  '_resume_audio',
  '_suspend_audio',
  '_seek_order_row',
  '_set_loop',
  '_set_volume',
  '_poll_position',
  '_get_audio_context',
  '_get_worklet_node',
  '_cleanup_audio',
  '_set_ring_buffer',
  '_get_ring_write_head',
  '_get_num_channels',
  '_get_num_orders',
  '_get_order_pattern',
  '_get_pattern_num_rows',
  '_get_pattern_row_channel_command',
  '_malloc',
  '_free'
]
EOF
)
# Collapse to single line for emcc
EXPORTED_FUNCTIONS_FLAT="$(echo "$EXPORTED_FUNCTIONS" | tr -d '\n' | sed 's/  */ /g')"

# ── Compile ──────────────────────────────────────────────────────────
echo "🔨 Compiling C++ → WebAssembly (openmpt-native)..."

emcc \
    $DEBUG_FLAGS \
    "${EXTRA_SANITIZER_FLAGS[@]+"${EXTRA_SANITIZER_FLAGS[@]}"}" \
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
    -sMAXIMUM_MEMORY=536870912 \
    -sENVIRONMENT=web,worker \
    -sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','getValue','setValue']" \
    -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS_FLAT" \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="createOpenMPTModule" \
    -sINITIAL_MEMORY=33554432 \
    -sSTACK_SIZE=131072 \
    --pre-js "$CPP_DIR/pre.js" \
    \
    -o "$OUTPUT_DIR/${OUTPUT_BASENAME}.js"

# ── Post-build safety checks ─────────────────────────────────────────
if [[ ! -f "$OUTPUT_DIR/${OUTPUT_BASENAME}.js" ]]; then
    echo "❌ Expected $OUTPUT_DIR/${OUTPUT_BASENAME}.js was not produced" >&2
    exit 1
fi

# Refuse if anything wrote the tracked JS processor path as Emscripten glue
if [[ -f "$TRACKED_JS_WORKLET" ]]; then
    TRACKED_AFTER_HASH="$(cksum "$TRACKED_JS_WORKLET" | awk '{print $1" "$2}')"
    if [[ -n "$TRACKED_BEFORE_HASH" && "$TRACKED_BEFORE_HASH" != "$TRACKED_AFTER_HASH" ]]; then
        echo "❌ FATAL: public/worklets/openmpt-worklet.js changed during native build." >&2
        echo "   The tracked JS AudioWorklet processor must never be overwritten." >&2
        exit 1
    fi
    # Content sniff: modularized Emscripten glue is not an AudioWorkletProcessor
    if ! grep -q 'AudioWorkletProcessor\|registerProcessor' "$TRACKED_JS_WORKLET"; then
        echo "❌ FATAL: openmpt-worklet.js no longer looks like the JS processor." >&2
        exit 1
    fi
else
    echo "⚠️  Warning: tracked JS worklet missing at $TRACKED_JS_WORKLET" >&2
fi

# Never leave a stray openmpt-worklet.wasm from older scripts
if [[ -f "$OUTPUT_DIR/openmpt-worklet.wasm" ]]; then
    echo "⚠️  Removing obsolete $OUTPUT_DIR/openmpt-worklet.wasm (native output is openmpt-native.wasm)"
    rm -f "$OUTPUT_DIR/openmpt-worklet.wasm" "$OUTPUT_DIR/openmpt-worklet.aw.js"
fi

echo ""
echo "✅ Build complete!"
echo ""
echo "Generated files:"
ls -lh "$OUTPUT_DIR/${OUTPUT_BASENAME}"* 2>/dev/null || echo "   (check output directory)"
echo ""
echo "📋 Next steps:"
echo "   1. Deploy public/worklets/openmpt-native.* alongside the tracked JS worklet"
echo "   2. OpenMPTWorkletEngine.ts loads openmpt-native.js automatically when present"
echo "   3. Production JS path remains public/worklets/openmpt-worklet.js (untouched)"
