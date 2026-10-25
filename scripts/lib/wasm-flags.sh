# shellcheck shell=bash
# ──────────────────────────────────────────────────────────────────────
# scripts/lib/wasm-flags.sh – the ONE audited flag set for the JS engine's libopenmpt (#491, #515)
#
# Sourced by scripts/build-js-libopenmpt.sh. Anything that decides which wasm features or
# exception model libopenmpt is compiled with lives here, so the shared pair and the playback
# heap (#513) cannot drift apart. scripts/verify-wasm-features.mjs checks the result
# instruction by instruction.
# ──────────────────────────────────────────────────────────────────────

# The emsdk the committed pairs (and CI's drift check) are built with. A different active emcc is
# a hard error unless XASM_ALLOW_EMSDK_DRIFT=1 (see require_emsdk_pin below).
# shellcheck disable=SC2034  # consumed by the sourcing script
WASM_EMSDK_PIN="3.1.51"

# Post-MVP features every browser with AudioWorklet has (bulk memory is the newest: Chrome 75,
# Firefox 79, Safari 15). LLVM 17 (emsdk 3.1.51) only enables sign-ext (and mutable-globals) by
# default, so without these libopenmpt's float→int conversions compile to trapping i32.trunc_*
# and its memcpy/memset to byte loops. Newer emsdk turns both on by default.
# shellcheck disable=SC2034
WASM_FEATURE_FLAGS=(-mbulk-memory -mnontrapping-fptoint)

# Optimisation level of libopenmpt and the link, and Closure on the release glue (#515 size A/B,
# docs/WORKLET_AUDIO_BUG.md § "One toolchain"). -Os against -O3 at the same flags: shared wasm
# 1,734,573 → 1,376,401 B (−20.6 %, ~−97 KB gzipped) with render p50 per quantum within 2 % on a
# 4-channel MOD, a 64-channel IT and a 32-channel XM at cubic and sinc-8, and bit-identical PCM; -O2
# bought nothing. libopenmpt's own emscripten makefile defaults to -Oz. Closure leaves the wasm
# untouched and halves the glue (103,736 → 49,922 B); every Module member the app reads or sets is
# quoted or in an extern. WASM_OPT_LEVEL="-O3" reverts the size change.
# shellcheck disable=SC2034
WASM_OPT_LEVEL="-Os"
# shellcheck disable=SC2034
WASM_RELEASE_CLOSURE=1

# Native wasm exceptions, at compile time AND link time. libopenmpt's C API turns every internal
# error into NULL / an error code by catching C++ exceptions, and its loaders throw and catch
# internally on ordinary malformed input (IT sample decompression's BitReader::eof on a truncated
# block, XPK/MMCMP unpacking, …). Linked without catching, each of those throws is an abort() —
# and the AudioWorklet runtime is shared by every node on the page.
# -fwasm-exceptions costs nothing on the non-throwing path (no JS invoke_* trampolines).
# shellcheck disable=SC2034
WASM_EH_FLAGS=(-fwasm-exceptions)

# What libopenmpt's own makefiles add and a command-line CXXFLAGS=/CFLAGS= drops: the build passes
# its flags on the make command line on purpose (in the environment the Makefile would append
# config-emscripten.mk's -Oz and full -flto after ours, and the last -O/-flto wins), which REPLACES
# every `CXXFLAGS +=` in build/make/config-emscripten.mk and the Makefile. These are the ones that
# matter, re-added explicitly:
#   -std=…               the Makefile's probe (c++23/c++20/c++17, c23…c11); pinned instead
#   -fvisibility=hidden  libopenmpt's own default; only LIBOPENMPT_API symbols stay public
#   -fno-strict-aliasing the bundled C (miniz, minimp3, stb_vorbis) needs it
# shellcheck disable=SC2034
LIBOPENMPT_CXX_EXTRA_FLAGS=(-std=c++17 -fvisibility=hidden)
# shellcheck disable=SC2034
LIBOPENMPT_C_EXTRA_FLAGS=(-std=c17 -fvisibility=hidden -fno-strict-aliasing)

# require_emsdk_pin <script-name>
# Fails unless the active emcc reports WASM_EMSDK_PIN. Builds made with another emsdk are not
# reproducible against CI (the committed pairs must equal a fresh pinned build byte for byte)
# and have shipped with different default features before.
# XASM_ALLOW_EMSDK_DRIFT=1 downgrades the error to a warning for local experiments.
require_emsdk_pin() {
    local script="$1" line version
    line="$(emcc --version 2>/dev/null | head -1 || true)"
    version="$(echo "$line" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    if [[ "$version" == "$WASM_EMSDK_PIN" ]]; then
        return 0
    fi
    if [[ "${XASM_ALLOW_EMSDK_DRIFT:-0}" == "1" ]]; then
        echo "⚠️  $script: active emcc is ${version:-unknown}, the pin is $WASM_EMSDK_PIN (XASM_ALLOW_EMSDK_DRIFT=1 — output will not match CI)" >&2
        return 0
    fi
    echo "❌ $script: active emcc is ${version:-unknown} ($line), but this build is pinned to emsdk $WASM_EMSDK_PIN." >&2
    echo "   Activate it (emsdk install/activate $WASM_EMSDK_PIN, then source its emsdk_env.sh, or set EMSDK_ENV=…)," >&2
    echo "   or set XASM_ALLOW_EMSDK_DRIFT=1 to build with this toolchain anyway." >&2
    exit 1
}

# source_emsdk_env <project-root>
# Activates emsdk unless an emcc is already on PATH: EMSDK_ENV (explicit) first, then the usual
# install locations. An emcc that is already active is never overridden.
source_emsdk_env() {
    local root="$1" f
    if [[ -n "${EMSDK_ENV:-}" ]]; then
        # shellcheck source=/dev/null  # emsdk env file: the path is only known at run time
        source "$EMSDK_ENV" >/dev/null 2>&1
        return 0
    fi
    if command -v emcc >/dev/null 2>&1; then
        return 0
    fi
    for f in \
        "/opt/emsdk/emsdk_env.sh" \
        "/workspaces/codepit/emsdk/emsdk_env.sh" \
        "/content/build_space/emsdk/emsdk_env.sh" \
        "$root/emsdk/emsdk_env.sh" \
        "$HOME/emsdk/emsdk_env.sh" \
        "/usr/local/emsdk/emsdk_env.sh"; do
        if [[ -f "$f" ]]; then
            # shellcheck source=/dev/null
            source "$f" >/dev/null 2>&1
            return 0
        fi
    done
}
