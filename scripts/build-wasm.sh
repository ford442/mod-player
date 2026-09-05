#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/build-wasm.sh – SINGLE supported C++/Emscripten native worklet build
#
# ⚠️  NEVER write public/worklets/openmpt-worklet.js — that file is the tracked
#     JS AudioWorklet processor (production path). Native glue is openmpt-native.*.
#
# Prerequisites:
#   1. Emscripten SDK — **pinned to 3.1.51** (libopenmpt 0.8.4 minimum; matches CI):
#        git clone https://github.com/emscripten-core/emsdk.git
#        cd emsdk && ./emsdk install 3.1.51 && ./emsdk activate 3.1.51
#        source ./emsdk_env.sh
#      Newer emsdk often works; CI and docs treat 3.1.51 as the verified pin.
#
#   2. libopenmpt source (auto-downloaded if missing):
#        vendor/libopenmpt-0.8.4+release  (from lib.openmpt.org tarball)
#        Or override: export LIBOPENMPT_DIR=/path/to/libopenmpt
#
#   3. Emscripten builds need STATIC_LIB=1 (handled automatically) to produce
#      bin/libopenmpt.a for linking with emcc.
#
# Usage:
#   ./scripts/build-wasm.sh              # release (-O3 + SIMD/LTO/emmalloc/fixed 128mb heap)
#   ./scripts/build-wasm.sh --debug      # -O0 -g -sASSERTIONS=2
#   ./scripts/build-wasm.sh --safe-heap  # + SAFE_HEAP (slow; debug memory)
#   ./scripts/build-wasm.sh --grow       # ALLOW_MEMORY_GROWTH=1 MAXIMUM_MEMORY=512mb (huge ITs)
#
# Heap contract (release, ALLOW_MEMORY_GROWTH=0):
#   INITIAL_MEMORY=128mb is a HARD CAP shared by BOTH C++ OpenMPTModule instances
#   (g_module on the AudioWorklet thread + g_metaModule on the main thread), the
#   8192-frame stereo ring, the 128 KiB worklet stack, and pattern metadata.
#   --grow (MAXIMUM_MEMORY=512mb) is the escape hatch for huge ITs. Do not raise
#   the default 128mb cap here.
#
# Release opts (Phases 2–3): thin LTO, -msimd128, section GC, emmalloc, fixed heap,
# wrapper -fno-exceptions/-fno-rtti, STACK_SIZE=128KiB (main thread; matches worklet stack).
# libopenmpt.a keeps exceptions (C API try/catch in libopenmpt_c.cpp).
# After changing release flags, delete vendor/.../bin/libopenmpt.a to force rebuild.
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
# libopenmpt 0.8.4 requires Emscripten >= 3.1.51 (see src/mpt/base/detect_os.hpp).
# Override only for local experiments: EMSDK_PIN=latest ./scripts/build-wasm.sh
EMSDK_PIN="${EMSDK_PIN:-3.1.51}"

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
GROW_HEAP=0
for arg in "$@"; do
    case "$arg" in
        --debug) DEBUG_MODE=1 ;;
        --safe-heap) SAFE_HEAP=1 ;;
        --grow) GROW_HEAP=1 ;;
        -h|--help)
            sed -n '2,40p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (use --debug, --safe-heap, and/or --grow)" >&2
            exit 1
            ;;
    esac
done

# ── Compile / link flags ─────────────────────────────────────────────
# Phase 2: SIMD, thin LTO, WASM feature flags, section GC, emmalloc.
# Wrapper: -fno-exceptions -fno-rtti. libopenmpt.a keeps C++ exceptions (C API).
# Phase 3: fixed heap (ALLOW_MEMORY_GROWTH=0) to avoid growth pauses during audio.
COMPILE_FLAGS=()
LINK_FLAGS=()
EMSCRIPTEN_FLAGS=()

# Main-thread C stack (g_metaModule.parse). Worklet thread stack is a separate
# memalign(16, 128*1024) buffer in worklet_processor.cpp — not this flag.
STACK_SIZE_FLAG=-sSTACK_SIZE=131072

if [[ "$DEBUG_MODE" -eq 1 ]]; then
    # ASSERTIONS=2: expensive runtime checks — CI/debug builds only
    COMPILE_FLAGS=(-O0 -g -DDEBUG -fno-exceptions -fno-rtti)
    EMSCRIPTEN_FLAGS=(
        -sASSERTIONS=2
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=128mb
        -sMAXIMUM_MEMORY=256mb
        "$STACK_SIZE_FLAG"
        # Catching stays enabled: libopenmpt.a (libopenmpt_c.cpp) requires try/catch.
        # Wrapper objects are still compiled with -fno-exceptions.
    )
    echo "🔧 Building in DEBUG mode (ASSERTIONS=2)"
else
    COMPILE_FLAGS=(
        -O3 -DNDEBUG
        -flto=thin
        -msimd128
        -mbulk-memory -matomics -mnontrapping-fptoint -msign-ext
        -mtune=wasm32
        -ffunction-sections -fdata-sections
        -fno-exceptions
        -fno-rtti
    )
    LINK_FLAGS=(-Wl,--gc-sections)
    EMSCRIPTEN_FLAGS=(
        -sASSERTIONS=0
        -sMALLOC=emmalloc
        -sALLOW_MEMORY_GROWTH=0
        -sINITIAL_MEMORY=128mb
        "$STACK_SIZE_FLAG"
        # Catching stays enabled: libopenmpt.a (libopenmpt_c.cpp) requires try/catch.
        # Wrapper objects are still compiled with -fno-exceptions.
    )
    echo "🔧 Building in RELEASE mode (SIMD + LTO + emmalloc + fixed 128mb heap)"
fi

if [[ "$GROW_HEAP" -eq 1 ]]; then
    EMSCRIPTEN_FLAGS+=(
        -sALLOW_MEMORY_GROWTH=1
        -sMAXIMUM_MEMORY=512mb
    )
    echo "🔧 Heap growth enabled (MAXIMUM_MEMORY=512mb) — for huge ITs"
fi

# libopenmpt static lib must be built with matching release opts (LTO + SIMD + atomics for WASM_WORKERS).
# Do NOT add -fno-exceptions here: libopenmpt_c.cpp uses try/catch as the C API error boundary
# and will not compile. Wrapper/worklet still use -fno-exceptions (C API only, no throw).
LIBOPENMPT_RELEASE_CXXFLAGS='-O3 -DNDEBUG -msimd128 -flto=thin -mbulk-memory -matomics'
LIBOPENMPT_RELEASE_CFLAGS='-O3 -DNDEBUG -msimd128 -flto=thin -mbulk-memory -matomics'

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
EMCC_VERSION_LINE="$(emcc --version 2>/dev/null | head -1 || true)"
if [[ -n "$EMCC_VERSION_LINE" && "$EMSDK_PIN" != "latest" && ! "$EMCC_VERSION_LINE" == *"$EMSDK_PIN"* ]]; then
    echo "⚠️  Warning: active emcc does not report ${EMSDK_PIN}. CI uses that pin; mismatch may cause build drift." >&2
fi

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

# Native worklet C++ uses openmpt_module_get_time_at_position (added in libopenmpt 0.7+).
libopenmpt_has_required_api() {
    local dir="$1" header
    local include_root
    include_root="$(find_libopenmpt_include_root "$dir")" || return 1
    header="$(libopenmpt_header_path "$include_root")"
    grep -q 'openmpt_module_get_time_at_position' "$header" 2>/dev/null
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
    local make_extra=()
    if [[ "$DEBUG_MODE" -eq 0 ]]; then
        make_extra+=(CXXFLAGS="$LIBOPENMPT_RELEASE_CXXFLAGS" CFLAGS="$LIBOPENMPT_RELEASE_CFLAGS")
        echo "   libopenmpt CXXFLAGS: $LIBOPENMPT_RELEASE_CXXFLAGS"
    fi
    pushd "$LIBOPENMPT_DIR" >/dev/null
    # Drop stale .o/.d from prior emsdk versions (e.g. bits/stdint.h paths that moved).
    echo "   make clean (CONFIG=emscripten)…"
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" clean
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" "${make_extra[@]}" -j"$(nproc 2>/dev/null || echo 2)" bin/libopenmpt.a
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
    # Cache-friendly: when vendor/.a already exists (CI actions/cache hit or prior
    # local make), skip download + multi-minute libopenmpt compile.
    if resolve_libopenmpt_paths && libopenmpt_has_required_api "$LIBOPENMPT_DIR"; then
        echo "✅ libopenmpt ready at $LIBOPENMPT_DIR (prebuilt .a — skipping make)"
        echo "   include=$LIBOPENMPT_INCLUDE  lib=$LIBOPENMPT_LIB"
        if [[ "$DEBUG_MODE" -eq 0 ]]; then
            echo "   ℹ️  Release build uses SIMD/LTO — rm bin/libopenmpt.a if you changed optimization flags"
        fi
        return 0
    fi
    if resolve_libopenmpt_paths; then
        echo "⚠️  Prebuilt libopenmpt.a found but headers lack native-worklet API — rebuilding from source"
    fi

    if [[ -n "${LIBOPENMPT_DIR:-}" ]] && [[ "$LIBOPENMPT_DIR" != "$LIBOPENMPT_VENDOR_DIR" ]] && is_valid_openmpt_source "$LIBOPENMPT_DIR"; then
        echo "📦 Using LIBOPENMPT_DIR=$LIBOPENMPT_DIR"
    elif is_valid_openmpt_source "$LIBOPENMPT_VENDOR_DIR" && libopenmpt_has_required_api "$LIBOPENMPT_VENDOR_DIR"; then
        LIBOPENMPT_DIR="$LIBOPENMPT_VENDOR_DIR"
        echo "📦 Using vendored libopenmpt at $LIBOPENMPT_DIR"
    elif is_valid_openmpt_source "$LEGACY_VENDOR_DIR" && libopenmpt_has_required_api "$LEGACY_VENDOR_DIR"; then
        LIBOPENMPT_DIR="$LEGACY_VENDOR_DIR"
        echo "📦 Using legacy vendor checkout at $LIBOPENMPT_DIR"
    else
        if [[ -d "$LEGACY_VENDOR_DIR" ]]; then
            if ! is_valid_openmpt_source "$LEGACY_VENDOR_DIR"; then
                echo "⚠️  Removing incomplete legacy vendor tree at $LEGACY_VENDOR_DIR"
                rm -rf "$LEGACY_VENDOR_DIR"
            elif ! libopenmpt_has_required_api "$LEGACY_VENDOR_DIR"; then
                echo "⚠️  Removing outdated legacy vendor at $LEGACY_VENDOR_DIR (missing native-worklet C API)"
                rm -rf "$LEGACY_VENDOR_DIR"
            fi
        fi
        if [[ -d "$LIBOPENMPT_VENDOR_DIR" ]] && ! is_valid_openmpt_source "$LIBOPENMPT_VENDOR_DIR"; then
            echo "⚠️  Removing incomplete vendor tree at $LIBOPENMPT_VENDOR_DIR"
            rm -rf "$LIBOPENMPT_VENDOR_DIR"
        elif [[ -d "$LIBOPENMPT_VENDOR_DIR" ]] && ! libopenmpt_has_required_api "$LIBOPENMPT_VENDOR_DIR"; then
            echo "⚠️  Removing outdated vendor tree at $LIBOPENMPT_VENDOR_DIR (missing native-worklet C API)"
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
  '_set_channel_mute',
  '_set_render_param',
  '_ctl_set_text',
  '_poll_position',
  '_get_audio_context',
  '_get_worklet_node',
  '_cleanup_audio',
  '_set_ring_buffer',
  '_get_ring_write_head',
  '_get_num_channels',
  '_get_num_orders',
  '_get_num_patterns',
  '_get_duration_seconds',
  '_get_initial_bpm',
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
    "${COMPILE_FLAGS[@]}" \
    "${LINK_FLAGS[@]+"${LINK_FLAGS[@]}"}" \
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
    -sENVIRONMENT=web,worker \
    "${EMSCRIPTEN_FLAGS[@]}" \
    -sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','getValue','setValue','emscriptenGetAudioObject','emscriptenRegisterAudioObject']" \
    -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS_FLAT" \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME="createOpenMPTModule" \
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

if [[ "$DEBUG_MODE" -eq 0 && -f "$OUTPUT_DIR/${OUTPUT_BASENAME}.wasm" ]]; then
    node "$SCRIPT_DIR/verify-native-simd.mjs" "$OUTPUT_DIR/${OUTPUT_BASENAME}.wasm"
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
