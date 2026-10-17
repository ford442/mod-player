/**
 * engine_tests.cpp – host-native tests for cpp/native_engine.cpp (#491).
 *
 * Built and run by scripts/native-host-test.sh under ThreadSanitizer and under
 * AddressSanitizer + UBSan, against a host build of the same pinned libopenmpt
 * (instrumented too, so races *inside* libopenmpt are visible).
 *
 *   engine_tests functional <fixtures>              single-threaded behaviour
 *   engine_tests stress <fixtures> [iterations]     load B while A renders, ×N (fast audio
 *                                                   thread) + ×N/4 (slow: the ring fills)
 *   engine_tests teardown-race <fixtures> [rounds]  cleanup while the audio thread renders
 *   engine_tests negative-control <fixtures>        shares one module across threads on
 *                                                   purpose: TSan MUST report (proves the
 *                                                   harness can see a libopenmpt race)
 */

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <string>
#include <thread>

#include "test_util.h"

using hosttest::Fixtures;
using hosttest::load;
using hosttest::render;
using xasm::NativeEngine;

namespace {

constexpr int kRate = 48000;

/** Spin up a NativeEngine the way worklet_processor.cpp does. */
void configure(NativeEngine& e) {
    e.setHooks(hosttest::hooks());
    e.setRenderSampleRate(kRate);
}

PositionInfo position(const NativeEngine& e) {
    PositionInfo info;
    std::memset(&info, 0, sizeof(info));
    HOST_CHECK(e.readPosition(info));
    return info;
}

// ── functional ──────────────────────────────────────────────────────

void testSnapshotMatchesLibopenmpt(const Fixtures& fx) {
    for (const auto* bytes : {&fx.mod, &fx.xm, &fx.it, &fx.testMod}) {
        NativeEngine e;
        configure(e);
        HOST_CHECK(load(e, *bytes) == 1);
        OpenMPTModule ref;
        HOST_CHECK(ref.load(bytes->data(), bytes->size()));
        const xasm::ModuleSnapshot& s = e.snapshot();
        HOST_CHECK(s.numChannels == ref.getNumChannels());
        HOST_CHECK(s.numOrders == ref.getNumOrders());
        HOST_CHECK(s.numPatterns == ref.getNumPatterns());
        HOST_CHECK(s.durationSeconds == ref.getDurationSeconds());
        for (int o = 0; o < s.numOrders; ++o) HOST_CHECK(s.orderPatternAt(o) == ref.getOrderPattern(o));
        size_t mismatches = 0;
        for (int p = 0; p < s.numPatterns; ++p) {
            HOST_CHECK(s.rowsOf(p) == ref.getPatternNumRows(p));
            const uint8_t* bulk = s.patternCells(p);
            for (int r = 0; r < s.rowsOf(p); ++r) {
                for (int c = 0; c < s.numChannels; ++c) {
                    for (int cmd = 0; cmd < 6; ++cmd) {
                        const int want = ref.getPatternRowChannelCommand(p, r, c, cmd);
                        if (s.cell(p, r, c, cmd) != want) ++mismatches;
                        if (bulk && bulk[(static_cast<size_t>(r) * s.numChannels + c) * 6 + cmd] != want) ++mismatches;
                    }
                }
            }
        }
        HOST_CHECK(mismatches == 0);
        // Out-of-range queries answer 0, like libopenmpt's own getters.
        HOST_CHECK(s.rowsOf(-1) == 0 && s.rowsOf(s.numPatterns) == 0);
        HOST_CHECK(s.cell(0, -1, 0, 0) == 0 && s.cell(0, 0, s.numChannels, 0) == 0 && s.cell(0, 0, 0, 6) == 0);
        HOST_CHECK(s.patternCells(-1) == nullptr);
        // The snapshot keeps answering after the module goes to the audio thread.
        const int orders = s.numOrders;
        HOST_CHECK(e.commitModule() == 1);
        render(e, 4);
        HOST_CHECK(e.snapshot().numOrders == orders);
    }
}

void testTypedErrors(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(e.loadModule(nullptr, 0) == 0);
    HOST_CHECK(e.lastError() && std::strncmp(e.lastError(), "ERR_BAD_ARGS", 12) == 0);

    std::vector<uint8_t> garbage(4096);
    std::mt19937 rng(1234);
    for (auto& b : garbage) b = static_cast<uint8_t>(rng());
    HOST_CHECK(load(e, garbage) == 0);
    HOST_CHECK(e.lastError() && std::strncmp(e.lastError(), "ERR_UNSUPPORTED_MODULE", 22) == 0);

    // libopenmpt throws inside the IT 2.15 decompressor and catches it itself:
    // with exceptions working that is a normal load (no abort).
    HOST_CHECK(load(e, fx.corrupt) == 1);
    HOST_CHECK(e.lastError() == nullptr);
    HOST_CHECK(e.snapshot().numOrders >= 1);
    HOST_CHECK(e.commitModule() == 1);
    render(e, 8);
    HOST_CHECK(e.residentModules() == 1);
}

void testSwapRetiresThroughGraveyard(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    HOST_CHECK(render(e, 64) > 0.01f); // A is live and audible
    HOST_CHECK(load(e, fx.mod) == 1);
    HOST_CHECK(e.residentModules() == 2); // A live + B staged: never a second parse of either
    HOST_CHECK(e.commitModule() == 1);
    render(e, 1); // swap: A goes to the graveyard
    HOST_CHECK(e.residentModules() == 2);
    e.service(); // the control thread frees it
    HOST_CHECK(e.residentModules() == 1);
    HOST_CHECK(e.stats().swapsObserved == 1);
    HOST_CHECK(position(e).numChannels == 4); // B (the 4-channel MOD) is what renders now
}

void testFastReloadFreesUnconsumedPublish(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    // No quantum ran: the second commit gets the first back and frees it.
    HOST_CHECK(load(e, fx.mod) == 1 && e.commitModule() == 1);
    HOST_CHECK(e.residentModules() == 1);
    render(e, 2);
    HOST_CHECK(position(e).numChannels == 4);
    HOST_CHECK(e.stats().swapsObserved == 0); // nothing was ever live before B
}

void testSeekTargetsItsOwnModule(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    render(e, 2);
    // A seek sent for A, then a reload before any quantum ran: it must not land on B.
    e.seek(2, 0);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    render(e, 2);
    HOST_CHECK(position(e).currentOrder == 0);

    // A seek sent while B is staged targets B, and waits for B to go live.
    HOST_CHECK(load(e, fx.xm) == 1);
    e.seek(3, 0);
    render(e, 2); // the old module is still live; the seek is deferred, not applied to it
    HOST_CHECK(position(e).currentOrder == 0);
    HOST_CHECK(e.commitModule() == 1);
    render(e, 2);
    HOST_CHECK(position(e).currentOrder == 3);
    HOST_CHECK(position(e).audioFramesRendered < 3 * xasm::kMaxQuantum); // clock re-zeroed
}

void testDesiredStateReachesNewModules(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    for (int ch = 0; ch < 32; ++ch) e.setChannelMute(ch, true);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    HOST_CHECK(render(e, 128) == 0.0f); // muted before its first quantum
    for (int ch = 0; ch < 32; ++ch) e.setChannelMute(ch, false);
    HOST_CHECK(render(e, 128) > 0.01f);
}

void testRingOverflowIsLossless(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    render(e, 2);
    // ~6× the ring's capacity with no quantum in between (a stalled audio
    // thread): the last value of every category must still arrive.
    for (int round = 0; round < 12; ++round) {
        for (int ch = 0; ch < 32; ++ch) e.setChannelMute(ch, (round & 1) == 0);
        e.setRenderParam(OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT, 100 + round);
        e.ctlSetText("play.at_end", (round & 1) ? "continue" : "stop");
    }
    // round 11 was odd → everything unmuted; mute one more time, all channels.
    for (int ch = 0; ch < 32; ++ch) e.setChannelMute(ch, true);
    for (int i = 0; i < 16; ++i) {
        render(e, 1);
        e.service();
    }
    HOST_CHECK(e.stats().pendingFlushes > 0);
    HOST_CHECK(render(e, 64) == 0.0f);
}

void testPauseAndEnd(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    e.setPaused(true);
    HOST_CHECK(render(e, 32) == 0.0f);
    e.setPaused(false);
    HOST_CHECK(render(e, 32) > 0.01f);
    // Play-once ends with the currentRow == -1 sentinel.
    e.setLoop(false);
    e.seek(e.snapshot().numOrders - 1, e.snapshot().rowsOf(e.snapshot().orderPatternAt(e.snapshot().numOrders - 1)) - 1);
    render(e, 2000);
    HOST_CHECK(position(e).currentRow == -1);
}

void testPcmRing(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    constexpr int kCap = 1024;
    auto* buf = static_cast<uint8_t*>(std::malloc(8 + kCap * 2 * sizeof(float)));
    e.setPcmRing(buf, kCap);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    hosttest::Quantum q;
    e.process(q.left, q.right, xasm::kMaxQuantum);
    HOST_CHECK(e.pcmRingWriteHead() == xasm::kMaxQuantum);
    const float* samples = reinterpret_cast<const float*>(buf + 8);
    bool same = true;
    for (int i = 0; i < xasm::kMaxQuantum; ++i) {
        same = same && samples[i * 2] == q.left[i] && samples[i * 2 + 1] == q.right[i];
    }
    HOST_CHECK(same);
    HOST_CHECK(e.teardown(100.0));
    std::free(buf);
}

void testTeardownIsTerminalAndFreesEverything(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    render(e, 4);
    HOST_CHECK(load(e, fx.mod) == 1 && e.commitModule() == 1);
    HOST_CHECK(load(e, fx.it) == 1); // staged, never published
    HOST_CHECK(e.teardown(100.0));
    HOST_CHECK(e.residentModules() == 0);
    HOST_CHECK(load(e, fx.mod) == 0);
    HOST_CHECK(e.lastError() && std::strncmp(e.lastError(), "ERR_TORN_DOWN", 13) == 0);
    HOST_CHECK(render(e, 4) == 0.0f);
}

void testInvalidControlsNeverReachTheAudioThread(const Fixtures& fx) {
    NativeEngine e;
    configure(e);
    HOST_CHECK(load(e, fx.xm) == 1 && e.commitModule() == 1);
    // Each of these throws inside libopenmpt if it gets that far.
    e.setRenderParam(99, 1);
    e.ctlSetText("no.such.ctl", "1");
    e.ctlSetText("play.at_end", "explode");
    e.ctlSetText("", "x");
    std::string longKey(200, 'k');
    e.ctlSetText(longKey.c_str(), "1");
    e.setChannelMute(64, true);
    e.seek(10000, 0);
    e.seek(0, 100000);
    HOST_CHECK(render(e, 64) > 0.01f);
}

int functional(const Fixtures& fx) {
    testSnapshotMatchesLibopenmpt(fx);
    testTypedErrors(fx);
    testSwapRetiresThroughGraveyard(fx);
    testFastReloadFreesUnconsumedPublish(fx);
    testSeekTargetsItsOwnModule(fx);
    testDesiredStateReachesNewModules(fx);
    testRingOverflowIsLossless(fx);
    testPauseAndEnd(fx);
    testPcmRing(fx);
    testTeardownIsTerminalAndFreesEverything(fx);
    testInvalidControlsNeverReachTheAudioThread(fx);
    return 0;
}

// ── two threads ─────────────────────────────────────────────────────

/** The AudioWorklet stand-in: renders until told to stop. */
class AudioThread {
public:
    /** `slow`: sleep after every quantum, like a real 2.7 ms render cadence (the ring fills). */
    explicit AudioThread(NativeEngine& e, bool slow = false) : engine_(e), slow_(slow) {
        engine_.markAudioThreadStarted();
        thread_ = std::thread([this] { run(); });
    }
    ~AudioThread() { stop(); }

    void stop() {
        stop_.store(true, std::memory_order_release);
        if (thread_.joinable()) thread_.join();
    }
    uint64_t quanta() const { return quanta_.load(std::memory_order_relaxed); }

private:
    void run() {
        hosttest::Quantum q;
        std::mt19937 rng(42);
        while (!stop_.load(std::memory_order_acquire)) {
            engine_.process(q.left, q.right, xasm::kMaxQuantum);
            quanta_.fetch_add(1, std::memory_order_relaxed);
            if (slow_) std::this_thread::sleep_for(std::chrono::microseconds(500));
            else if ((rng() & 7) == 0) std::this_thread::yield();
        }
    }

    NativeEngine& engine_;
    const bool slow_;
    std::atomic<bool> stop_{false};
    std::atomic<uint64_t> quanta_{0};
    std::thread thread_;
};

/** Control-thread traffic between loads: everything the TS engine can send. */
void controlBurst(NativeEngine& e, std::mt19937& rng) {
    const xasm::ModuleSnapshot& s = e.snapshot();
    switch (rng() % 9) {
        case 0: e.seek(static_cast<int>(rng() % (s.numOrders + 1)), static_cast<int>(rng() % 64)); break;
        case 1: e.setChannelMute(static_cast<int>(rng() % 32), (rng() & 1) != 0); break;
        case 2: e.setRenderParam(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, (rng() & 1) ? 8 : 4); break;
        case 3: e.ctlSetText("play.at_end", (rng() & 1) ? "continue" : "stop"); break;
        case 4: e.setLoop((rng() & 1) != 0); break;
        case 5: e.setVolume(static_cast<float>(rng() % 100) / 100.0f); break;
        case 6: e.setPaused((rng() & 3) == 0); break;
        case 7: {
            // What NativePatternReader does right after a load: read every cell.
            uint32_t sum = 0;
            for (int p = 0; p < s.numPatterns; ++p) {
                for (int r = 0; r < s.rowsOf(p); r += 7) sum += static_cast<uint32_t>(s.cell(p, r, 0, 0));
            }
            (void)sum;
            break;
        }
        default: {
            PositionInfo info;
            e.readPosition(info);
            e.pollPosition();
            break;
        }
    }
}

int stressPhase(const Fixtures& fx, int iterations, bool slowAudio) {
    NativeEngine e;
    configure(e);
    constexpr int kRingCap = 2048;
    auto* ring = static_cast<uint8_t*>(std::malloc(8 + kRingCap * 2 * sizeof(float)));
    e.setPcmRing(ring, kRingCap);
    std::mt19937 rng(slowAudio ? 11 : 7);
    {
        AudioThread audio(e, slowAudio);
        for (int i = 0; i < iterations; ++i) {
            // Load B while A renders — the old engine freed the buffer the
            // audio thread was parsing here.
            HOST_CHECK(load(e, fx.byIndex(rng())) == 1);
            const int bursts = static_cast<int>(rng() % (slowAudio ? 160 : 6));
            for (int b = 0; b < bursts; ++b) controlBurst(e, rng);
            if (rng() % 8 != 0) HOST_CHECK(e.commitModule() == 1); // sometimes reload before commit
            const int bursts2 = static_cast<int>(rng() % 6);
            for (int b = 0; b < bursts2; ++b) controlBurst(e, rng);
            if ((rng() & 3) == 0) std::this_thread::yield();
            e.service();
            HOST_CHECK(e.residentModules() <= 5); // live, retiring, graveyard, published, staged
        }
        e.setPaused(false);
        HOST_CHECK(e.teardown(5000.0)); // the running audio thread must ack
        audio.stop();
        std::fprintf(stderr, "stress (%s audio thread): %d loads, %llu quanta, %u swaps, %u ring-full retries\n",
                     slowAudio ? "slow" : "fast", iterations, static_cast<unsigned long long>(audio.quanta()),
                     e.stats().swapsObserved, e.stats().pendingFlushes);
        HOST_CHECK(audio.quanta() > 0);
        if (slowAudio) HOST_CHECK(e.stats().pendingFlushes > 0); // the ring-full path really ran
    }
    HOST_CHECK(e.residentModules() == 0);
    HOST_CHECK(e.stats().leakedOnTeardown == 0);
    std::free(ring);
    return 0;
}

int stress(const Fixtures& fx, int iterations) {
    stressPhase(fx, iterations, false);
    // A render cadence closer to a real AudioWorklet: control bursts outrun the
    // ring, so the ring-full retry path runs concurrently too.
    stressPhase(fx, iterations / 4 > 0 ? iterations / 4 : 1, true);
    return 0;
}

int teardownRace(const Fixtures& fx, int rounds) {
    std::mt19937 rng(99);
    for (int r = 0; r < rounds; ++r) {
        NativeEngine e;
        configure(e);
        HOST_CHECK(load(e, fx.byIndex(r)) == 1 && e.commitModule() == 1);
        AudioThread audio(e);
        // Destroy at a random point: before the first swap, mid-render, after.
        const int spins = static_cast<int>(rng() % 2000);
        for (int i = 0; i < spins; ++i) hosttest::relax();
        if (r & 1) HOST_CHECK(load(e, fx.byIndex(r + 1)) == 1 && e.commitModule() == 1);
        HOST_CHECK(e.teardown(5000.0));
        audio.stop();
        HOST_CHECK(e.residentModules() == 0);
    }
    std::fprintf(stderr, "teardown-race: %d rounds\n", rounds);
    return 0;
}

/**
 * Deliberately WRONG: one OpenMPTModule driven by two threads at once — the
 * old engine's cleanup_audio()/pattern-query pattern. TSan must flag it; the
 * script treats a clean exit here as a harness failure.
 */
int negativeControl(const Fixtures& fx) {
    OpenMPTModule shared;
    if (!shared.load(fx.xm.data(), fx.xm.size())) return 3;
    std::atomic<bool> stop{false};
    std::thread audio([&] {
        float buf[xasm::kMaxQuantum * 2];
        while (!stop.load(std::memory_order_acquire)) shared.readInterleavedStereo(kRate, xasm::kMaxQuantum, buf);
    });
    for (int i = 0; i < 2000; ++i) shared.seekOrderRow(i % 4, 0);
    stop.store(true, std::memory_order_release);
    audio.join();
    std::fprintf(stderr, "negative-control: finished WITHOUT a sanitizer report\n");
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s functional|stress|teardown-race|negative-control <fixtures-dir> [n]\n",
                     argv[0]);
        return 2;
    }
    const std::string mode = argv[1];
    const Fixtures fx = Fixtures::load(argv[2]);
    const int n = argc > 3 ? std::atoi(argv[3]) : 0;
    int rc = 2;
    if (mode == "functional") rc = functional(fx);
    else if (mode == "stress") rc = stress(fx, n > 0 ? n : 1000);
    else if (mode == "teardown-race") rc = teardownRace(fx, n > 0 ? n : 200);
    else if (mode == "negative-control") rc = negativeControl(fx);
    else std::fprintf(stderr, "unknown mode %s\n", mode.c_str());
    if (hosttest::failures()) {
        std::fprintf(stderr, "%s: %d check(s) FAILED\n", mode.c_str(), hosttest::failures());
        return 1;
    }
    if (rc == 0) std::fprintf(stderr, "%s: OK\n", mode.c_str());
    return rc;
}
