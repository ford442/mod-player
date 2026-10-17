#pragma once
/**
 * Shared helpers for the host-native engine tests (#491). Host only: these
 * files are never part of the Emscripten build.
 */

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "native_engine.h"

namespace hosttest {

inline int& failures() {
    static int n = 0;
    return n;
}

#define HOST_CHECK(cond)                                                                   \
    do {                                                                                   \
        if (!(cond)) {                                                                     \
            std::fprintf(stderr, "CHECK failed %s:%d: %s\n", __FILE__, __LINE__, #cond); \
            ++hosttest::failures();                                                        \
        }                                                                                  \
    } while (0)

inline double nowMs() {
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}

inline void relax() { std::this_thread::yield(); }

inline xasm::EngineHooks hooks() {
    xasm::EngineHooks h;
    h.nowMs = nowMs;
    h.relax = relax;
    return h;
}

inline std::vector<uint8_t> readFile(const std::string& path) {
    std::vector<uint8_t> bytes;
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) {
        std::fprintf(stderr, "cannot open fixture %s\n", path.c_str());
        std::exit(2);
    }
    uint8_t buf[65536];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) bytes.insert(bytes.end(), buf, buf + n);
    std::fclose(f);
    return bytes;
}

/** load_module() adopts a malloc'd buffer, exactly like the TS engine's _malloc copy. */
inline uint8_t* mallocCopy(const std::vector<uint8_t>& bytes) {
    auto* p = static_cast<uint8_t*>(std::malloc(bytes.size()));
    if (!p) std::abort();
    std::memcpy(p, bytes.data(), bytes.size());
    return p;
}

inline int load(xasm::NativeEngine& e, const std::vector<uint8_t>& bytes) {
    return e.loadModule(mallocCopy(bytes), static_cast<int>(bytes.size()));
}

struct Quantum {
    float left[xasm::kMaxQuantum];
    float right[xasm::kMaxQuantum];

    float peak() const {
        float p = 0.0f;
        for (int i = 0; i < xasm::kMaxQuantum; ++i) {
            p = std::fmax(p, std::fabs(left[i]));
            p = std::fmax(p, std::fabs(right[i]));
        }
        return p;
    }
};

/** Render `count` quanta and return the loudest sample seen. */
inline float render(xasm::NativeEngine& e, int count) {
    Quantum q;
    float peak = 0.0f;
    for (int i = 0; i < count; ++i) {
        e.process(q.left, q.right, xasm::kMaxQuantum);
        peak = std::fmax(peak, q.peak());
    }
    return peak;
}

struct Fixtures {
    std::vector<uint8_t> mod;      // 4-mat_madness.mod (4 ch, audible)
    std::vector<uint8_t> testMod;  // libopenmpt-test.mod
    std::vector<uint8_t> it;       // tests/fixtures/minimal.it
    std::vector<uint8_t> xm;       // synthetic 32-channel XM (audible on every row)
    std::vector<uint8_t> corrupt;  // truncated IT 2.15 sample block (libopenmpt throws + catches)

    static Fixtures load(const std::string& dir) {
        Fixtures f;
        f.mod = readFile(dir + "/4-mat_madness.mod");
        f.testMod = readFile(dir + "/libopenmpt-test.mod");
        f.it = readFile(dir + "/minimal.it");
        f.xm = readFile(dir + "/synth-32ch.xm");
        f.corrupt = readFile(dir + "/corrupt-it215-sample.it");
        return f;
    }

    const std::vector<uint8_t>& byIndex(size_t i) const {
        switch (i % 4) {
            case 0: return mod;
            case 1: return xm;
            case 2: return testMod;
            default: return it;
        }
    }
};

} // namespace hosttest
