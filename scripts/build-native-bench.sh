#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/build-native-bench.sh – NativeEngine for Node, for scripts/bench-engines.mjs (#491)
#
# Same compile flags (scripts/lib/wasm-flags.sh + the release COMPILE_FLAGS of
# scripts/build-wasm.sh) and the same release libopenmpt.a as the shipped native
# engine; only the entry points (cpp/bench/bench_engine.cpp instead of the
# AudioWorklet glue) and the environment (Node) differ. Run `npm run build:emcc` first:
# it builds and stamps vendor/libopenmpt-native-release.
#
# Output (gitignored): vendor/native-bench/native-bench.{cjs,wasm}
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/wasm-flags.sh
source "$SCRIPT_DIR/lib/wasm-flags.sh"
source_emsdk_env "$PROJECT_ROOT"
command -v emcc >/dev/null 2>&1 || { echo "❌ emcc not found (EMSDK_ENV=/path/to/emsdk_env.sh)" >&2; exit 1; }
require_emsdk_pin build-native-bench.sh

TREE="$PROJECT_ROOT/vendor/libopenmpt-native-release"
if [[ ! -f "$TREE/bin/libopenmpt.a" ]]; then
    echo "❌ $TREE/bin/libopenmpt.a missing — run npm run build:emcc first" >&2
    exit 1
fi
OUT="$PROJECT_ROOT/vendor/native-bench"
mkdir -p "$OUT/obj"

# Keep in step with the release COMPILE_FLAGS / CXX_ONLY_FLAGS in scripts/build-wasm.sh.
COMPILE_FLAGS=(-O3 -DNDEBUG -flto=thin -msimd128 "${WASM_FEATURE_FLAGS[@]}" -matomics -ffunction-sections -fdata-sections)
CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)

for src in openmpt_wrapper native_engine wasm_workers_tls bench/bench_engine; do
    em++ "${COMPILE_FLAGS[@]}" "${CXX_ONLY_FLAGS[@]}" -std=c++17 -I"$TREE" -I"$PROJECT_ROOT/cpp" \
        -c "$PROJECT_ROOT/cpp/$src.cpp" -o "$OUT/obj/$(basename "$src").o"
done

# shellcheck disable=SC2054  # -Wl,... is ONE linker pass-through argument
em++ "${COMPILE_FLAGS[@]}" "${WASM_EH_FLAGS[@]}" -Wl,--gc-sections \
    "$OUT"/obj/*.o -L"$TREE/bin" -lopenmpt \
    -sWASM_WORKERS=1 -sENVIRONMENT=node,worker -sMODULARIZE=1 -sEXPORT_NAME=createNativeBench \
    -sMALLOC=emmalloc -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=128mb -sSTACK_SIZE=131072 -sFILESYSTEM=0 \
    -sEXPORTED_FUNCTIONS="['_bench_load','_bench_render','_bench_times','_bench_error','_bench_peak','_bench_render_param','_malloc','_free']" \
    -sEXPORTED_RUNTIME_METHODS="['UTF8ToString']" \
    -o "$OUT/native-bench.cjs"
echo "✅ $OUT/native-bench.{cjs,wasm} ($(stat -c %s "$OUT/native-bench.wasm") B)"
