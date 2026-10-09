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
#        vendor/libopenmpt-0.8.4+release-native-<release|debug>  (one build tree per mode, copied
#        from an existing source tree or extracted from the lib.openmpt.org tarball)
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
#   ./scripts/build-wasm.sh --print-flag-stamp [--debug]
#                                        # print the libopenmpt flag stamp and exit (needs no emcc;
#                                        # CI uses it as the libopenmpt.a cache key)
#
# Heap contract (release, ALLOW_MEMORY_GROWTH=0):
#   INITIAL_MEMORY=128mb is a HARD CAP covering ONE resident C++ OpenMPTModule,
#   the file bytes staged for it, the 8192-frame stereo ring, the 128 KiB worklet
#   stack, and pattern metadata. load_module() parses a transient g_metaModule on
#   the main thread and commit_module() unloads it *before* the audio thread
#   creates g_module on the AudioWorklet thread, so the two are never resident at
#   the same time. load_module() also heap-probes and returns a typed
#   ERR_OUT_OF_MEMORY (get_last_error) rather than letting libopenmpt throw into
#   the no-catch ABI.
#   --grow (MAXIMUM_MEMORY=512mb) is the escape hatch for huge ITs. Do not raise
#   the default 128mb cap here.
#
# Release opts (Phases 2–3): thin LTO, -msimd128, section GC, emmalloc, fixed heap,
# wrapper -fno-exceptions/-fno-rtti, STACK_SIZE=128KiB (main thread; matches worklet stack).
# libopenmpt.a keeps exceptions (C API try/catch in libopenmpt_c.cpp).
#
# The build is TWO emcc phases: -fno-exceptions/-fno-rtti are compile-only, and the
# link runs through em++. Collapsing them back into one emcc call is what made
# native-full-build red (DISABLE_EXCEPTION_THROWING=1 vs __cxa_throw). See the
# comment above the compile/link block before touching COMPILE_FLAGS.
#
# libopenmpt.a is rebuilt automatically when the flags that produce it change: each mode
# builds in its own tree (vendor/libopenmpt-<ver>+release-native-<release|debug>) and records
# a stamp of {mode, emsdk pin, libopenmpt version, CXXFLAGS/CFLAGS, make flags, emcc version}
# in bin/.native-flags. A missing or different stamp means `make clean` + rebuild, so there is
# nothing to delete by hand after editing LIBOPENMPT_*_FLAGS. Bump LIBOPENMPT_BUILD_REV to force
# a rebuild for a reason the flags don't capture.
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

# ── Flags from argv ──────────────────────────────────────────────────
# Parsed before emsdk is sourced so --print-flag-stamp never needs a toolchain.
DEBUG_MODE=0
SAFE_HEAP=0
GROW_HEAP=0
PRINT_FLAG_STAMP=0
for arg in "$@"; do
    case "$arg" in
        --debug) DEBUG_MODE=1 ;;
        --safe-heap) SAFE_HEAP=1 ;;
        --grow) GROW_HEAP=1 ;;
        --print-flag-stamp) PRINT_FLAG_STAMP=1 ;;
        -h|--help)
            sed -n '2,40p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (use --debug, --safe-heap, --grow, and/or --print-flag-stamp)" >&2
            exit 1
            ;;
    esac
done

if [[ "$PRINT_FLAG_STAMP" -eq 1 ]]; then
    # stdout must carry nothing but the stamp (CI captures it as a cache key). Everything
    # else this script prints on the way — mode banners, sourcing emsdk_env.sh — goes to
    # stderr; the stamp is written to the saved original stdout, fd 3.
    exec 3>&1 1>&2
fi

BUILD_MODE=release
if [[ "$DEBUG_MODE" -eq 1 ]]; then
    BUILD_MODE=debug
fi

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
# Pristine sources: the name the tarball extracts to, and where older versions of this script
# built in place. Only ever a donor now — nothing is built in it.
LIBOPENMPT_SOURCE_DIR="$VENDOR_ROOT/$LIBOPENMPT_VENDOR_NAME"
# The build tree for THIS mode. Debug and release get separate trees so they never share (or
# silently reuse) one bin/libopenmpt.a; this is also the directory CI caches.
LIBOPENMPT_VENDOR_DIR="$VENDOR_ROOT/${LIBOPENMPT_VENDOR_NAME}-native-${BUILD_MODE}"
LEGACY_VENDOR_DIR="$VENDOR_ROOT/libopenmpt"

# libopenmpt paths (override with LIBOPENMPT_DIR env var; an override is used as-is, unstamped)
LIBOPENMPT_DIR="${LIBOPENMPT_DIR:-$LIBOPENMPT_VENDOR_DIR}"
LIBOPENMPT_MAKE_FLAGS=(
    CONFIG=emscripten
    STATIC_LIB=1
    SHARED_LIB=0
    DYNLINK=0
    EXAMPLES=0
    OPENMPT123=0
)

# ── Compile / link flags ─────────────────────────────────────────────
# Phase 2: SIMD, thin LTO, WASM feature flags, section GC, emmalloc.
# Wrapper: -fno-exceptions -fno-rtti. libopenmpt.a keeps C++ exceptions (C API).
# Phase 3: fixed heap (ALLOW_MEMORY_GROWTH=0) to avoid growth pauses during audio.
#
# COMPILE_FLAGS are shared by BOTH phases (ThinLTO does codegen at link time, so
# -msimd128/-matomics/-flto must be repeated there or SIMD is silently dropped).
# CXX_ONLY_FLAGS are compile-only on purpose — see the two-phase note below.
COMPILE_FLAGS=()
CXX_ONLY_FLAGS=()
LINK_FLAGS=()
EMSCRIPTEN_FLAGS=()

# Main-thread C stack (the transient g_metaModule parse). Worklet stack is a separate
# memalign(16, 128*1024) buffer in worklet_processor.cpp — not this flag.
STACK_SIZE_FLAG=-sSTACK_SIZE=131072

if [[ "$DEBUG_MODE" -eq 1 ]]; then
    # ASSERTIONS=2: expensive runtime checks — CI/debug builds only
    # -mbulk-memory/-matomics are NOT optional here: WASM_WORKERS links with
    # --shared-memory, and wasm-ld rejects objects built without those features.
    # (Debug deliberately keeps -msimd128 and LTO off for readable stack traces.)
    COMPILE_FLAGS=(-O0 -g -DDEBUG -mbulk-memory -matomics)
    CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)
    EMSCRIPTEN_FLAGS=(
        -sASSERTIONS=2
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=128mb
        -sMAXIMUM_MEMORY=256mb
        "$STACK_SIZE_FLAG"
        -sDISABLE_EXCEPTION_CATCHING=1
    )
    echo "🔧 Building in DEBUG mode (ASSERTIONS=2)"
else
    COMPILE_FLAGS=(
        -O3 -DNDEBUG
        -flto=thin
        -msimd128
        -mbulk-memory -matomics -mnontrapping-fptoint -msign-ext
        -ffunction-sections -fdata-sections
    )
    CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)
    LINK_FLAGS=(-Wl,--gc-sections)
    EMSCRIPTEN_FLAGS=(
        -sASSERTIONS=0
        -sMALLOC=emmalloc
        -sALLOW_MEMORY_GROWTH=0
        -sINITIAL_MEMORY=128mb
        "$STACK_SIZE_FLAG"
        -sDISABLE_EXCEPTION_CATCHING=1
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
#
# Note what that boundary is actually worth at runtime: the link resolves
# -lc++abi-ww-noexcept (DISABLE_EXCEPTION_CATCHING=1), so libopenmpt_c.cpp's catch
# blocks are dead code and a throw aborts the module instead of returning null.
# That has been true of every green build here; keeping -fno-exceptions off the
# libopenmpt CXXFLAGS is about compiling it at all, not about live error recovery.
LIBOPENMPT_RELEASE_CXXFLAGS='-O3 -DNDEBUG -msimd128 -flto=thin -mbulk-memory -matomics'
LIBOPENMPT_RELEASE_CFLAGS='-O3 -DNDEBUG -msimd128 -flto=thin -mbulk-memory -matomics'
# Debug: the wrapper links with --shared-memory (WASM_WORKERS), and wasm-ld rejects any object
# built without -matomics/-mbulk-memory — libopenmpt.a included. Without explicit flags the
# libopenmpt makefile falls back to its own optimisation defaults and none of that, so these are
# not optional. -O1, not -O0, so the debug engine can still keep up with real time; no LTO/SIMD to
# match the wrapper's debug flags.
LIBOPENMPT_DEBUG_CXXFLAGS='-O1 -mbulk-memory -matomics'
LIBOPENMPT_DEBUG_CFLAGS='-O1 -mbulk-memory -matomics'
# Bump to force every cached libopenmpt.a to rebuild for a reason the flags above don't capture.
LIBOPENMPT_BUILD_REV=1

if [[ "$DEBUG_MODE" -eq 1 ]]; then
    LIBOPENMPT_CXXFLAGS="$LIBOPENMPT_DEBUG_CXXFLAGS"
    LIBOPENMPT_CFLAGS="$LIBOPENMPT_DEBUG_CFLAGS"
else
    LIBOPENMPT_CXXFLAGS="$LIBOPENMPT_RELEASE_CXXFLAGS"
    LIBOPENMPT_CFLAGS="$LIBOPENMPT_RELEASE_CFLAGS"
fi

# ── libopenmpt.a flag stamp ──────────────────────────────────────────
# Everything that decides what libopenmpt.a contains. Derived from the PIN, not from
# `emcc --version`, so CI can compute it (as the actions/cache key) before emsdk is installed;
# the on-disk stamp below additionally folds in the emcc that actually ran.
libopenmpt_flag_stamp() {
    printf '%s\n' \
        "rev=$LIBOPENMPT_BUILD_REV" \
        "mode=$BUILD_MODE" \
        "emsdk=$EMSDK_PIN" \
        "libopenmpt=$LIBOPENMPT_VERSION" \
        "cxxflags=$LIBOPENMPT_CXXFLAGS" \
        "cflags=$LIBOPENMPT_CFLAGS" \
        "make=${LIBOPENMPT_MAKE_FLAGS[*]}" \
        | sha256sum | cut -c1-16
}

if [[ "$PRINT_FLAG_STAMP" -eq 1 ]]; then
    libopenmpt_flag_stamp >&3
    exit 0
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

# Download the release tarball and move its sources to $1 (the tarball extracts to
# $LIBOPENMPT_VENDOR_NAME, which is not where the per-mode trees live).
download_libopenmpt_tarball() {
    local dest="$1"
    local archive="$VENDOR_ROOT/$LIBOPENMPT_TARBALL"
    local extract_dir

    mkdir -p "$VENDOR_ROOT"
    echo "📥 Downloading libopenmpt ${LIBOPENMPT_VERSION}…"
    if ! wget -q "https://lib.openmpt.org/files/libopenmpt/src/${LIBOPENMPT_TARBALL}" -O "$archive"; then
        echo "❌ Failed to download ${LIBOPENMPT_TARBALL}" >&2
        exit 1
    fi
    extract_dir="$(mktemp -d "$VENDOR_ROOT/.extract.XXXXXX")"
    if ! tar xzf "$archive" -C "$extract_dir"; then
        echo "❌ Failed to extract ${LIBOPENMPT_TARBALL}" >&2
        rm -rf "$extract_dir"
        exit 1
    fi
    rm -f "$archive"
    if [[ ! -d "$extract_dir/$LIBOPENMPT_VENDOR_NAME" ]]; then
        echo "❌ Expected directory '$LIBOPENMPT_VENDOR_NAME' after extract." >&2
        rm -rf "$extract_dir"
        exit 1
    fi
    mv "$extract_dir/$LIBOPENMPT_VENDOR_NAME" "$dest"
    rmdir "$extract_dir"
}

# Copy a libopenmpt source tree to $2 without build output, so the copy always compiles from scratch.
copy_libopenmpt_sources() {
    local from="$1" to="$2"
    mkdir -p "$to"
    tar -C "$from" --exclude='./bin' --exclude='*.o' --exclude='*.d' --exclude='*.a' -cf - . | tar -C "$to" -xf -
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
    echo "🔨 Building libopenmpt for Emscripten (${BUILD_MODE}, STATIC_LIB=1; this takes a few minutes)…"
    echo "   libopenmpt CXXFLAGS: $LIBOPENMPT_CXXFLAGS"
    pushd "$LIBOPENMPT_DIR" >/dev/null
    # Drop stale .o/.d from prior emsdk versions (e.g. bits/stdint.h paths that moved).
    echo "   make clean (CONFIG=emscripten)…"
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" clean
    # Flags go on the make command line so they REPLACE (not extend) the config's CXXFLAGS.
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" \
        CXXFLAGS="$LIBOPENMPT_CXXFLAGS" CFLAGS="$LIBOPENMPT_CFLAGS" \
        -j"$(nproc 2>/dev/null || echo 2)" bin/libopenmpt.a
    popd >/dev/null
}

# The stamp recorded beside a built libopenmpt.a. Config stamp + the emcc that actually ran
# (EMCC_VERSION_LINE is set before ensure_libopenmpt is called).
libopenmpt_disk_stamp() {
    printf '%s\n%s\n' "$(libopenmpt_flag_stamp)" "$EMCC_VERSION_LINE" | sha256sum | cut -c1-16
}

libopenmpt_stamp_file() {
    echo "$LIBOPENMPT_DIR/bin/.native-flags"
}

# True when the tree's libopenmpt.a was built with exactly the current flags.
libopenmpt_stamp_matches() {
    local stamp_file
    stamp_file="$(libopenmpt_stamp_file)"
    [[ -f "$stamp_file" && "$(cat "$stamp_file")" == "$(libopenmpt_disk_stamp)" ]]
}

# Make sure the per-mode tree holds libopenmpt sources: reuse it, else copy from an existing
# source tree (without its objects), else download.
prepare_managed_tree() {
    local donor
    if is_valid_openmpt_source "$LIBOPENMPT_VENDOR_DIR" && libopenmpt_has_required_api "$LIBOPENMPT_VENDOR_DIR"; then
        return 0
    fi
    if [[ -d "$LIBOPENMPT_VENDOR_DIR" ]]; then
        echo "⚠️  Removing incomplete or outdated build tree at $LIBOPENMPT_VENDOR_DIR"
        rm -rf "$LIBOPENMPT_VENDOR_DIR"
    fi
    for donor in "$LIBOPENMPT_SOURCE_DIR" "$LEGACY_VENDOR_DIR"; do
        if is_valid_openmpt_source "$donor" && libopenmpt_has_required_api "$donor"; then
            echo "📂 Copying libopenmpt sources from $donor (objects excluded)…"
            copy_libopenmpt_sources "$donor" "$LIBOPENMPT_VENDOR_DIR"
            return 0
        fi
    done
    download_libopenmpt_tarball "$LIBOPENMPT_VENDOR_DIR"
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
    # A LIBOPENMPT_DIR override is the caller's own tree: use its prebuilt .a as-is (we can't know
    # what flags built it), or build in place if it only has sources. No stamp, no cleanup of our own.
    if [[ "$LIBOPENMPT_DIR" != "$LIBOPENMPT_VENDOR_DIR" ]]; then
        if resolve_libopenmpt_paths && libopenmpt_has_required_api "$LIBOPENMPT_DIR"; then
            echo "✅ libopenmpt ready at $LIBOPENMPT_DIR (LIBOPENMPT_DIR override — prebuilt .a used as-is, flags not checked)"
            echo "   include=$LIBOPENMPT_INCLUDE  lib=$LIBOPENMPT_LIB"
            return 0
        fi
        if is_valid_openmpt_source "$LIBOPENMPT_DIR" && libopenmpt_has_required_api "$LIBOPENMPT_DIR"; then
            echo "📦 Using LIBOPENMPT_DIR=$LIBOPENMPT_DIR"
            if ! find_libopenmpt_lib_dir "$LIBOPENMPT_DIR" >/dev/null; then
                build_libopenmpt_in_place
            fi
            if ! resolve_libopenmpt_paths; then
                report_libopenmpt_failure
            fi
            echo "✅ libopenmpt built at $LIBOPENMPT_DIR"
            return 0
        fi
        echo "⚠️  LIBOPENMPT_DIR=$LIBOPENMPT_DIR is not a usable libopenmpt tree — using the managed $BUILD_MODE tree instead" >&2
        LIBOPENMPT_DIR="$LIBOPENMPT_VENDOR_DIR"
    fi

    # Managed per-mode tree. Reuse its libopenmpt.a only if it was built with exactly the current
    # flags (CI actions/cache hit or an earlier local run); anything else rebuilds, so editing
    # LIBOPENMPT_*_FLAGS can never leave a stale archive in use.
    if resolve_libopenmpt_paths && libopenmpt_has_required_api "$LIBOPENMPT_DIR" && libopenmpt_stamp_matches; then
        echo "✅ libopenmpt ready at $LIBOPENMPT_DIR (${BUILD_MODE}, flag stamp $(libopenmpt_flag_stamp) — skipping make)"
        echo "   include=$LIBOPENMPT_INCLUDE  lib=$LIBOPENMPT_LIB"
        return 0
    fi
    if [[ -f "$LIBOPENMPT_DIR/bin/libopenmpt.a" ]]; then
        echo "♻️  libopenmpt.a in $LIBOPENMPT_DIR is stale or unstamped (flags changed or built by an older script) — rebuilding"
    fi

    prepare_managed_tree
    rm -f "$LIBOPENMPT_DIR/bin/libopenmpt.a" "$(libopenmpt_stamp_file)"
    build_libopenmpt_in_place
    mkdir -p "$LIBOPENMPT_DIR/bin"
    libopenmpt_disk_stamp > "$(libopenmpt_stamp_file)"

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
#
# _init_audio is headless-harness only (it builds its own AudioContext at the
# same locked 48000/'playback' as utils/audioContextFactory.ts so benches stay
# comparable). Production always uses _init_audio_with_context; nothing in the
# app may call _init_audio.
EXPORTED_FUNCTIONS=$(cat <<'EOF'
[
  '_init_audio',
  '_init_audio_with_context',
  '_load_module',
  '_commit_module',
  '_get_last_error',
  '_clear_last_error',
  '_resume_audio',
  '_suspend_audio',
  '_seek_order_row',
  '_set_loop',
  '_set_volume',
  '_set_channel_mute',
  '_set_render_param',
  '_ctl_set_text',
  '_poll_position',
  '_get_position_seq',
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

# ── Compile + link (TWO phases, on purpose) ──────────────────────────
#
# -fno-exceptions / -fno-rtti are COMPILE-ONLY (CXX_ONLY_FLAGS).  Passing them
# to a combined compile+link emcc call makes Emscripten infer
# DISABLE_EXCEPTION_THROWING=1 at link, which drops __cxa_throw /
# __cxa_allocate_exception — symbols libopenmpt.a (libopenmpt_c.cpp's try/catch
# C API boundary) still references.  That is what broke native-full-build.
#
# Measured under emsdk 3.1.51 (release, 4-mat_madness fixture build): dropping
# CXX_ONLY_FLAGS entirely yields a BYTE-IDENTICAL openmpt-native.wasm (1,784,342 B)
# — libopenmpt.a pulls the exception runtime in either way, so these two flags buy
# no size at all on the wrapper.  They stay to keep the wrapper honest about being
# a no-throw C-API shim; do not "optimize" by moving them onto the link line.
#
# The link runs through em++ (not emcc): once the inputs are .o files there is
# no .cpp suffix left for the driver to infer C++ from, so emcc would skip
# libc++/libc++abi entirely and every `operator new` in libopenmpt.a would be
# undefined.  COMPILE_FLAGS are repeated on the link line because ThinLTO does
# codegen at link time — drop -msimd128 there and verify:native-simd goes red.
OBJ_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openmpt-native-obj.XXXXXX")"
cleanup_obj_dir() { rm -rf "$OBJ_DIR"; }
trap cleanup_obj_dir EXIT

echo "🔨 Compiling C++ objects (-fno-exceptions -fno-rtti)..."

OBJECTS=()
for src in openmpt_wrapper worklet_processor; do
    obj="$OBJ_DIR/${src}.o"
    em++ \
        "${COMPILE_FLAGS[@]}" \
        "${CXX_ONLY_FLAGS[@]+"${CXX_ONLY_FLAGS[@]}"}" \
        "${EXTRA_SANITIZER_FLAGS[@]+"${EXTRA_SANITIZER_FLAGS[@]}"}" \
        -std=c++17 \
        -I"$LIBOPENMPT_INCLUDE" \
        -c "$CPP_DIR/${src}.cpp" \
        -o "$obj"
    OBJECTS+=("$obj")
done

echo "🔗 Linking native worklet (em++; exceptions left enabled for libopenmpt.a)..."

em++ \
    "${COMPILE_FLAGS[@]}" \
    "${LINK_FLAGS[@]+"${LINK_FLAGS[@]}"}" \
    "${EXTRA_SANITIZER_FLAGS[@]+"${EXTRA_SANITIZER_FLAGS[@]}"}" \
    \
    "${OBJECTS[@]}" \
    -L"$LIBOPENMPT_LIB" \
    -lopenmpt \
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
    --post-js "$CPP_DIR/post.js" \
    \
    -o "$OUTPUT_DIR/${OUTPUT_BASENAME}.js"

# emcc 3.1.51 may still omit AUDIO_WORKLET helpers on Module and/or emit the
# old main-thread setTimeout smash — normalize the glue in place.
node "$SCRIPT_DIR/patch-native-glue.mjs" "$OUTPUT_DIR/${OUTPUT_BASENAME}.js"

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
