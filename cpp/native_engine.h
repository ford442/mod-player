#pragma once
/**
 * native_engine.h – the native engine's thread-safe core (#491).
 *
 * Platform-independent on purpose: cpp/worklet_processor.cpp is the Emscripten
 * glue (KEEPALIVE exports, AudioWorklet thread, EM_ASM) and the host harness in
 * cpp/host/ drives the very same class from two std::threads under TSan / ASan.
 * Nothing in here may include an Emscripten header.
 *
 * Two threads, strictly:
 *
 *   control thread (the page's main thread)   audio thread (AudioWorklet)
 *   ──────────────────────────────────────    ────────────────────────────
 *   loadModule()  parse ONCE + snapshot       process()  once per render quantum:
 *   commitModule() ──── handoff_ ──────────▶    1. retire / swap the module
 *   setters ─────────── ring_ (SPSC) ──────▶    2. drain the command ring
 *   service() ◀──────── graveyard_ ─────────    3. render + publish position
 *   pollPosition / readPosition ◀── seqlock
 *   pattern queries → snapshot_ (never the live module)
 *   teardown() ──────── teardown_ ─────────▶   hands its modules back, acks
 *
 * Ownership is transferred only by atomic exchange, so exactly one thread owns
 * any OpenMPT module at any time, and only the control thread ever creates or
 * destroys one: the audio thread never parses, never frees, never allocates.
 */

#include <atomic>
#include <cstddef>
#include <cstdint>

#include "openmpt_wrapper.h"

namespace xasm {

/** Largest render quantum process() accepts (frames per channel). */
constexpr int kMaxQuantum = 128;
/** Command ring slots (power of two). A full ring is not lossy — see Pending. */
constexpr uint32_t kCommandRingCapacity = 64;
/** ctl strings carried inline in a ring slot (incl. the terminating NUL). */
constexpr int kCtlKeyMax = 64;
constexpr int kCtlValueMax = 128;
/** Distinct ctl keys remembered and replayed onto every newly loaded module. */
constexpr int kMaxPersistedCtls = 8;
/** libopenmpt.h documents exactly four render param ids, 1..4. */
constexpr int kNumRenderParams = 4;

/** Platform services the engine needs but must not hard-code. */
struct EngineHooks {
    /** Monotonic milliseconds; bounds the teardown wait. Required for teardown(). */
    double (*nowMs)() = nullptr;
    /** Appends allocator numbers to an error string (best effort, may be null). */
    void (*appendHeapDetail)(char* buf, size_t capacity) = nullptr;
    /** Spin-wait hint while waiting for the audio thread (may be null). */
    void (*relax)() = nullptr;
};

/**
 * A parsed module plus the load generation it belongs to. Created and destroyed
 * on the control thread only; the audio thread borrows it between swap-in and
 * retirement.
 */
struct StagedModule {
    OpenMPTModule module;
    uint32_t generation = 0;
};

/**
 * Read-only copy of everything the host reads about a module's structure,
 * taken on the control thread right after the parse. Pattern queries are
 * answered from here so the control thread never touches a module the audio
 * thread is rendering (an openmpt_module is single-threaded).
 *
 * Cells are libopenmpt's six pattern commands per cell, in
 * OPENMPT_MODULE_COMMAND_* order (NOTE, INSTRUMENT, VOLUMEEFFECT, EFFECT,
 * VOLUME, PARAMETER), row-major per pattern: [row][channel][6].
 */
struct ModuleSnapshot {
    int32_t numChannels = 0;
    int32_t numOrders = 0;
    int32_t numPatterns = 0;
    double durationSeconds = 0.0;
    double initialBpm = 0.0;
    int32_t* orderPattern = nullptr;     // [numOrders]
    int32_t* patternRows = nullptr;      // [numPatterns]
    uint32_t* patternCellBase = nullptr; // [numPatterns], index of the pattern's first cell
    uint8_t* cells = nullptr;            // [cellCount * kCellBytes]
    size_t cellCount = 0;

    static constexpr int kCellBytes = 6;

    /** Fill from a module the caller owns exclusively. False on allocation failure. */
    bool build(const OpenMPTModule& m);
    void release();
    bool valid() const { return numOrders > 0 || numPatterns > 0 || numChannels > 0; }

    int orderPatternAt(int order) const;
    int rowsOf(int pattern) const;
    int cell(int pattern, int row, int channel, int command) const;
    /** Pointer to the pattern's first cell ([rows][channels][6] bytes), or null. */
    const uint8_t* patternCells(int pattern) const;
};

enum class CommandType : uint32_t {
    Seek = 1,        // a = order, b = row, generation = load it targets
    SetLoop,         // a = 0/1
    SetVolume,       // f = 0..1
    SetMuteMask,     // mask = full 32-bit channel mute mask
    SetRenderParam,  // a = param id (1..4), b = value
    CtlSetText,      // key / value
    SetPcmRing,      // ptr = ring base, a = capacity in stereo frames
};

/** One ring slot. Fixed size, trivially copyable: pushing never allocates. */
struct Command {
    CommandType type = CommandType::Seek;
    int32_t a = 0;
    int32_t b = 0;
    float f = 0.0f;
    uint32_t mask = 0;
    uint32_t generation = 0;
    uint8_t* ptr = nullptr;
    char key[kCtlKeyMax] = {0};
    char value[kCtlValueMax] = {0};
};

/**
 * Bounded single-producer / single-consumer ring. The producer is the control
 * thread, the consumer the audio thread; neither ever blocks or allocates.
 */
template <typename T, uint32_t N>
class SpscRing {
    static_assert(N >= 2 && (N & (N - 1)) == 0, "capacity must be a power of two");

public:
    /** Producer only. False when full (the caller keeps the value and retries). */
    bool push(const T& value) {
        const uint32_t head = head_.load(std::memory_order_relaxed);
        const uint32_t tail = tail_.load(std::memory_order_acquire);
        if (head - tail == N) return false;
        slots_[head & (N - 1)] = value;
        head_.store(head + 1, std::memory_order_release);
        return true;
    }

    /** Consumer only. Applies every slot published so far; returns how many. */
    template <typename F>
    uint32_t drain(F&& apply) {
        uint32_t tail = tail_.load(std::memory_order_relaxed);
        const uint32_t head = head_.load(std::memory_order_acquire);
        uint32_t n = 0;
        while (tail != head) {
            apply(static_cast<const T&>(slots_[tail & (N - 1)]));
            ++tail;
            ++n;
        }
        tail_.store(tail, std::memory_order_release);
        return n;
    }

    /** Producer-side view of the fill level (exact for the producer). */
    uint32_t sizeForProducer() const {
        return head_.load(std::memory_order_relaxed) - tail_.load(std::memory_order_acquire);
    }

private:
    alignas(64) std::atomic<uint32_t> head_{0};
    alignas(64) std::atomic<uint32_t> tail_{0};
    T slots_[N];
};

/** Counters for tests and diagnostics (read on the control thread). */
struct EngineStats {
    uint32_t modulesCreated = 0;   // successful parses
    uint32_t modulesDestroyed = 0; // every destroy, whichever path
    uint32_t swapsObserved = 0;    // retirements drained from the graveyard
    uint32_t pendingFlushes = 0;   // ring-full retries that later succeeded
    uint32_t leakedOnTeardown = 0; // modules left alone because the audio thread never acked
};

class NativeEngine {
public:
    NativeEngine();
    ~NativeEngine();

    NativeEngine(const NativeEngine&) = delete;
    NativeEngine& operator=(const NativeEngine&) = delete;

    void setHooks(const EngineHooks& hooks) { hooks_ = hooks; }

    // ── Control thread ─────────────────────────────────────────────────
    /** Before the audio thread starts (thread start publishes it). */
    void setRenderSampleRate(int hz) { renderSampleRate_ = hz > 0 ? hz : 48000; }
    int renderSampleRate() const { return renderSampleRate_; }
    /** An audio thread may now call process(); teardown() must wait for its ack. */
    void markAudioThreadStarted() { audioThreadStarted_ = true; }
    bool audioThreadStarted() const { return audioThreadStarted_; }

    /**
     * Parse `data` (ownership adopted: it is freed on every path) into a staged
     * module and snapshot its structure. 1 on success, 0 with lastError() set.
     * The snapshot always describes the last successful load: a failed load
     * clears it (queries answer 0) rather than describe a module the audio
     * thread may be rendering.
     */
    int loadModule(uint8_t* data, int length);
    /** Publish the staged module to the audio thread. 1 if one was published. */
    int commitModule();

    void setPaused(bool paused) { paused_.store(paused ? 1 : 0, std::memory_order_release); }
    void seek(int order, int row);
    void setLoop(bool loop);
    void setVolume(float volume);
    void setChannelMute(int channel, bool muted);
    void setRenderParam(int param, int32_t value);
    void ctlSetText(const char* key, const char* value);
    /** `buf` = 8-byte header (writeHead, readHead) + stereo float samples. */
    void setPcmRing(uint8_t* buf, int capacityFrames);
    int pcmRingWriteHead() const;

    /** Free retired modules and retry ring-full commands. Cheap; call often. */
    void service();

    /** Position storage when a new sample is ready (raw bytes = PositionInfo), else null. */
    const PositionInfo* pollPosition();
    uint32_t positionSeq() const { return positionSeq_.load(std::memory_order_acquire); }
    /** Consistent copy through the seqlock (C++ readers; JS reads the bytes). */
    bool readPosition(PositionInfo& out) const;
    /** The PositionInfo bytes JS decodes (fixed address for the engine's life). */
    const PositionInfo* positionStorage() const {
        return reinterpret_cast<const PositionInfo*>(positionWords_);
    }

    const ModuleSnapshot& snapshot() const { return snapshot_; }

    const char* lastError() const { return lastError_[0] ? lastError_ : nullptr; }
    void clearLastError() { lastError_[0] = '\0'; }

    /**
     * Terminal: stop the audio thread from touching any module, wait (bounded)
     * for its ack, then free everything. Without an ack the live module is
     * leaked on purpose — freeing memory the audio thread may still read is the
     * bug this replaces. Returns true when the audio thread acked (or never ran).
     */
    bool teardown(double timeoutMs);
    bool tornDown() const { return tornDown_; }

    const EngineStats& stats() const { return stats_; }
    /** Modules currently allocated (staged + published + live + retired). */
    int residentModules() const {
        return static_cast<int>(stats_.modulesCreated - stats_.modulesDestroyed - stats_.leakedOnTeardown);
    }

    // ── Audio thread ───────────────────────────────────────────────────
    /** Render `frames` (<= kMaxQuantum) planar stereo frames. Never allocates. */
    void process(float* left, float* right, int frames);

private:
    struct CtlEntry {
        char key[kCtlKeyMax];
        char value[kCtlValueMax];
    };

    /** What the host asked for; replayed onto every module before it is published. */
    struct DesiredState {
        uint32_t muteMask = 0;
        bool loopSet = false;
        bool loop = true;
        bool volumeSet = false;
        float volume = 1.0f;
        bool renderSet[kNumRenderParams] = {false, false, false, false};
        int32_t renderValue[kNumRenderParams] = {0, 0, 0, 0};
        CtlEntry ctls[kMaxPersistedCtls];
        int numCtls = 0;
    };

    /**
     * Commands that did not fit the ring (audio thread stalled, context
     * suspended). Every category is "latest value wins", so keeping only the
     * newest value per category and retrying in service() loses nothing.
     */
    struct Pending {
        bool seek = false;
        int32_t seekOrder = 0;
        int32_t seekRow = 0;
        uint32_t seekGeneration = 0;
        bool loop = false;
        bool volume = false;
        bool mute = false;
        bool render[kNumRenderParams] = {false, false, false, false};
        uint32_t ctlMask = 0; // bit i = desired_.ctls[i]
        bool pcmRing = false;
        uint8_t* pcmRingPtr = nullptr;
        int32_t pcmRingCapacity = 0;
    };

    // control thread
    void setErrorf(const char* fmt, ...) __attribute__((format(printf, 2, 3)));
    void appendHeapDetail();
    void destroyModule(StagedModule* m);
    void drainGraveyard();
    void applyDesiredState(OpenMPTModule& m) const;
    bool pushOrDefer(const Command& cmd);
    void flushPending();
    bool anyPending() const;
    Command makeSeek(int order, int row, uint32_t generation) const;
    Command makeRender(int index) const;
    Command makeCtl(int index) const;
    Command makeMask() const;
    Command makeLoop() const;
    Command makeVolume() const;
    Command makePcmRing(uint8_t* ptr, int32_t capacity) const;

    // audio thread
    void applyCommand(const Command& cmd);
    void resetClock();
    void publishPosition(const PositionInfo& info);
    void publishEnded();
    void writePcmRing(const float* interleaved, int frames);

    EngineHooks hooks_;

    // ── control-thread state ──
    StagedModule* staged_ = nullptr; // parsed, not yet published
    ModuleSnapshot snapshot_;
    DesiredState desired_;
    Pending pending_;
    uint32_t generation_ = 0;         // generation of the newest load
    uint32_t publishedGeneration_ = 0;
    int32_t* mainPcmHeader_ = nullptr; // for pcmRingWriteHead()
    char* knownCtls_ = nullptr;        // libopenmpt's ctl list (static per build), for validation
    char lastError_[320] = {0};
    bool audioThreadStarted_ = false;
    bool tornDown_ = false;
    EngineStats stats_;
    int renderSampleRate_ = 48000;

    // ── shared ──
    std::atomic<StagedModule*> handoff_{nullptr};   // control → audio
    std::atomic<StagedModule*> graveyard_{nullptr}; // audio → control
    SpscRing<Command, kCommandRingCapacity> ring_;
    std::atomic<int> paused_{0};
    std::atomic<int> teardown_{0};
    std::atomic<int> teardownAck_{0};
    StagedModule* handedBackLive_ = nullptr;     // written by audio before the ack
    StagedModule* handedBackRetiring_ = nullptr; // written by audio before the ack

    // Position seqlock. Every word is accessed atomically on both sides, so the
    // C++ reader is race-free; JS reads the same bytes and checks the sequence.
    static constexpr size_t kPositionWords = sizeof(PositionInfo) / sizeof(uint32_t);
    static_assert(sizeof(PositionInfo) % sizeof(uint32_t) == 0, "PositionInfo must be word-sized");
    alignas(8) uint32_t positionWords_[kPositionWords] = {0};
    std::atomic<uint32_t> positionSeq_{0};
    std::atomic<int> positionReady_{0};

    // ── audio-thread state ──
    StagedModule* live_ = nullptr;
    StagedModule* retiring_ = nullptr; // waiting for an empty graveyard
    bool deferredSeekValid_ = false;
    Command deferredSeek_;
    bool audioAcked_ = false;
    double framesRendered_ = 0.0;
    int lastReportedRow_ = -1;
    double timeSinceLastReport_ = 0.0;
    int rowStartRow_ = -1;        // row whose start rowStartPosSec_ marks
    double rowStartPosSec_ = 0.0; // song position when that row began
    int32_t* pcmHeader_ = nullptr;
    float* pcmSamples_ = nullptr;
    int32_t pcmCapacity_ = 0;
};

} // namespace xasm
