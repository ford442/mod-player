#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/build-wasm.sh – SINGLE supported C++/Emscripten native worklet build
#
# ⚠️  NEVER write public/worklets/openmpt-worklet.js — that file is the tracked
#     JS AudioWorklet processor (production path). Native glue is openmpt-native.*.
#
# Prerequisites:
#   1. Emscripten SDK — **pinned to 3.1.51** (scripts/lib/wasm-flags.sh; matches CI):
#        git clone https://github.com/emscripten-core/emsdk.git
#        cd emsdk && ./emsdk install 3.1.51 && ./emsdk activate 3.1.51
#        source ./emsdk_env.sh            (or EMSDK_ENV=/path/to/emsdk_env.sh)
#      Any other active emcc is a hard error unless XASM_ALLOW_EMSDK_DRIFT=1.
#
#   2. libopenmpt source (version + sha256 in scripts/lib/libopenmpt-source.sh; auto-downloaded
#        and hash-checked if missing): vendor/libopenmpt-<ver>+release is the pristine tree,
#        vendor/libopenmpt-native-<release|debug> the per-mode build trees copied from it.
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
#   INITIAL_MEMORY=128mb is a HARD CAP covering ONE resident C++ OpenMPTModule per
#   song, the file bytes staged for it, its pattern snapshot, the 8192-frame stereo
#   ring and the 128 KiB worklet stack. load_module() parses each file exactly ONCE,
#   on the main thread (cpp/native_engine.cpp); commit_module() publishes that module
#   to the audio thread through one atomic exchange, and the module it replaces comes
#   back through a "graveyard" slot to be freed on the main thread — the audio thread
#   never parses, frees or allocates. Peak residency is the playing song + the next
#   one while it loads (the old design had the same peak, plus a second parse of the
#   next song). load_module() also heap-probes and returns a typed ERR_OUT_OF_MEMORY
#   (get_last_error) rather than letting libopenmpt throw into the no-catch ABI.
#   --grow (MAXIMUM_MEMORY=512mb) is the escape hatch for huge ITs. Do not raise
#   the default 128mb cap here.
#
# Release opts (Phases 2–3): thin LTO, -msimd128, section GC, emmalloc, fixed heap,
# wrapper -fno-exceptions/-fno-rtti, STACK_SIZE=128KiB (main thread; matches worklet stack).
# libopenmpt.a is built with native wasm exceptions and linked with them (#491): its C API
# and its loaders catch their own throws, which a no-catch link turned into abort().
# Feature flags, the exception model and libopenmpt's dropped makefile flags come from
# scripts/lib/wasm-flags.sh, shared with the JS-engine build.
#
# The build is TWO emcc phases: -fno-exceptions/-fno-rtti are compile-only, and the
# link runs through em++. Collapsing them back into one emcc call is what made
# native-full-build red (DISABLE_EXCEPTION_THROWING=1 vs __cxa_throw). See the
# comment above the compile/link block before touching COMPILE_FLAGS.
#
# libopenmpt.a is rebuilt automatically when the flags that produce it change: each mode
# builds in its own tree (vendor/libopenmpt-native-<release|debug>) and records a stamp of
# {mode, emsdk pin, libopenmpt version, CXXFLAGS/CFLAGS, make flags, emcc version} in
# bin/.native-flags (and the source version in .libopenmpt-version). A missing or different stamp means `make clean` + rebuild, so there is
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

# shellcheck source=scripts/lib/wasm-flags.sh
source "$SCRIPT_DIR/lib/wasm-flags.sh"
# shellcheck source=scripts/lib/libopenmpt-source.sh
source "$SCRIPT_DIR/lib/libopenmpt-source.sh"

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
# libopenmpt requires Emscripten >= 3.1.51 (see src/mpt/base/detect_os.hpp). The pin itself
# lives in scripts/lib/wasm-flags.sh (WASM_EMSDK_PIN); a mismatch is fatal further down.
EMSDK_PIN="$WASM_EMSDK_PIN"

# Activate emsdk unless an emcc is already on PATH (EMSDK_ENV first, then the usual places).
if [[ "$PRINT_FLAG_STAMP" -ne 1 ]]; then
    source_emsdk_env "$PROJECT_ROOT"
fi

CPP_DIR="$PROJECT_ROOT/cpp"
OUTPUT_DIR="$PROJECT_ROOT/public/worklets"
# Hard-coded basename — never openmpt-worklet (tracked JS processor).
OUTPUT_BASENAME="openmpt-native"
TRACKED_JS_WORKLET="$OUTPUT_DIR/openmpt-worklet.js"
VENDOR_ROOT="$PROJECT_ROOT/vendor"
# The build tree for THIS mode. Debug and release get separate trees so they never share (or
# silently reuse) one bin/libopenmpt.a; this is also the directory CI caches. Version-free on
# purpose: the version is part of the flag stamp, and the tree records the sources it holds.
LIBOPENMPT_VENDOR_DIR="$VENDOR_ROOT/libopenmpt-native-${BUILD_MODE}"

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

# Main-thread C stack (the load_module() parse). Worklet stack is a separate
# memalign(16, 128*1024) buffer in worklet_processor.cpp — not this flag.
STACK_SIZE_FLAG=-sSTACK_SIZE=131072

if [[ "$DEBUG_MODE" -eq 1 ]]; then
    # ASSERTIONS=2: expensive runtime checks — CI/debug builds only
    # -mbulk-memory/-matomics are NOT optional here: WASM_WORKERS links with
    # --shared-memory, and wasm-ld rejects objects built without those features.
    # (Debug deliberately keeps -msimd128 and LTO off for readable stack traces.)
    COMPILE_FLAGS=(-O0 -g -DDEBUG "${WASM_FEATURE_FLAGS[@]}" -matomics)
    CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)
    EMSCRIPTEN_FLAGS=(
        -sASSERTIONS=2
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=128mb
        -sMAXIMUM_MEMORY=256mb
        "$STACK_SIZE_FLAG"
    )
    echo "🔧 Building in DEBUG mode (ASSERTIONS=2)"
else
    COMPILE_FLAGS=(
        -O3 -DNDEBUG
        -flto=thin
        -msimd128
        "${WASM_FEATURE_FLAGS[@]}" -matomics
        -ffunction-sections -fdata-sections
    )
    CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)
    # shellcheck disable=SC2054  # -Wl,... is ONE linker pass-through argument, not a comma-separated list
    LINK_FLAGS=(-Wl,--gc-sections)
    EMSCRIPTEN_FLAGS=(
        -sASSERTIONS=0
        -sMALLOC=emmalloc
        -sALLOW_MEMORY_GROWTH=0
        -sINITIAL_MEMORY=128mb
        "$STACK_SIZE_FLAG"
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

# libopenmpt static lib must be built with matching release opts (LTO + SIMD + atomics for
# WASM_WORKERS) and with the shared feature set + native wasm exceptions (wasm-flags.sh).
# Do NOT add -fno-exceptions here: libopenmpt_c.cpp uses try/catch as the C API error boundary,
# and its loaders throw and catch internally on ordinary malformed input. Up to #491 the link
# used DISABLE_EXCEPTION_CATCHING=1 (libc++abi-noexcept), which made every one of those catch
# blocks dead code: a truncated IT sample block aborted the worklet. The link now uses
# -fwasm-exceptions too, so they run. The wrapper itself stays -fno-exceptions/-fno-rtti: it
# only calls the C API, and nothing unwinds through it.
#
# The flags go on the make command line, which REPLACES the makefiles' own CXXFLAGS/CFLAGS
# (see wasm-flags.sh for why, and for the -std / -fvisibility / -fno-strict-aliasing that
# replacement used to drop silently).
LIBOPENMPT_RELEASE_CXXFLAGS="-O3 -DNDEBUG -msimd128 -flto=thin -matomics ${WASM_FEATURE_FLAGS[*]} ${WASM_EH_FLAGS[*]} ${LIBOPENMPT_CXX_EXTRA_FLAGS[*]}"
LIBOPENMPT_RELEASE_CFLAGS="-O3 -DNDEBUG -msimd128 -flto=thin -matomics ${WASM_FEATURE_FLAGS[*]} ${WASM_EH_FLAGS[*]} ${LIBOPENMPT_C_EXTRA_FLAGS[*]}"
# Debug: the wrapper links with --shared-memory (WASM_WORKERS), and wasm-ld rejects any object
# built without -matomics/-mbulk-memory — libopenmpt.a included. -O1, not -O0, so the debug
# engine can still keep up with real time; no LTO/SIMD to match the wrapper's debug flags.
LIBOPENMPT_DEBUG_CXXFLAGS="-O1 -matomics ${WASM_FEATURE_FLAGS[*]} ${WASM_EH_FLAGS[*]} ${LIBOPENMPT_CXX_EXTRA_FLAGS[*]}"
LIBOPENMPT_DEBUG_CFLAGS="-O1 -matomics ${WASM_FEATURE_FLAGS[*]} ${WASM_EH_FLAGS[*]} ${LIBOPENMPT_C_EXTRA_FLAGS[*]}"
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
echo "📌 Pin (CI): emsdk ${EMSDK_PIN}"
EMCC_VERSION_LINE="$(emcc --version 2>/dev/null | head -1 || true)"
require_emsdk_pin build-wasm.sh

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

# Copy the verified pristine sources into $1 and record which version they are, so a version
# bump can never build an old tree under a new stamp.
copy_pristine_libopenmpt() {
    local dest="$1" pristine
    pristine="$(libopenmpt_ensure_pristine "$VENDOR_ROOT")"
    echo "📂 Copying libopenmpt ${LIBOPENMPT_VERSION} sources from $pristine (objects excluded)…"
    libopenmpt_copy_sources "$pristine" "$dest"
    echo "$LIBOPENMPT_VERSION" > "$dest/.libopenmpt-version"
}

resolve_libopenmpt_paths() {
    local include_root lib_dir

    if [[ -n "${LIBOPENMPT_INCLUDE:-}" ]] && [[ -f "$(libopenmpt_header_path "$LIBOPENMPT_INCLUDE")" ]]; then
        : # the caller-provided LIBOPENMPT_INCLUDE is valid — keep it
    elif include_root="$(find_libopenmpt_include_root "$LIBOPENMPT_DIR")"; then
        LIBOPENMPT_INCLUDE="$include_root"
    else
        return 1
    fi

    if [[ -n "${LIBOPENMPT_LIB:-}" ]] && [[ -f "$LIBOPENMPT_LIB/libopenmpt.a" ]]; then
        : # the caller-provided LIBOPENMPT_LIB is valid — keep it
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

# Make sure the per-mode tree holds the pinned libopenmpt version's sources: reuse it only if it
# records that version, else replace it with a fresh copy of the verified pristine tree.
prepare_managed_tree() {
    if is_valid_openmpt_source "$LIBOPENMPT_VENDOR_DIR" && libopenmpt_has_required_api "$LIBOPENMPT_VENDOR_DIR" \
        && [[ "$(cat "$LIBOPENMPT_VENDOR_DIR/.libopenmpt-version" 2>/dev/null)" == "$LIBOPENMPT_VERSION" ]]; then
        return 0
    fi
    if [[ -d "$LIBOPENMPT_VENDOR_DIR" ]]; then
        echo "⚠️  Replacing build tree at $LIBOPENMPT_VENDOR_DIR (incomplete or not libopenmpt ${LIBOPENMPT_VERSION})"
        rm -rf "$LIBOPENMPT_VENDOR_DIR"
    fi
    copy_pristine_libopenmpt "$LIBOPENMPT_VENDOR_DIR"
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
    # flags and version (CI actions/cache hit or an earlier local run); anything else rebuilds, so
    # editing LIBOPENMPT_*_FLAGS or bumping libopenmpt can never leave a stale archive in use.
    if resolve_libopenmpt_paths && libopenmpt_has_required_api "$LIBOPENMPT_DIR" && libopenmpt_stamp_matches \
        && [[ "$(cat "$LIBOPENMPT_DIR/.libopenmpt-version" 2>/dev/null)" == "$LIBOPENMPT_VERSION" ]]; then
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
  '_get_pattern_cells',
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
for src in openmpt_wrapper native_engine wasm_workers_tls worklet_processor; do
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

echo "🔗 Linking native worklet (em++; native wasm exceptions for libopenmpt.a)..."

# -sFILESYSTEM=0: nothing here touches Emscripten's FS (the module arrives as a malloc'd buffer via
# load_module, and printf/fprintf go through the stdio write hook, which stays). Measured on
# emsdk 3.1.51 (release): the .wasm is byte-identical and the JS glue shrinks 162,258 -> 115,997 B
# (27.4 -> 15.6 kB gzip). The JS libopenmpt build already links this way.

em++ \
    "${COMPILE_FLAGS[@]}" \
    "${WASM_EH_FLAGS[@]}" \
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
    -sFILESYSTEM=0 \
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

if [[ -f "$OUTPUT_DIR/${OUTPUT_BASENAME}.wasm" ]]; then
    # Instruction-level check: SIMD (release), exceptions, saturating float→int, bulk memory, atomics.
    WASM_PROFILE=native
    [[ "$DEBUG_MODE" -eq 1 ]] && WASM_PROFILE=native-debug
    node "$SCRIPT_DIR/verify-wasm-features.mjs" --profile "$WASM_PROFILE" "$OUTPUT_DIR/${OUTPUT_BASENAME}.wasm"
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
