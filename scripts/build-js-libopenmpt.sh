#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/build-js-libopenmpt.sh – real-WASM libopenmpt for the DEFAULT JS engine
#
# Output (tracked in git, like public/libmpt/ used to be):
#   public/worklets/libopenmpt-worklet.js    classic-script Emscripten glue (~tens of KB)
#   public/worklets/libopenmpt-worklet.wasm  real \0asm binary
#   audio-worklet/js/libopenmpt-worklet.generated.json   manifest (sizes, SRI, cache key)
#
# One artifact pair serves every JS-engine libopenmpt consumer:
#   * AudioWorklet   – main thread fetches both files, posts {scriptText, wasmBytes}
#   * main thread    – <script src> (index.html, via vite-plugins/libopenmptHtml.ts)
#   * parser worker  – new Function(glue) + locateFile → the same .wasm
# so nothing replaces globalThis.WebAssembly any more (the wasm2js war is over).
#
# This is NOT the native engine. No -sAUDIO_WORKLET / WASM_WORKERS, no shared
# memory, no C++ wrapper: stock openmpt_* C exports only. The native engine stays
# scripts/build-wasm.sh → openmpt-native.*; the two builds use DIFFERENT
# libopenmpt.a trees (both copy the same hash-checked pristine sources), so the
# native cache and this build cannot contaminate each other. Feature flags, the
# exception model and libopenmpt's dropped makefile flags come from
# scripts/lib/wasm-flags.sh, shared with the native build (#491).
#
# ⚠️  NEVER name an output openmpt-worklet.* — that basename is the tracked JS
#     processor (generated from audio-worklet/js/openmpt-processor.ts).
#
# Prerequisites: emsdk (pinned 3.1.51 in scripts/lib/wasm-flags.sh — same as
# scripts/build-wasm.sh / CI; another active emcc is fatal unless XASM_ALLOW_EMSDK_DRIFT=1).
#   source /path/to/emsdk/emsdk_env.sh   OR   EMSDK_ENV=/path/to/emsdk_env.sh
#
# Usage:
#   scripts/build-js-libopenmpt.sh                 # release: -O3, wasm-EH, no SIMD
#   scripts/build-js-libopenmpt.sh --simd          # + -msimd128 (measure first; see docs)
#   scripts/build-js-libopenmpt.sh --eh=js         # JS-based exceptions (-fexceptions)
#   scripts/build-js-libopenmpt.sh --debug         # -O0 -g -sASSERTIONS=2
#   OUT_DIR=/tmp/x OUT_BASENAME=variant scripts/build-js-libopenmpt.sh   # A/B builds
#                                                  # (skips the manifest write)
#
# Exception handling: libopenmpt's C API reports bad files by catching C++
# exceptions internally and returning NULL. With catching disabled a throw aborts
# the module, so a corrupt upload would kill the whole worklet. Default is
# native wasm exceptions (-fwasm-exceptions: zero cost on the non-throw path, no
# JS invoke_* trampolines); --eh=js is the portable-but-slower fallback.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/lib/wasm-flags.sh
source "$SCRIPT_DIR/lib/wasm-flags.sh"
# shellcheck source=scripts/lib/libopenmpt-source.sh
source "$SCRIPT_DIR/lib/libopenmpt-source.sh"

EMSDK_PIN="$WASM_EMSDK_PIN"

# ── emsdk discovery ──────────────────────────────────────────────────
# EMSDK_ENV first; an emcc already on PATH is never overridden.
source_emsdk_env "$PROJECT_ROOT"

if ! command -v emcc >/dev/null 2>&1; then
    echo "❌ emcc not found. Activate emsdk ${EMSDK_PIN}:" >&2
    echo "   git clone https://github.com/emscripten-core/emsdk.git && cd emsdk" >&2
    echo "   ./emsdk install ${EMSDK_PIN} && ./emsdk activate ${EMSDK_PIN} && source ./emsdk_env.sh" >&2
    exit 1
fi

EMCC_VERSION_LINE="$(emcc --version 2>/dev/null | head -1)"
EMCC_VERSION="$(echo "$EMCC_VERSION_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
echo "📦 Emscripten: $EMCC_VERSION_LINE"
# The committed pair must equal a fresh pinned build byte for byte (CI js-libopenmpt-rebuild).
require_emsdk_pin build-js-libopenmpt.sh

# ── Options ──────────────────────────────────────────────────────────
DEBUG_MODE=0
SIMD=0
EH_MODE="${EH_MODE:-wasm}"
for arg in "$@"; do
    case "$arg" in
        --debug) DEBUG_MODE=1 ;;
        --simd) SIMD=1 ;;
        --eh=wasm) EH_MODE=wasm ;;
        --eh=js) EH_MODE=js ;;
        -h|--help) sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

OUT_DIR="${OUT_DIR:-$PROJECT_ROOT/public/worklets}"
OUT_BASENAME="${OUT_BASENAME:-libopenmpt-worklet}"
WRITE_MANIFEST=1
if [[ "$OUT_DIR" != "$PROJECT_ROOT/public/worklets" || "$OUT_BASENAME" != "libopenmpt-worklet" ]]; then
    WRITE_MANIFEST=0
fi

# Hygiene: openmpt-worklet.* is the tracked JS processor.
case "$OUT_BASENAME" in
    openmpt-worklet*|openmpt-native*)
        echo "❌ Refusing OUT_BASENAME=$OUT_BASENAME — reserved for the JS processor / native engine." >&2
        exit 1 ;;
esac

# ── Flags ────────────────────────────────────────────────────────────
# COMPILE_FLAGS apply to libopenmpt AND the link (ThinLTO codegen happens at link).
# WASM_FEATURE_FLAGS (bulk memory, saturating float→int, sign-ext) come from wasm-flags.sh.
COMPILE_FLAGS=()
if [[ "$DEBUG_MODE" -eq 1 ]]; then
    COMPILE_FLAGS+=(-O0 -g -DDEBUG)
    LINK_MODE_FLAGS=(-sASSERTIONS=2 -sSAFE_HEAP=0)
else
    COMPILE_FLAGS+=(-O3 -DNDEBUG -flto=thin -ffunction-sections -fdata-sections)
    # shellcheck disable=SC2054  # -Wl,... is ONE linker pass-through argument, not a comma-separated list
    LINK_MODE_FLAGS=(-sASSERTIONS=0 -Wl,--gc-sections)
fi
COMPILE_FLAGS+=("${WASM_FEATURE_FLAGS[@]}")
if [[ "$SIMD" -eq 1 ]]; then
    COMPILE_FLAGS+=(-msimd128)
fi
case "$EH_MODE" in
    wasm)
        COMPILE_FLAGS+=("${WASM_EH_FLAGS[@]}")
        EH_LINK_FLAGS=("${WASM_EH_FLAGS[@]}")
        ;;
    js)
        COMPILE_FLAGS+=(-fexceptions)
        EH_LINK_FLAGS=(-fexceptions -sDISABLE_EXCEPTION_CATCHING=0)
        ;;
    *) echo "Bad --eh mode: $EH_MODE" >&2; exit 1 ;;
esac

VARIANT="eh-${EH_MODE}$([[ "$SIMD" -eq 1 ]] && echo -simd || true)$([[ "$DEBUG_MODE" -eq 1 ]] && echo -debug || true)"

# ── libopenmpt source tree (separate from the native build's tree) ───
# Version + sha256 live in scripts/lib/libopenmpt-source.sh.
VENDOR_ROOT="$PROJECT_ROOT/vendor"
# Keyed by variant AND emcc version so switching toolchains never thrashes / mixes objects;
# version-free (the version is in the stamp and in the tree's .libopenmpt-version).
JS_TREE="$VENDOR_ROOT/libopenmpt-jsengine-${VARIANT}-emsdk${EMCC_VERSION}"

# emscripten make config drives the compiler wrappers; flags are passed on the make
# command line so they REPLACE (not extend) the config's CXXFLAGS — same approach as
# scripts/build-wasm.sh, and the only way to control EH/SIMD/LTO exactly. What that
# replacement drops (-std, -fvisibility=hidden, C's -fno-strict-aliasing) is re-added from
# wasm-flags.sh.
LIBOPENMPT_MAKE_FLAGS=(CONFIG=emscripten STATIC_LIB=1 SHARED_LIB=0 DYNLINK=0 EXAMPLES=0 OPENMPT123=0)
CXXFLAGS_LIB=("${COMPILE_FLAGS[@]}" "${LIBOPENMPT_CXX_EXTRA_FLAGS[@]}")
CFLAGS_C=("${COMPILE_FLAGS[@]}" "${LIBOPENMPT_C_EXTRA_FLAGS[@]}")

FLAG_STAMP="$(printf '%s\n' "$EMCC_VERSION_LINE" "libopenmpt=$LIBOPENMPT_VERSION" "${CXXFLAGS_LIB[@]}" "${CFLAGS_C[@]}" \
    | sha256sum | cut -c1-16)"

prepare_tree() {
    if [[ -f "$JS_TREE/Makefile" && "$(cat "$JS_TREE/.libopenmpt-version" 2>/dev/null)" == "$LIBOPENMPT_VERSION" ]]; then
        return 0
    fi
    rm -rf "$JS_TREE"
    local pristine
    pristine="$(libopenmpt_ensure_pristine "$VENDOR_ROOT")"
    echo "📂 Copying libopenmpt ${LIBOPENMPT_VERSION} sources from $pristine (excluding objects / bin)…"
    libopenmpt_copy_sources "$pristine" "$JS_TREE"
    echo "$LIBOPENMPT_VERSION" > "$JS_TREE/.libopenmpt-version"
}

build_static_lib() {
    local stamp_file="$JS_TREE/bin/.js-engine-flags"
    if [[ -f "$JS_TREE/bin/libopenmpt.a" && -f "$stamp_file" && "$(cat "$stamp_file")" == "$FLAG_STAMP" ]]; then
        echo "✅ libopenmpt.a (${VARIANT}) up to date — skipping make"
        return 0
    fi
    echo "🔨 Building libopenmpt static lib [${VARIANT}] (a few minutes)…"
    echo "   CXXFLAGS: ${CXXFLAGS_LIB[*]}"
    pushd "$JS_TREE" >/dev/null
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" clean >/dev/null 2>&1 || true
    mkdir -p bin
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" \
        CXXFLAGS="${CXXFLAGS_LIB[*]}" CFLAGS="${CFLAGS_C[*]}" \
        -j"$(nproc 2>/dev/null || echo 2)" bin/libopenmpt.a
    popd >/dev/null
    echo "$FLAG_STAMP" > "$stamp_file"
}

prepare_tree
build_static_lib

LIB_DIR="$JS_TREE/bin"
INCLUDE_ROOT="$JS_TREE"
[[ -f "$LIB_DIR/libopenmpt.a" ]] || { echo "❌ $LIB_DIR/libopenmpt.a missing after build" >&2; exit 1; }

# ── Exports ──────────────────────────────────────────────────────────
# Whole libopenmpt C API (libopenmpt.h + libopenmpt_ext.h), generated from the vendored
# headers so the export set is exact for the pinned version and a superset of what the
# old wasm2js glue exposed (main thread, parser worker and the worklet all use it).
EXPORT_LIST="$(cat "$INCLUDE_ROOT/libopenmpt/libopenmpt.h" "$INCLUDE_ROOT/libopenmpt/libopenmpt_ext.h" \
    | tr '\n' ' ' | grep -oE 'LIBOPENMPT_API[^;{]*;' | grep -oE '\bopenmpt_[a-z0-9_]+ *\(' \
    | tr -d ' (' | sort -u | sed "s/^/'_/; s/\$/'/" | paste -sd, -)"
EXPORT_COUNT="$(echo "$EXPORT_LIST" | tr ',' '\n' | wc -l)"
if [[ "$EXPORT_COUNT" -lt 100 ]]; then
    echo "❌ Only $EXPORT_COUNT C API exports found — header parse failed" >&2; exit 1
fi
EXPORTED_FUNCTIONS="[${EXPORT_LIST},'_malloc','_free']"

# Runtime helpers on the Module object. DO NOT add stringToUTF8: the app polyfills its own
# (str) → ptr `stringToUTF8` when absent (hooks/libOpenMPT/runInit.ts), and Emscripten's real
# one has a different (str, outPtr, maxBytes) signature — exporting it would silently break
# every metadata call. verify-js-libopenmpt.mjs enforces this.
# emsdk 3.x exports the HEAP* views on Module unconditionally (and warns that listing them is
# "invalid"); emsdk 4+ only exports them when listed. verify-js-libopenmpt.mjs --smoke asserts
# Module.HEAPU8/HEAPF32 exist either way.
if [[ "${EMCC_VERSION%%.*}" -ge 4 ]]; then
    EXPORTED_RUNTIME_METHODS="['HEAPU8','HEAPF32','UTF8ToString','getValue','setValue','dynCall']"
else
    EXPORTED_RUNTIME_METHODS="['UTF8ToString','getValue','setValue','dynCall']"
fi

# Module properties the consumers SET before/after evaluating the glue. emsdk 3.x accepted all
# incoming properties by default; newer emsdk accepts none unless listed (wasmBinary is NOT in
# its default list — the worklet has no fetch(), so a silently ignored wasmBinary means a dead
# engine). Spelled out so every emsdk version behaves the same; --smoke covers it.
INCOMING_MODULE_JS_API="['locateFile','noInitialRun','onRuntimeInitialized','wasmBinary','instantiateWasm','onAbort','print','printErr','preRun','postRun']"

# ── Link ─────────────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
GLUE="$OUT_DIR/${OUT_BASENAME}.js"
WASM="$OUT_DIR/${OUT_BASENAME}.wasm"
rm -f "$GLUE" "$WASM"

# INITIAL_MEMORY: the old wasm2js glue reserved ~512 MB up front; the JS engine hosts exactly one
# module (no g_metaModule, no ring buffer), so start small and let it grow (views are refreshed
# by the glue; the processor already re-derives its HEAPF32 views when the buffer moves).
echo "🔗 Linking ${OUT_BASENAME}.{js,wasm} [${VARIANT}]…"
em++ \
    -std=c++17 \
    "${COMPILE_FLAGS[@]}" \
    "${EH_LINK_FLAGS[@]}" \
    -L"$LIB_DIR" -lopenmpt \
    --no-entry \
    -sENVIRONMENT=web \
    -sMODULARIZE=0 \
    -sEXPORT_ES6=0 \
    -sEXPORT_NAME=libopenmpt \
    -sWASM=1 \
    -sSINGLE_FILE=0 \
    -sFILESYSTEM=0 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=33554432 \
    -sMAXIMUM_MEMORY=1073741824 \
    -sSTACK_SIZE=1048576 \
    -sERROR_ON_UNDEFINED_SYMBOLS=1 \
    -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -sEXPORTED_RUNTIME_METHODS="$EXPORTED_RUNTIME_METHODS" \
    -sINCOMING_MODULE_JS_API="$INCOMING_MODULE_JS_API" \
    "${LINK_MODE_FLAGS[@]}" \
    -o "$GLUE"

[[ -f "$GLUE" && -f "$WASM" ]] || { echo "❌ link did not produce ${OUT_BASENAME}.{js,wasm}" >&2; exit 1; }

if [[ "$DEBUG_MODE" -eq 0 && "$SIMD" -eq 0 && "$EH_MODE" == "wasm" ]]; then
    # Instruction-level gate: exceptions, saturating float→int, bulk memory present; no SIMD/atomics.
    node "$SCRIPT_DIR/verify-wasm-features.mjs" --profile js "$WASM"
fi

echo ""
echo "✅ Built ${OUT_BASENAME}.{js,wasm}"
ls -l "$GLUE" "$WASM"

if [[ "$WRITE_MANIFEST" -eq 1 ]]; then
    node "$SCRIPT_DIR/verify-js-libopenmpt.mjs" --write \
        --emcc "$EMCC_VERSION" --eh "$EH_MODE" --simd "$SIMD" --libopenmpt "$LIBOPENMPT_VERSION" \
        --variant "$VARIANT"
else
    echo "ℹ️  Custom OUT_DIR/OUT_BASENAME — manifest not written (A/B build)."
fi
