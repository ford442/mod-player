#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/build-js-libopenmpt.sh – real-WASM libopenmpt for the DEFAULT JS engine
#
# Output (tracked in git, like public/libmpt/ used to be):
#   public/worklets/libopenmpt-worklet.js    classic-script Emscripten glue (~50 KB, Closure-compiled)
#   public/worklets/libopenmpt-worklet.wasm  real \0asm binary
#   audio-worklet/js/libopenmpt-worklet.generated.json   manifest (sizes, SRI, cache key)
# plus, untracked, the release wasm's function-index → name map:
#   vendor/symbol-maps/<basename>.<cache key>.symbols   (the cache key is the `?v=` the app loads)
#
# That pair serves the main thread and the parser worker (and the AudioWorklet when the page is
# not crossOriginIsolated):
#   * main thread    – <script src> (index.html, via vite-plugins/libopenmptHtml.ts)
#   * parser worker  – new Function(glue) + locateFile → the same .wasm
#   * AudioWorklet   – main thread fetches both files, posts {scriptText, wasmBytes}
# so nothing replaces globalThis.WebAssembly any more (the wasm2js war is over).
# It has no WASM_WORKERS, no shared memory, no C++ wrapper: stock openmpt_* C exports only.
#
# --playback links the AudioWorklet's own heap (#513):
#   public/worklets/libopenmpt-playback.{js,wasm}
#   audio-worklet/js/libopenmpt-playback.generated.json
# Same sources, exceptions, exports and memory limits, plus -sWASM_WORKERS (shared memory, a
# thread-safe malloc and C++ runtime). The worklet instantiates it as the heap's main thread
# (render); a plain Worker joins the same WebAssembly.Memory as a wasm worker and runs
# openmpt_module_create_from_memory2 there, so a large module never parses on the audio thread
# (workers/openmpt-create.worker.ts). Never inject it into index.html or the parser
# worker. Its link whole-archives libwasm_workers, or emsdk 3.1.51 never initialises the heap main
# thread's TLS, which breaks every typed C++ catch on the AudioWorklet (#515, see the link below).
# Each variant × emcc version gets its own libopenmpt.a tree under vendor/, so switching flags or
# toolchains never mixes objects.
#
# libopenmpt's version and tarball sha256: scripts/lib/libopenmpt-source.sh (a mismatching download
# is refused). The wasm feature / exception flags and the emsdk pin: scripts/lib/wasm-flags.sh.
#
# ⚠️  NEVER name an output openmpt-worklet.* — that basename is the tracked JS
#     processor (generated from audio-worklet/js/openmpt-processor.ts).
#
# Prerequisites: emsdk 3.1.51 (the pin in scripts/lib/wasm-flags.sh — same as CI). Another active
# emcc is an error; XASM_ALLOW_EMSDK_DRIFT=1 builds with it anyway (output will not match CI).
#   source /path/to/emsdk/emsdk_env.sh   OR   EMSDK_ENV=/path/to/emsdk_env.sh
#
# Usage:
#   scripts/build-js-libopenmpt.sh                 # release: -Os, Closure glue, wasm-EH, no SIMD
#   scripts/build-js-libopenmpt.sh --simd          # + -msimd128 (measured, not shipped: public/worklets/README.md)
#   scripts/build-js-libopenmpt.sh --playback      # the AudioWorklet's shared-memory heap (see above)
#   scripts/build-js-libopenmpt.sh --eh=js         # JS-based exceptions (-fexceptions)
#   scripts/build-js-libopenmpt.sh --debug         # -O0 -g -sASSERTIONS=2; boots in the AudioWorklet too
#   OUT_DIR=/tmp/x OUT_BASENAME=variant scripts/build-js-libopenmpt.sh   # A/B builds
#                                                  # (skips the manifest write)
#   OPT_LEVEL=-O3 / --no-closure                   # size A/B only: another -O level, no Closure on the glue
#
# Check a debug build boots where the app runs it:
#   OUT_DIR=/tmp/dbg scripts/build-js-libopenmpt.sh --debug
#   node scripts/verify-js-libopenmpt.mjs --boot /tmp/dbg/libopenmpt-worklet.js
#
# Exception handling: libopenmpt's C API reports bad files by catching C++
# exceptions internally and returning NULL. With catching disabled a throw aborts
# the module, so a corrupt upload would kill the whole worklet. Default is
# native wasm exceptions (-fwasm-exceptions: zero cost on the non-throw path, no
# JS invoke_* trampolines; the legacy encoding, which Chrome 95 / Safari 15.2 run —
# exnref would raise the floor to Chrome 137 / Safari 18.4); --eh=js is the
# portable-but-slower fallback.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/wasm-flags.sh
source "$SCRIPT_DIR/lib/wasm-flags.sh"
# shellcheck source=lib/libopenmpt-source.sh
source "$SCRIPT_DIR/lib/libopenmpt-source.sh"

# ── emsdk discovery ──────────────────────────────────────────────────
source_emsdk_env "$PROJECT_ROOT"

if ! command -v emcc >/dev/null 2>&1; then
    echo "❌ emcc not found. Activate emsdk ${WASM_EMSDK_PIN}:" >&2
    echo "   git clone https://github.com/emscripten-core/emsdk.git && cd emsdk" >&2
    echo "   ./emsdk install ${WASM_EMSDK_PIN} && ./emsdk activate ${WASM_EMSDK_PIN} && source ./emsdk_env.sh" >&2
    exit 1
fi

EMCC_VERSION_LINE="$(emcc --version 2>/dev/null | head -1)"
EMCC_VERSION="$(echo "$EMCC_VERSION_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
echo "📦 Emscripten: $EMCC_VERSION_LINE"
require_emsdk_pin "build-js-libopenmpt.sh"

# ── Options ──────────────────────────────────────────────────────────
DEBUG_MODE=0
SIMD=0
PLAYBACK=0
CLOSURE="$WASM_RELEASE_CLOSURE"
EH_MODE="${EH_MODE:-wasm}"
OPT_LEVEL="${OPT_LEVEL:-$WASM_OPT_LEVEL}"
for arg in "$@"; do
    case "$arg" in
        --debug) DEBUG_MODE=1 ;;
        --simd) SIMD=1 ;;
        --playback) PLAYBACK=1 ;;
        --no-closure) CLOSURE=0 ;;
        --eh=wasm) EH_MODE=wasm ;;
        --eh=js) EH_MODE=js ;;
        -h|--help) sed -n '2,64p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done
case "$OPT_LEVEL" in
    -O1|-O2|-O3|-Os|-Oz) ;;
    *) echo "Bad OPT_LEVEL: $OPT_LEVEL (-O1 | -O2 | -O3 | -Os | -Oz)" >&2; exit 1 ;;
esac

DEFAULT_BASENAME="$([[ "$PLAYBACK" -eq 1 ]] && echo libopenmpt-playback || echo libopenmpt-worklet)"
OUT_DIR="${OUT_DIR:-$PROJECT_ROOT/public/worklets}"
OUT_BASENAME="${OUT_BASENAME:-$DEFAULT_BASENAME}"
WRITE_MANIFEST=1
if [[ "$OUT_DIR" != "$PROJECT_ROOT/public/worklets" || "$OUT_BASENAME" != "$DEFAULT_BASENAME" ]]; then
    WRITE_MANIFEST=0
fi
# The committed pairs are release builds at the audited flags; experiments go to an A/B OUT_DIR.
if [[ "$WRITE_MANIFEST" -eq 1 && ( "$DEBUG_MODE" -eq 1 || "$SIMD" -eq 1 || "$CLOSURE" != "$WASM_RELEASE_CLOSURE" || "$OPT_LEVEL" != "$WASM_OPT_LEVEL" || "$EH_MODE" != "wasm" ) ]]; then
    echo "❌ --debug / --simd / --no-closure / OPT_LEVEL / --eh=js are experiments: set OUT_DIR (A/B build) so the" >&2
    echo "   committed pair in public/worklets/ is not replaced." >&2
    exit 1
fi

# Hygiene: openmpt-worklet.* is the tracked JS processor.
case "$OUT_BASENAME" in
    openmpt-worklet*)
        echo "❌ Refusing OUT_BASENAME=$OUT_BASENAME — reserved for the JS processor." >&2
        exit 1 ;;
esac

# ── Flags ────────────────────────────────────────────────────────────
# BASE_FLAGS apply to libopenmpt's C++ and C AND to the link (ThinLTO codegen happens at link).
# Not here on purpose: -ffunction-sections/-fdata-sections/-Wl,--gc-sections (wasm-ld already
# collects per function and segment: the output was byte-identical without them), -msign-ext (on
# by default since LLVM 16) and -sSAFE_HEAP=0 (the default).
BASE_FLAGS=("${WASM_FEATURE_FLAGS[@]}")
if [[ "$DEBUG_MODE" -eq 1 ]]; then
    BASE_FLAGS+=(-O0 -g -DDEBUG)
    LINK_MODE_FLAGS=(-sASSERTIONS=2)
else
    BASE_FLAGS+=("$OPT_LEVEL" -DNDEBUG -flto=thin)
    # The function-index → name map for production wasm stack traces (moved to vendor/symbol-maps/
    # below; CI uploads it). Emscripten keeps names through wasm-opt's passes for it, which shifts the
    # wasm by a few bytes (+64 B measured): the map always matches the binary that ships.
    LINK_MODE_FLAGS=(-sASSERTIONS=0 --emit-symbol-map)
fi
if [[ "$CLOSURE" -eq 1 && "$DEBUG_MODE" -eq 0 ]]; then
    LINK_MODE_FLAGS+=(--closure 1)
fi
if [[ "$SIMD" -eq 1 ]]; then
    BASE_FLAGS+=(-msimd128)
fi
# Shared memory needs every object built with atomics + bulk-memory; -sWASM_WORKERS at compile time
# sets both, and at link time selects the -ww system libs (locked malloc, threaded libc++abi/libunwind).
if [[ "$PLAYBACK" -eq 1 ]]; then
    BASE_FLAGS+=(-sWASM_WORKERS)
fi
case "$EH_MODE" in
    wasm)
        BASE_FLAGS+=("${WASM_EH_FLAGS[@]}")
        EH_LINK_FLAGS=("${WASM_EH_FLAGS[@]}")
        ;;
    js)
        BASE_FLAGS+=(-fexceptions)
        EH_LINK_FLAGS=(-fexceptions -sDISABLE_EXCEPTION_CATCHING=0)
        ;;
    *) echo "Bad --eh mode: $EH_MODE" >&2; exit 1 ;;
esac
COMPILE_FLAGS=("${LIBOPENMPT_CXX_EXTRA_FLAGS[@]}" "${BASE_FLAGS[@]}")
CFLAGS_C=("${LIBOPENMPT_C_EXTRA_FLAGS[@]}" "${BASE_FLAGS[@]}")

OPT_SUFFIX=""
if [[ "$DEBUG_MODE" -eq 0 && "$OPT_LEVEL" != "$WASM_OPT_LEVEL" ]]; then
    OPT_SUFFIX="-$(echo "${OPT_LEVEL#-}" | tr '[:upper:]' '[:lower:]')"
fi
VARIANT="eh-${EH_MODE}$([[ "$SIMD" -eq 1 ]] && echo -simd || true)$([[ "$PLAYBACK" -eq 1 ]] && echo -playback || true)$([[ "$DEBUG_MODE" -eq 1 ]] && echo -debug || true)${OPT_SUFFIX}"

# ── libopenmpt source tree ───────────────────────────────────────────
# LIBOPENMPT_VERSION / LIBOPENMPT_NAME and the verified download: scripts/lib/libopenmpt-source.sh.
VENDOR_ROOT="$PROJECT_ROOT/vendor"
# Keyed by variant AND emcc version so switching toolchains never thrashes / mixes objects.
JS_TREE="$VENDOR_ROOT/${LIBOPENMPT_NAME}-jsengine-${VARIANT}-emsdk${EMCC_VERSION}"

# emscripten make config drives the compiler wrappers; flags are passed on the make
# command line so they REPLACE (not extend) the config's CXXFLAGS — the only way to
# control EH/SIMD/LTO exactly.
LIBOPENMPT_MAKE_FLAGS=(CONFIG=emscripten STATIC_LIB=1 SHARED_LIB=0 DYNLINK=0 EXAMPLES=0 OPENMPT123=0)

FLAG_STAMP="$(printf '%s\n' "$EMCC_VERSION_LINE" "${COMPILE_FLAGS[@]}" "${CFLAGS_C[@]}" | sha256sum | cut -c1-16)"

prepare_tree() {
    if [[ -f "$JS_TREE/Makefile" ]]; then return 0; fi
    local pristine
    pristine="$(libopenmpt_ensure_pristine "$VENDOR_ROOT")"
    libopenmpt_copy_sources "$pristine" "$JS_TREE"
}

build_static_lib() {
    local stamp_file="$JS_TREE/bin/.js-engine-flags"
    if [[ -f "$JS_TREE/bin/libopenmpt.a" && -f "$stamp_file" && "$(cat "$stamp_file")" == "$FLAG_STAMP" ]]; then
        echo "✅ libopenmpt.a (${VARIANT}) up to date — skipping make"
        return 0
    fi
    echo "🔨 Building libopenmpt static lib [${VARIANT}] (a few minutes)…"
    echo "   CXXFLAGS: ${COMPILE_FLAGS[*]}"
    pushd "$JS_TREE" >/dev/null
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" clean >/dev/null 2>&1 || true
    mkdir -p bin
    make "${LIBOPENMPT_MAKE_FLAGS[@]}" \
        CXXFLAGS="${COMPILE_FLAGS[*]}" CFLAGS="${CFLAGS_C[*]}" \
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
# wasmMemory is exported by both pairs: the processor reads `lib.wasmMemory` to tell the playback heap
# from the shared pair, and a --debug glue (ASSERTIONS) aborts on any read of an unexported runtime
# member, so the shared debug pair would otherwise die inside initLib.
if [[ "${EMCC_VERSION%%.*}" -ge 4 ]]; then
    EXPORTED_RUNTIME_METHODS="['HEAPU8','HEAPF32','UTF8ToString','getValue','setValue','dynCall','wasmMemory']"
else
    EXPORTED_RUNTIME_METHODS="['UTF8ToString','getValue','setValue','dynCall','wasmMemory']"
fi

# Module properties the consumers SET before/after evaluating the glue. emsdk 3.x accepted all
# incoming properties by default; newer emsdk accepts none unless listed (wasmBinary is NOT in
# its default list — the worklet has no fetch(), so a silently ignored wasmBinary means a dead
# engine). Spelled out so every emsdk version behaves the same; --smoke covers it.
INCOMING_MODULE_JS_API="['locateFile','noInitialRun','onRuntimeInitialized','wasmBinary','instantiateWasm','onAbort','print','printErr','preRun','postRun']"

# Where the glue runs: the main thread (web), the parser worker and the create worker (worker), and
# the AudioWorklet, which has neither `window` nor `importScripts`. A release glue never checks:
# the shared pair hard-codes `web`, and the playback pair's `web,worker` detection simply finds
# neither in the worklet. A --debug (ASSERTIONS) glue checks at load time and threw "not compiled
# for this environment" in the worklet, so debug builds add `worker` and `shell` (the worklet
# scope is detected as `shell`; wasmBinary is always passed in, so shell file reads never run).
ENVIRONMENT="web"
# The playback heap: the create worker hands the glue the worklet's shared WebAssembly.Memory
# (incoming wasmMemory), and the worklet reads it back (exported wasmMemory) to give it out.
# ENVIRONMENT gains `worker` because the same glue boots inside that Worker. Emscripten also writes
# a <name>.ww.js bootstrap for workers it spawns itself; nothing spawns them (the main thread
# starts the create worker), so it is deleted after the link.
#
# Main-thread TLS (#515): with -sWASM_WORKERS the heap main thread's TLS block is set up by
# emscripten_wasm_worker_main_thread_initialize, a constructor(48) in libwasm_workers.a. emsdk 3.1.51
# links that archive normally, so the member holding the constructor is only pulled in when
# something references it, and nothing here does (the JS main thread starts the create worker). The
# constructor then never runs: TLS accesses that go through the linker's TLS globals keep their raw
# offsets (addresses near 0, the far end of the stack). Wasm EH keeps its catch selector in one of
# those (libunwind's thread_local __wasm_lpad_context), so every typed catch on the worklet fell
# through to catch (...) and libopenmpt rejected recoverable files ("unknown internal error").
# Later emsdk whole-archives libwasm_workers for exactly this reason; EMCC_FORCE_STDLIBS does the
# same here. (-Wl,--undefined=… pulls the member but does not get the constructor called in a -O0
# link.) The create worker is a wasm worker, initialised by emscripten_wasm_worker_initialize.
THREAD_LINK_FLAGS=()
LINK_ENV=()
if [[ "$PLAYBACK" -eq 1 ]]; then
    INCOMING_MODULE_JS_API="${INCOMING_MODULE_JS_API%]},'wasmMemory']"
    ENVIRONMENT="web,worker"
    THREAD_LINK_FLAGS=(-sWASM_WORKERS)
    LINK_ENV=(EMCC_FORCE_STDLIBS=libwasm_workers)
fi
if [[ "$DEBUG_MODE" -eq 1 ]]; then
    ENVIRONMENT="web,worker,shell"
fi

# ── Link ─────────────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
GLUE="$OUT_DIR/${OUT_BASENAME}.js"
WASM="$OUT_DIR/${OUT_BASENAME}.wasm"
rm -f "$GLUE" "$WASM"

# INITIAL_MEMORY: the old wasm2js glue reserved ~512 MB up front; the JS engine hosts exactly one
# module (no g_metaModule, no ring buffer), so start small and let it grow (views are refreshed
# by the glue; the processor already re-derives its HEAPF32 views when the buffer moves).
echo "🔗 Linking ${OUT_BASENAME}.{js,wasm} [${VARIANT}]…"
env "${LINK_ENV[@]}" em++ \
    "${COMPILE_FLAGS[@]}" \
    "${EH_LINK_FLAGS[@]}" \
    -L"$LIB_DIR" -lopenmpt \
    --no-entry \
    -sENVIRONMENT="$ENVIRONMENT" \
    "${THREAD_LINK_FLAGS[@]}" \
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
rm -f "$OUT_DIR/${OUT_BASENAME}.ww.js"

# Never leave the symbol map next to the pair: public/worklets/ is deployed as is. It is keyed by
# the pair's cache key (sha256 of glue + wasm, = the manifest's `version` and the app's `?v=`), so
# a production stack trace's wasm URL names the map that decodes it.
if [[ -f "${GLUE}.symbols" ]]; then
    SYMBOL_DIR="${SYMBOL_DIR:-$VENDOR_ROOT/symbol-maps}"
    mkdir -p "$SYMBOL_DIR"
    PAIR_KEY="$(cat "$GLUE" "$WASM" | sha256sum | cut -c1-10)"
    mv "${GLUE}.symbols" "$SYMBOL_DIR/${OUT_BASENAME}.${PAIR_KEY}.symbols"
    echo "🗺️  Symbol map: $SYMBOL_DIR/${OUT_BASENAME}.${PAIR_KEY}.symbols"
fi

echo ""
echo "✅ Built ${OUT_BASENAME}.{js,wasm}"
ls -l "$GLUE" "$WASM"

if [[ "$WRITE_MANIFEST" -eq 1 ]]; then
    node "$SCRIPT_DIR/verify-js-libopenmpt.mjs" --write \
        --emcc "$EMCC_VERSION" --eh "$EH_MODE" --simd "$SIMD" --libopenmpt "$LIBOPENMPT_VERSION" \
        --variant "$VARIANT" --artifact "$([[ "$PLAYBACK" -eq 1 ]] && echo playback || echo shared)"
else
    echo "ℹ️  Custom OUT_DIR/OUT_BASENAME — manifest not written (A/B build)."
fi
