/**
 * alloc_tests.cpp – counts heap allocations made inside NativeEngine::process()
 * (#491). Built WITHOUT sanitizers (they interpose malloc themselves) by
 * scripts/native-host-test.sh.
 *
 * glibc's malloc family is replaced below; operator new/delete in libstdc++
 * call malloc/free, so C++ allocations are counted too. Only calls made while
 * `t_inProcess` is set — i.e. from inside process() on this thread — count.
 *
 * Asserted to be 0: the first quantum of a module, steady-state render across
 * order changes, module swaps at the default and a non-default rate, and every
 * ring command except seek.
 *
 * Reported, not asserted — both inside libopenmpt and event-driven, never per
 * quantum:
 *   - seek: set_position_order_row() runs GetLength() to rebuild play state,
 *     which returns a std::vector;
 *   - song-loop restart (repeat = -1): CSoundFile::ProcessRow() calls
 *     RowVisitor::Initialize(true), which builds a temporary vector.
 * Neither can move off the thread that renders the module without patching
 * libopenmpt.
 */

#include <atomic>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include <execinfo.h>

#include "test_util.h"

extern "C" {
void* __libc_malloc(size_t size);
void* __libc_calloc(size_t n, size_t size);
void* __libc_realloc(void* p, size_t size);
void* __libc_memalign(size_t alignment, size_t size);
void __libc_free(void* p);
}

namespace {
thread_local bool t_inProcess = false;
thread_local bool t_tracing = false;
std::atomic<long> g_allocations{0};
std::atomic<long> g_frees{0};
bool g_trace = false; // XASM_ALLOC_TRACE=1: print a backtrace for each counted call

void traceHere(const char* what) {
    if (!g_trace || t_tracing) return;
    t_tracing = true; // backtrace() itself may allocate
    void* frames[32];
    const int n = backtrace(frames, 32);
    std::fprintf(stderr, "---- %s inside process():\n", what);
    backtrace_symbols_fd(frames, n, 2);
    t_tracing = false;
}

inline void countAlloc() {
    if (t_inProcess && !t_tracing) {
        g_allocations.fetch_add(1, std::memory_order_relaxed);
        traceHere("allocation");
    }
}
} // namespace

extern "C" {
void* malloc(size_t size) {
    countAlloc();
    return __libc_malloc(size);
}
void* calloc(size_t n, size_t size) {
    countAlloc();
    return __libc_calloc(n, size);
}
void* realloc(void* p, size_t size) {
    countAlloc();
    return __libc_realloc(p, size);
}
void* memalign(size_t alignment, size_t size) {
    countAlloc();
    return __libc_memalign(alignment, size);
}
void* aligned_alloc(size_t alignment, size_t size) {
    countAlloc();
    return __libc_memalign(alignment, size);
}
int posix_memalign(void** out, size_t alignment, size_t size) {
    countAlloc();
    void* p = __libc_memalign(alignment, size);
    if (!p) return 12; // ENOMEM
    *out = p;
    return 0;
}
void free(void* p) {
    if (p && t_inProcess && !t_tracing) {
        g_frees.fetch_add(1, std::memory_order_relaxed);
        traceHere("free");
    }
    __libc_free(p);
}
}

using hosttest::Fixtures;
using hosttest::load;
using xasm::NativeEngine;

namespace {

struct Count {
    long allocations;
    long frees;
};

/** Render `quanta` quanta with counting on; returns what process() allocated. */
Count countedRender(NativeEngine& e, int quanta) {
    hosttest::Quantum q;
    const long a0 = g_allocations.load();
    const long f0 = g_frees.load();
    for (int i = 0; i < quanta; ++i) {
        t_inProcess = true;
        e.process(q.left, q.right, xasm::kMaxQuantum);
        t_inProcess = false;
    }
    return {g_allocations.load() - a0, g_frees.load() - f0};
}

int failures = 0;

void expectZero(const char* what, const Count& c) {
    const bool ok = c.allocations == 0 && c.frees == 0;
    std::fprintf(stderr, "  %-58s allocs=%ld frees=%ld %s\n", what, c.allocations, c.frees, ok ? "ok" : "FAIL");
    if (!ok) ++failures;
}


/** Swap through every fixture; count the swap quantum + the new module's first 8. */
Count swaps(NativeEngine& e, const Fixtures& fx, int count) {
    Count total{0, 0};
    for (int i = 0; i < count; ++i) {
        if (load(e, fx.byIndex(i)) != 1 || e.commitModule() != 1) std::exit(3);
        const Count c = countedRender(e, 9);
        total.allocations += c.allocations;
        total.frees += c.frees;
        e.service();
    }
    return total;
}

void configure(NativeEngine& e, int rate) {
    e.setHooks(hosttest::hooks());
    e.setRenderSampleRate(rate);
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <fixtures-dir>\n", argv[0]);
        return 2;
    }
    const Fixtures fx = Fixtures::load(argv[1]);
    const char* trace = std::getenv("XASM_ALLOC_TRACE");
    g_trace = trace && trace[0] == '1';
    NativeEngine e;
    configure(e, 48000);
    constexpr int kRingCap = 4096;
    auto* ring = static_cast<uint8_t*>(std::malloc(8 + kRingCap * 2 * sizeof(float)));
    e.setPcmRing(ring, kRingCap);

    std::fprintf(stderr, "allocations inside NativeEngine::process():\n");
    if (load(e, fx.xm) != 1 || e.commitModule() != 1) return 3;
    expectZero("first quantum of the first module (32-ch XM)", countedRender(e, 1));
    // 26.7 s of a 30.7 s song: every order change, no song loop.
    expectZero("steady-state render, 32-ch XM, 10000 quanta (4 orders)", countedRender(e, 10000));

    // Every ring command but seek, interleaved with rendering.
    {
        Count total{0, 0};
        for (int round = 0; round < 50; ++round) {
            e.setChannelMute(round % 32, (round & 1) != 0);
            e.setRenderParam(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, (round & 1) ? 4 : 8);
            e.setRenderParam(OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT, 50 + round);
            e.setRenderParam(OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH, round % 10);
            e.setRenderParam(OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL, -round * 10);
            e.ctlSetText("play.at_end", (round & 1) ? "continue" : "stop");
            e.setLoop(true);
            e.setVolume(static_cast<float>(round) / 50.0f);
            e.setPaused((round % 7) == 0);
            const Count c = countedRender(e, 8);
            total.allocations += c.allocations;
            total.frees += c.frees;
        }
        expectZero("mute / 4 render params / ctl / loop / volume / pause x50", total);
    }
    e.setPaused(false);

    expectZero("12 module swaps @ 48 kHz (swap quantum + 8, MOD/XM/IT)", swaps(e, fx, 12));
    {
        // A rate other than libopenmpt's 48 kHz default takes the
        // SetMixerSettings branch on a module's first read.
        NativeEngine e44;
        configure(e44, 44100);
        expectZero("12 module swaps @ 44.1 kHz (swap quantum + 8)", swaps(e44, fx, 12));
        e44.teardown(100.0);
    }

    // libopenmpt-internal, event-driven: reported, not asserted.
    {
        if (load(e, fx.it) != 1 || e.commitModule() != 1) return 3; // 0.12 s song
        countedRender(e, 2);
        const Count loops = countedRender(e, 450); // ~10 song loops
        std::fprintf(stderr, "  %-58s allocs=%ld frees=%ld (informational)\n",
                     "~10 song-loop restarts (RowVisitor::Initialize)", loops.allocations, loops.frees);
    }
    {
        if (load(e, fx.xm) != 1 || e.commitModule() != 1) return 3;
        countedRender(e, 4);
        long allocs = 0;
        for (int i = 0; i < 20; ++i) {
            e.seek(i % 4, (i * 7) % 64);
            allocs += countedRender(e, 1).allocations;
        }
        std::fprintf(stderr, "  %-58s allocs=%ld (informational)\n", "20 seeks (GetLength)", allocs);
        expectZero("steady-state render after seeks, 2000 quanta", countedRender(e, 2000));
    }

    e.teardown(100.0);
    std::free(ring);
    if (failures) {
        std::fprintf(stderr, "alloc: %d FAILED\n", failures);
        return 1;
    }
    std::fprintf(stderr, "alloc: OK\n");
    return 0;
}
