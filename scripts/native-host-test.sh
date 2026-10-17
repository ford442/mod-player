#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/native-host-test.sh – the native engine's C++ under host sanitizers (#491)
#
# Emscripten has no ThreadSanitizer for wasm, so the engine core
# (cpp/native_engine.cpp + cpp/openmpt_wrapper.cpp — no Emscripten headers) is
# compiled for the HOST against a host build of the same pinned libopenmpt, and
# cpp/host/ drives load_module / process from two std::threads.
#
# Flavours (default: all three):
#   tsan   ThreadSanitizer: functional + stress (load B while A renders, ×ITERATIONS)
#          + teardown race + a negative control that MUST be reported
#   asan   AddressSanitizer + UBSan: functional + stress + teardown race (leaks fatal)
#   alloc  no sanitizer: counts malloc/free inside NativeEngine::process()
#
# Usage:
#   scripts/native-host-test.sh                  # tsan asan alloc
#   scripts/native-host-test.sh tsan             # one flavour
#   ITERATIONS=1000 ROUNDS=200 scripts/native-host-test.sh
#   CXX=clang++ CC=clang scripts/native-host-test.sh
#
# libopenmpt (version + sha256: scripts/lib/libopenmpt-source.sh) is built once per
# flavour, with the same sanitizer so races inside libopenmpt are visible, in
# vendor/libopenmpt-host-<flavour>/, keyed by a flag stamp; CI caches those trees.
# Needs: a C++17 compiler with -fsanitize support, make, node (fixtures), and wget
# only if the pristine sources are not vendored yet (the tarball is sha256-checked).
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/lib/libopenmpt-source.sh
source "$SCRIPT_DIR/lib/libopenmpt-source.sh"

VENDOR_ROOT="$PROJECT_ROOT/vendor"
BUILD_ROOT="$VENDOR_ROOT/native-host-test"
ITERATIONS="${ITERATIONS:-1000}"
ROUNDS="${ROUNDS:-200}"
CXX="${CXX:-g++}"
CC="${CC:-gcc}"
JOBS="$(nproc 2>/dev/null || echo 2)"

FLAVOURS=("$@")
if [[ ${#FLAVOURS[@]} -eq 0 ]]; then
    FLAVOURS=(tsan asan alloc)
fi
for f in "${FLAVOURS[@]}"; do
    case "$f" in
        tsan|asan|alloc) ;;
        -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown flavour: $f (tsan, asan, alloc)" >&2; exit 1 ;;
    esac
done

case "$("$CXX" --version 2>/dev/null | head -1)" in
    *clang*) MAKE_CONFIG=clang ;;
    *) MAKE_CONFIG=gcc ;;
esac

flavour_flags() {
    case "$1" in
        tsan) echo "-O1 -g -fsanitize=thread" ;;
        asan) echo "-O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined -fno-sanitize-recover=undefined" ;;
        alloc) echo "-O2 -g" ;;
    esac
}

# libopenmpt gets the same sanitizers, minus one UBSan check for a benign upstream pattern:
# under GCC >= 12 its FileDataMemory::Read() calls memcpy(vector.data(), src, 0) for empty vectors
# (src/mpt/io_read/filedata_memory.hpp, a -Warray-bounds work-around; e.g. an IT with no
# instruments), and memcpy's first argument is declared nonnull. Our own code keeps the full check.
libopenmpt_flags() {
    case "$1" in
        asan) echo "$(flavour_flags asan) -fno-sanitize=nonnull-attribute" ;;
        *) flavour_flags "$1" ;;
    esac
}

# Kernels with vm.mmap_rnd_bits > 28 (Ubuntu 24.04's 6.x default is 32) make TSan abort with
# "unexpected memory mapping"; running without ASLR sidesteps it on any kernel.
run_no_aslr() {
    if command -v setarch >/dev/null 2>&1 && setarch "$(uname -m)" -R true 2>/dev/null; then
        setarch "$(uname -m)" -R "$@"
    else
        "$@"
    fi
}

build_host_libopenmpt() {
    local flavour="$1" flags tree stamp stamp_file
    flags="$(libopenmpt_flags "$flavour")"
    tree="$VENDOR_ROOT/libopenmpt-host-${flavour}"
    stamp="$(printf '%s\n' "$LIBOPENMPT_VERSION" "$MAKE_CONFIG" "$("$CXX" --version | head -1)" "$flags" \
        | sha256sum | cut -c1-16)"
    stamp_file="$tree/bin/.host-flags"
    if [[ -f "$tree/bin/libopenmpt.a" && -f "$stamp_file" && "$(cat "$stamp_file")" == "$stamp" \
        && "$(cat "$tree/.libopenmpt-version" 2>/dev/null)" == "$LIBOPENMPT_VERSION" ]]; then
        echo "✅ host libopenmpt.a [$flavour] up to date" >&2
        echo "$tree"
        return 0
    fi
    rm -rf "$tree"
    libopenmpt_copy_sources "$PRISTINE_TREE" "$tree"
    echo "$LIBOPENMPT_VERSION" > "$tree/.libopenmpt-version"
    echo "🔨 Building host libopenmpt.a [$flavour: $flags] ($MAKE_CONFIG, -j$JOBS)…" >&2
    # Flags go through the ENVIRONMENT: the Makefile captures CXXFLAGS/CFLAGS from it and then
    # appends its own (-std, -fvisibility, warnings). OPTIMIZE=none keeps our -O level.
    (
        cd "$tree"
        CXX="$CXX" CC="$CC" CXXFLAGS="$flags" CFLAGS="$flags" LDFLAGS="$flags" \
        make CONFIG="$MAKE_CONFIG" OPTIMIZE=none STATIC_LIB=1 SHARED_LIB=0 EXAMPLES=0 OPENMPT123=0 TEST=0 \
            NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1 \
            NO_PORTAUDIO=1 NO_PORTAUDIOCPP=1 NO_PULSEAUDIO=1 NO_SDL2=1 NO_FLAC=1 NO_SNDFILE=1 \
            -j"$JOBS" bin/libopenmpt.a >"$tree/bin/build.log" 2>&1
    ) || { tail -30 "$tree/bin/build.log" >&2; echo "❌ host libopenmpt build failed" >&2; exit 1; }
    echo "$stamp" > "$stamp_file"
    echo "$tree"
}

# ── fixtures ─────────────────────────────────────────────────────────
make_fixtures() {
    local dir="$BUILD_ROOT/fixtures"
    mkdir -p "$dir"
    cp "$PROJECT_ROOT/public/4-mat_madness.mod" "$PROJECT_ROOT/public/libopenmpt-test.mod" \
        "$PROJECT_ROOT/tests/fixtures/minimal.it" "$dir/"
    node --input-type=module - "$PROJECT_ROOT" "$dir" <<'EOF'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, dir] = process.argv.slice(2);
const { synthXm } = await import(pathToFileURL(join(root, 'scripts/lib/synth-xm.mjs')).href);
const { corruptIt215Sample } = await import(pathToFileURL(join(root, 'scripts/lib/corrupt-it.mjs')).href);
writeFileSync(join(dir, 'synth-32ch.xm'), synthXm(32));
writeFileSync(join(dir, 'corrupt-it215-sample.it'), corruptIt215Sample());
EOF
    echo "$dir"
}

compile_test() {
    local flavour="$1" tree="$2" source="$3" out="$4" flags
    flags="$(flavour_flags "$flavour")"
    # shellcheck disable=SC2086  # $flags is a deliberate word list
    "$CXX" -std=c++17 $flags -Wall -Wextra -Werror -pthread \
        -I"$PROJECT_ROOT/cpp" -I"$tree" \
        "$PROJECT_ROOT/cpp/host/$source" "$PROJECT_ROOT/cpp/native_engine.cpp" "$PROJECT_ROOT/cpp/openmpt_wrapper.cpp" \
        "$tree/bin/libopenmpt.a" -lm -rdynamic -o "$out"
}

PRISTINE_TREE="$(libopenmpt_ensure_pristine "$VENDOR_ROOT")"
mkdir -p "$BUILD_ROOT"
FIXTURES="$(make_fixtures)"
FAILED=0

for flavour in "${FLAVOURS[@]}"; do
    tree="$(build_host_libopenmpt "$flavour")"
    bin_dir="$BUILD_ROOT/$flavour"
    mkdir -p "$bin_dir"
    echo "── $flavour ─────────────────────────────────────────────"
    case "$flavour" in
        tsan)
            compile_test tsan "$tree" engine_tests.cpp "$bin_dir/engine_tests"
            export TSAN_OPTIONS="halt_on_error=1 second_deadlock_stack=1 exitcode=66"
            run_no_aslr "$bin_dir/engine_tests" functional "$FIXTURES" || FAILED=1
            run_no_aslr "$bin_dir/engine_tests" stress "$FIXTURES" "$ITERATIONS" || FAILED=1
            run_no_aslr "$bin_dir/engine_tests" teardown-race "$FIXTURES" "$ROUNDS" || FAILED=1
            # The harness must be able to see a libopenmpt race at all.
            set +e
            run_no_aslr "$bin_dir/engine_tests" negative-control "$FIXTURES" >"$bin_dir/negative.log" 2>&1
            rc=$?
            set -e
            if [[ $rc -eq 66 ]] && grep -q 'ThreadSanitizer: data race' "$bin_dir/negative.log"; then
                echo "negative-control: TSan reported the deliberate race (expected)"
            else
                echo "❌ negative-control: expected a TSan data-race report (exit 66), got exit $rc" >&2
                tail -20 "$bin_dir/negative.log" >&2
                FAILED=1
            fi
            ;;
        asan)
            compile_test asan "$tree" engine_tests.cpp "$bin_dir/engine_tests"
            export ASAN_OPTIONS="detect_leaks=1 abort_on_error=0 halt_on_error=1"
            export UBSAN_OPTIONS="print_stacktrace=1 halt_on_error=1"
            "$bin_dir/engine_tests" functional "$FIXTURES" || FAILED=1
            "$bin_dir/engine_tests" stress "$FIXTURES" "$((ITERATIONS / 4 > 0 ? ITERATIONS / 4 : 1))" || FAILED=1
            "$bin_dir/engine_tests" teardown-race "$FIXTURES" "$((ROUNDS / 4 > 0 ? ROUNDS / 4 : 1))" || FAILED=1
            ;;
        alloc)
            compile_test alloc "$tree" alloc_tests.cpp "$bin_dir/alloc_tests"
            "$bin_dir/alloc_tests" "$FIXTURES" || FAILED=1
            ;;
    esac
done

if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ native host tests FAILED" >&2
    exit 1
fi
echo "✅ native host tests passed (${FLAVOURS[*]})"
