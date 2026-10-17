/**
 * bench_engine.cpp – Node benchmark entry points for NativeEngine (#491 Phase 3).
 *
 * Built by scripts/build-native-bench.sh with the native engine's own release
 * flags and libopenmpt.a, but for Node (no AudioWorklet), so
 * scripts/bench-engines.mjs can time the very process() the AudioWorklet runs,
 * quantum by quantum, next to the JS engine's processor on the same V8.
 */

#include <emscripten/emscripten.h>

#include "native_engine.h"

namespace {
xasm::NativeEngine g_engine;
float g_left[xasm::kMaxQuantum];
float g_right[xasm::kMaxQuantum];
constexpr int kMaxTimed = 1 << 19;
double g_times[kMaxTimed];
} // namespace

extern "C" {

/** Parse + publish (adopts `data`). Returns elapsed ms, or -1 on failure. */
EMSCRIPTEN_KEEPALIVE double bench_load(uint8_t* data, int length) {
    g_engine.setRenderSampleRate(48000);
    const double t0 = emscripten_get_now();
    if (!g_engine.loadModule(data, length) || !g_engine.commitModule()) return -1.0;
    return emscripten_get_now() - t0;
}

EMSCRIPTEN_KEEPALIVE void bench_render_param(int param, int value) { g_engine.setRenderParam(param, value); }

/** Render `quanta` quanta, timing each process() call; returns how many were timed. */
EMSCRIPTEN_KEEPALIVE int bench_render(int quanta) {
    const int n = quanta < kMaxTimed ? quanta : kMaxTimed;
    for (int i = 0; i < n; ++i) {
        const double t0 = emscripten_get_now();
        g_engine.process(g_left, g_right, xasm::kMaxQuantum);
        g_times[i] = emscripten_get_now() - t0;
    }
    return n;
}

EMSCRIPTEN_KEEPALIVE const double* bench_times() { return g_times; }
EMSCRIPTEN_KEEPALIVE const char* bench_error() { return g_engine.lastError(); }

/** Peak |sample| of the last quantum (proves the bench rendered sound). */
EMSCRIPTEN_KEEPALIVE float bench_peak() {
    float peak = 0.0f;
    for (int i = 0; i < xasm::kMaxQuantum; ++i) {
        const float l = g_left[i] < 0 ? -g_left[i] : g_left[i];
        const float r = g_right[i] < 0 ? -g_right[i] : g_right[i];
        peak = l > peak ? l : peak;
        peak = r > peak ? r : peak;
    }
    return peak;
}

} // extern "C"
