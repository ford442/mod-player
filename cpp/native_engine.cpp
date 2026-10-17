/**
 * native_engine.cpp – see native_engine.h for the threading model (#491).
 *
 * Rules this file keeps (cpp/host/ enforces them at runtime under TSan /
 * ASan / an allocation count; scripts/verify-native-exports.mjs and
 * tests/nativeCtlApi.test.ts + tests/nativeSeekAtomicity.test.ts at the source
 * level):
 *   - process() never calls malloc/free/new/delete and never parses;
 *   - an OpenMPT module changes threads only through handoff_ / graveyard_
 *     exchanges, and is destroyed only on the control thread;
 *   - the control thread never touches live_ / retiring_ (the audio thread's
 *     modules) — pattern queries read snapshot_, controls go through ring_.
 */

#include "native_engine.h"

#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <new>

namespace xasm {

namespace {

constexpr int renderIndex(int param) { return param - 1; }

bool validRenderParam(int param) {
    switch (param) {
        case OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL:
        case OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT:
        case OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH:
        case OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH:
            return true;
        default:
            return false;
    }
}

static_assert(OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL == 1 && OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH == 4,
              "render param ids index DesiredState::renderValue[0..3]");

/** strlen bounded by `cap`; returns cap when no NUL is found within it. */
size_t boundedLength(const char* s, size_t cap) {
    size_t n = 0;
    while (n < cap && s[n] != '\0') ++n;
    return n;
}

/** True when `key` is one entry of a ';'-separated list (no allocation). */
bool listContains(const char* list, const char* key) {
    if (!list || !key || !key[0]) return false;
    const size_t keyLen = std::strlen(key);
    for (const char* p = list; *p;) {
        const char* end = std::strchr(p, ';');
        const size_t len = end ? static_cast<size_t>(end - p) : std::strlen(p);
        if (len == keyLen && std::strncmp(p, key, keyLen) == 0) return true;
        if (!end) break;
        p = end + 1;
    }
    return false;
}

/**
 * libopenmpt throws on a bad value for its text ctls (and the audio thread is
 * where the value lands), so the two text ctls of libopenmpt 0.8 are checked
 * here. Every other ctl is boolean / integer / float, which ctl_set_text
 * ignores without throwing.
 */
bool textCtlValueAccepted(const char* key, const char* value) {
    auto oneOf = [value](std::initializer_list<const char*> allowed) {
        for (const char* a : allowed) {
            if (std::strcmp(a, value) == 0) return true;
        }
        return false;
    };
    if (std::strcmp(key, "play.at_end") == 0) return oneOf({"fadeout", "continue", "stop"});
    if (std::strcmp(key, "render.resampler.emulate_amiga_type") == 0) {
        return oneOf({"a500", "a1200", "unfiltered", "auto"});
    }
    return true;
}

} // namespace

// ── ModuleSnapshot ──────────────────────────────────────────────────

bool ModuleSnapshot::build(const OpenMPTModule& m) {
    release();
    numChannels = m.getNumChannels();
    numOrders = m.getNumOrders();
    numPatterns = m.getNumPatterns();
    durationSeconds = m.getDurationSeconds();
    initialBpm = m.getBPM();
    if (numChannels < 0) numChannels = 0;
    if (numOrders < 0) numOrders = 0;
    if (numPatterns < 0) numPatterns = 0;

    // calloc(0) may legally return null; allocate at least one element so a
    // null pointer always means "out of memory".
    auto allocI32 = [](int32_t n) {
        return static_cast<int32_t*>(std::calloc(n > 0 ? static_cast<size_t>(n) : 1u, sizeof(int32_t)));
    };
    orderPattern = allocI32(numOrders);
    patternRows = allocI32(numPatterns);
    patternCellBase = static_cast<uint32_t*>(
        std::calloc(numPatterns > 0 ? static_cast<size_t>(numPatterns) : 1u, sizeof(uint32_t)));
    if (!orderPattern || !patternRows || !patternCellBase) {
        release();
        return false;
    }

    for (int o = 0; o < numOrders; ++o) orderPattern[o] = m.getOrderPattern(o);
    size_t total = 0;
    for (int p = 0; p < numPatterns; ++p) {
        int rows = m.getPatternNumRows(p);
        if (rows < 0) rows = 0;
        patternRows[p] = rows;
        patternCellBase[p] = static_cast<uint32_t>(total);
        total += static_cast<size_t>(rows) * static_cast<size_t>(numChannels);
        if (total > 0xFFFFFFFFu / kCellBytes) { // absurd module; refuse rather than wrap
            release();
            return false;
        }
    }
    cellCount = total;
    cells = static_cast<uint8_t*>(std::malloc(total > 0 ? total * kCellBytes : 1u));
    if (!cells) {
        release();
        return false;
    }
    uint8_t* out = cells;
    for (int p = 0; p < numPatterns; ++p) {
        for (int r = 0; r < patternRows[p]; ++r) {
            for (int c = 0; c < numChannels; ++c) {
                for (int cmd = 0; cmd < kCellBytes; ++cmd) {
                    *out++ = static_cast<uint8_t>(m.getPatternRowChannelCommand(p, r, c, cmd));
                }
            }
        }
    }
    return true;
}

void ModuleSnapshot::release() {
    std::free(orderPattern);
    std::free(patternRows);
    std::free(patternCellBase);
    std::free(cells);
    orderPattern = nullptr;
    patternRows = nullptr;
    patternCellBase = nullptr;
    cells = nullptr;
    cellCount = 0;
    numChannels = numOrders = numPatterns = 0;
    durationSeconds = initialBpm = 0.0;
}

int ModuleSnapshot::orderPatternAt(int order) const {
    if (!orderPattern || order < 0 || order >= numOrders) return 0;
    return orderPattern[order];
}

int ModuleSnapshot::rowsOf(int pattern) const {
    if (!patternRows || pattern < 0 || pattern >= numPatterns) return 0;
    return patternRows[pattern];
}

int ModuleSnapshot::cell(int pattern, int row, int channel, int command) const {
    if (!cells || pattern < 0 || pattern >= numPatterns) return 0;
    if (row < 0 || row >= patternRows[pattern] || channel < 0 || channel >= numChannels) return 0;
    if (command < 0 || command >= kCellBytes) return 0;
    const size_t index = static_cast<size_t>(patternCellBase[pattern])
        + static_cast<size_t>(row) * static_cast<size_t>(numChannels) + static_cast<size_t>(channel);
    return cells[index * kCellBytes + static_cast<size_t>(command)];
}

const uint8_t* ModuleSnapshot::patternCells(int pattern) const {
    if (!cells || pattern < 0 || pattern >= numPatterns || patternRows[pattern] <= 0 || numChannels <= 0) {
        return nullptr;
    }
    return cells + static_cast<size_t>(patternCellBase[pattern]) * kCellBytes;
}

// ── NativeEngine: construction / errors ─────────────────────────────

NativeEngine::NativeEngine() {
    // Sinc+LP (8) unless the host overrides it; replayed onto every module.
    const int interp = renderIndex(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH);
    desired_.renderSet[interp] = true;
    desired_.renderValue[interp] = 8;
}

NativeEngine::~NativeEngine() {
    // Only safe once no audio thread calls process() any more (host tests join
    // theirs first; the Emscripten engine is a static that never destructs).
    destroyModule(staged_);
    destroyModule(handoff_.exchange(nullptr, std::memory_order_acq_rel));
    destroyModule(graveyard_.exchange(nullptr, std::memory_order_acq_rel));
    if (!tornDown_ || teardownAck_.load(std::memory_order_acquire)) {
        destroyModule(live_);
        destroyModule(retiring_);
        destroyModule(handedBackLive_);
        destroyModule(handedBackRetiring_);
    }
    staged_ = live_ = retiring_ = handedBackLive_ = handedBackRetiring_ = nullptr;
    snapshot_.release();
    if (knownCtls_) std::free(knownCtls_);
}

void NativeEngine::setErrorf(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    std::vsnprintf(lastError_, sizeof(lastError_), fmt, ap);
    va_end(ap);
    std::fprintf(stderr, "[C++] %s\n", lastError_);
}

void NativeEngine::appendHeapDetail() {
    if (!hooks_.appendHeapDetail) return;
    const size_t len = std::strlen(lastError_);
    if (len + 2 >= sizeof(lastError_)) return;
    hooks_.appendHeapDetail(lastError_ + len, sizeof(lastError_) - len);
}

void NativeEngine::destroyModule(StagedModule* m) {
    if (!m) return;
    delete m;
    ++stats_.modulesDestroyed;
}

// ── Control thread: load / commit ───────────────────────────────────

int NativeEngine::loadModule(uint8_t* data, int length) {
    clearLastError();
    service();

    if (tornDown_) {
        setErrorf("ERR_TORN_DOWN: cleanup_audio() ended this engine instance");
        std::free(data);
        return 0;
    }
    if (!data || length <= 0) {
        setErrorf("ERR_BAD_ARGS: load_module(data=%s, length=%d)", data ? "ptr" : "null", length);
        std::free(data);
        return 0;
    }

    // Release the previous unpublished generation first, so peak residency is
    // the playing module + this one + its file bytes (never a second parse).
    destroyModule(staged_);
    staged_ = nullptr;
    snapshot_.release();

    // Heap probe. libopenmpt's parsed form runs several times the file size and
    // it reports allocation failure by throwing; probing with malloc (which
    // just returns null) turns "this will not fit" into a typed error.
    void* probe = std::malloc(static_cast<size_t>(length) * 4u);
    if (!probe) {
        setErrorf("ERR_OUT_OF_MEMORY: %d-byte module needs ~%zu bytes of heap; "
                  "rebuild with --grow (512mb) for modules this large",
                  length, static_cast<size_t>(length) * 4u);
        appendHeapDetail();
        std::free(data);
        return 0;
    }
    std::free(probe);

    StagedModule* m = new (std::nothrow) StagedModule();
    if (!m) {
        setErrorf("ERR_OUT_OF_MEMORY: could not allocate the module wrapper");
        appendHeapDetail();
        std::free(data);
        return 0;
    }
    // The one and only parse of these bytes. libopenmpt copies what it keeps,
    // so the file buffer is released as soon as it returns.
    const bool parsed = m->module.load(data, static_cast<size_t>(length));
    std::free(data);
    if (!parsed) {
        delete m; // never counted as created
        setErrorf("ERR_UNSUPPORTED_MODULE: libopenmpt could not parse %d bytes", length);
        return 0;
    }
    ++stats_.modulesCreated;

    if (!snapshot_.build(m->module)) {
        destroyModule(m);
        setErrorf("ERR_OUT_OF_MEMORY: no heap left for the %d-byte module's pattern snapshot", length);
        appendHeapDetail();
        return 0;
    }
    if (!knownCtls_) {
        const char* ctls = m->module.supportedCtls();
        if (ctls) {
            const size_t n = std::strlen(ctls);
            knownCtls_ = static_cast<char*>(std::malloc(n + 1));
            if (knownCtls_) std::memcpy(knownCtls_, ctls, n + 1);
        }
    }

    m->generation = ++generation_;
    staged_ = m;
    return 1;
}

int NativeEngine::commitModule() {
    service();
    if (!staged_ || tornDown_) return 0;

    // Everything the host has set so far, applied while this thread still owns
    // the module exclusively — the audio thread starts on a module that already
    // has the right mute mask / render params / ctls / loop / volume.
    applyDesiredState(staged_->module);

    StagedModule* unconsumed = handoff_.exchange(staged_, std::memory_order_acq_rel);
    publishedGeneration_ = staged_->generation;
    staged_ = nullptr;
    // A previous publish the audio thread never picked up (fast reload, or no
    // render quantum ran in between): exchange made it ours again.
    destroyModule(unconsumed);
    return 1;
}

void NativeEngine::applyDesiredState(OpenMPTModule& m) const {
    for (int i = 0; i < kNumRenderParams; ++i) {
        if (desired_.renderSet[i]) m.setRenderParam(i + 1, desired_.renderValue[i]);
    }
    for (int i = 0; i < desired_.numCtls; ++i) {
        m.ctlSetText(desired_.ctls[i].key, desired_.ctls[i].value);
    }
    m.applyMuteMask(desired_.muteMask);
    if (desired_.loopSet) m.setRepeatCount(desired_.loop ? -1 : 0);
    if (desired_.volumeSet) m.setVolume(desired_.volume);
}

void NativeEngine::drainGraveyard() {
    StagedModule* dead = graveyard_.exchange(nullptr, std::memory_order_acq_rel);
    if (dead) {
        ++stats_.swapsObserved;
        destroyModule(dead);
    }
}

void NativeEngine::service() {
    drainGraveyard();
    if (anyPending()) flushPending();
}

// ── Control thread: commands ────────────────────────────────────────

Command NativeEngine::makeSeek(int order, int row, uint32_t generation) const {
    Command c;
    c.type = CommandType::Seek;
    c.a = order;
    c.b = row;
    c.generation = generation;
    return c;
}

Command NativeEngine::makeLoop() const {
    Command c;
    c.type = CommandType::SetLoop;
    c.a = desired_.loop ? 1 : 0;
    return c;
}

Command NativeEngine::makeVolume() const {
    Command c;
    c.type = CommandType::SetVolume;
    c.f = desired_.volume;
    return c;
}

Command NativeEngine::makeMask() const {
    Command c;
    c.type = CommandType::SetMuteMask;
    c.mask = desired_.muteMask;
    return c;
}

Command NativeEngine::makeRender(int index) const {
    Command c;
    c.type = CommandType::SetRenderParam;
    c.a = index + 1;
    c.b = desired_.renderValue[index];
    return c;
}

Command NativeEngine::makeCtl(int index) const {
    Command c;
    c.type = CommandType::CtlSetText;
    std::memcpy(c.key, desired_.ctls[index].key, sizeof(c.key));
    std::memcpy(c.value, desired_.ctls[index].value, sizeof(c.value));
    return c;
}

Command NativeEngine::makePcmRing(uint8_t* ptr, int32_t capacity) const {
    Command c;
    c.type = CommandType::SetPcmRing;
    c.ptr = ptr;
    c.a = capacity;
    return c;
}

bool NativeEngine::anyPending() const {
    if (pending_.seek || pending_.loop || pending_.volume || pending_.mute || pending_.pcmRing) return true;
    if (pending_.ctlMask) return true;
    for (bool r : pending_.render) {
        if (r) return true;
    }
    return false;
}

bool NativeEngine::pushOrDefer(const Command& cmd) {
    if (ring_.push(cmd)) return true;
    // Ring full: remember the newest value of this category and retry later.
    switch (cmd.type) {
        case CommandType::Seek:
            pending_.seek = true;
            pending_.seekOrder = cmd.a;
            pending_.seekRow = cmd.b;
            pending_.seekGeneration = cmd.generation;
            break;
        case CommandType::SetLoop: pending_.loop = true; break;
        case CommandType::SetVolume: pending_.volume = true; break;
        case CommandType::SetMuteMask: pending_.mute = true; break;
        case CommandType::SetRenderParam: pending_.render[renderIndex(cmd.a)] = true; break;
        case CommandType::CtlSetText:
            for (int i = 0; i < desired_.numCtls; ++i) {
                if (std::strncmp(desired_.ctls[i].key, cmd.key, kCtlKeyMax) == 0) pending_.ctlMask |= 1u << i;
            }
            break;
        case CommandType::SetPcmRing:
            pending_.pcmRing = true;
            pending_.pcmRingPtr = cmd.ptr;
            pending_.pcmRingCapacity = cmd.a;
            break;
    }
    return false;
}

void NativeEngine::flushPending() {
    // Values are re-read from desired_ so a retry always carries the newest one.
    auto retry = [this](bool& flag, const Command& cmd) {
        if (flag && ring_.push(cmd)) {
            flag = false;
            ++stats_.pendingFlushes;
        }
    };
    retry(pending_.seek, makeSeek(pending_.seekOrder, pending_.seekRow, pending_.seekGeneration));
    retry(pending_.loop, makeLoop());
    retry(pending_.volume, makeVolume());
    retry(pending_.mute, makeMask());
    for (int i = 0; i < kNumRenderParams; ++i) retry(pending_.render[i], makeRender(i));
    for (int i = 0; i < desired_.numCtls; ++i) {
        if ((pending_.ctlMask & (1u << i)) && ring_.push(makeCtl(i))) {
            pending_.ctlMask &= ~(1u << i);
            ++stats_.pendingFlushes;
        }
    }
    retry(pending_.pcmRing, makePcmRing(pending_.pcmRingPtr, pending_.pcmRingCapacity));
}

void NativeEngine::seek(int order, int row) {
    if (tornDown_) return;
    service();
    // A seek targets the newest module the host knows about: if that one is
    // still staged it applies once the module is live, never to its predecessor.
    const uint32_t target = staged_ ? staged_->generation : publishedGeneration_;
    if (pending_.seek) { // keep only the newest seek
        pending_.seekOrder = order;
        pending_.seekRow = row;
        pending_.seekGeneration = target;
        return;
    }
    pushOrDefer(makeSeek(order, row, target));
}

void NativeEngine::setLoop(bool loop) {
    if (tornDown_) return;
    service();
    desired_.loopSet = true;
    desired_.loop = loop;
    if (!pending_.loop) pushOrDefer(makeLoop());
}

void NativeEngine::setVolume(float volume) {
    if (tornDown_) return;
    service();
    desired_.volumeSet = true;
    desired_.volume = volume < 0.0f ? 0.0f : (volume > 1.0f ? 1.0f : volume);
    if (!pending_.volume) pushOrDefer(makeVolume());
}

void NativeEngine::setChannelMute(int channel, bool muted) {
    if (tornDown_ || channel < 0 || channel >= MAX_VU_CHANNELS) return;
    service();
    if (muted) {
        desired_.muteMask |= (1u << channel);
    } else {
        desired_.muteMask &= ~(1u << channel);
    }
    // The mask travels whole, so the newest command always carries every bit.
    if (!pending_.mute) pushOrDefer(makeMask());
}

void NativeEngine::setRenderParam(int param, int32_t value) {
    if (tornDown_) return;
    service();
    // Validated here, not on the audio thread: libopenmpt throws on an unknown
    // id, and the audio thread should not even log.
    if (!validRenderParam(param)) {
        std::fprintf(stderr, "[C++] ignoring unknown render param %d\n", param);
        return;
    }
    const int i = renderIndex(param);
    desired_.renderSet[i] = true;
    desired_.renderValue[i] = value;
    if (!pending_.render[i]) pushOrDefer(makeRender(i));
}

void NativeEngine::ctlSetText(const char* key, const char* value) {
    if (tornDown_ || !key || !value || !key[0]) return;
    service();
    // Reject rather than truncate: a cut-off key could name a different ctl.
    if (boundedLength(key, kCtlKeyMax) >= static_cast<size_t>(kCtlKeyMax)
        || boundedLength(value, kCtlValueMax) >= static_cast<size_t>(kCtlValueMax)) {
        std::fprintf(stderr, "[C++] ignoring ctl '%.32s…': key or value too long\n", key);
        return;
    }
    if (knownCtls_ && !listContains(knownCtls_, key)) {
        std::fprintf(stderr, "[C++] ignoring unsupported ctl '%s'\n", key);
        return;
    }
    if (!textCtlValueAccepted(key, value)) {
        std::fprintf(stderr, "[C++] ignoring ctl '%s': invalid value '%s'\n", key, value);
        return;
    }
    int index = -1;
    for (int i = 0; i < desired_.numCtls; ++i) {
        if (std::strcmp(desired_.ctls[i].key, key) == 0) index = i;
    }
    if (index < 0) {
        if (desired_.numCtls >= kMaxPersistedCtls) {
            std::fprintf(stderr, "[C++] ctl '%s' not persisted: more than %d distinct ctls\n", key,
                         kMaxPersistedCtls);
            return;
        }
        index = desired_.numCtls++;
        std::snprintf(desired_.ctls[index].key, kCtlKeyMax, "%s", key);
    }
    std::snprintf(desired_.ctls[index].value, kCtlValueMax, "%s", value);
    if (!(pending_.ctlMask & (1u << index))) pushOrDefer(makeCtl(index));
}

void NativeEngine::setPcmRing(uint8_t* buf, int capacityFrames) {
    if (tornDown_ || !buf || capacityFrames <= 0) return;
    service();
    // Nothing reads this buffer yet, so zeroing it here cannot race.
    auto* header = reinterpret_cast<int32_t*>(buf);
    __atomic_store_n(header, 0, __ATOMIC_RELAXED);     // writeHead
    __atomic_store_n(header + 1, 0, __ATOMIC_RELAXED); // readHead
    std::memset(buf + 8, 0, static_cast<size_t>(capacityFrames) * 2 * sizeof(float));
    mainPcmHeader_ = header;
    if (pending_.pcmRing) {
        pending_.pcmRingPtr = buf;
        pending_.pcmRingCapacity = capacityFrames;
        return;
    }
    pushOrDefer(makePcmRing(buf, capacityFrames));
}

int NativeEngine::pcmRingWriteHead() const {
    if (!mainPcmHeader_) return 0;
    return __atomic_load_n(mainPcmHeader_, __ATOMIC_ACQUIRE);
}

// ── Control thread: position ────────────────────────────────────────

const PositionInfo* NativeEngine::pollPosition() {
    service();
    if (positionReady_.exchange(0, std::memory_order_acq_rel)) return positionStorage();
    return nullptr;
}

bool NativeEngine::readPosition(PositionInfo& out) const {
    uint32_t words[kPositionWords];
    for (int attempt = 0; attempt < 16; ++attempt) {
        const uint32_t before = positionSeq_.load(std::memory_order_acquire);
        if (before & 1u) continue;
        for (size_t i = 0; i < kPositionWords; ++i) {
            words[i] = __atomic_load_n(&positionWords_[i], __ATOMIC_ACQUIRE);
        }
        if (positionSeq_.load(std::memory_order_acquire) == before) {
            std::memcpy(&out, words, sizeof(out));
            return true;
        }
    }
    return false;
}

// ── Control thread: teardown ────────────────────────────────────────

bool NativeEngine::teardown(double timeoutMs) {
    if (tornDown_) return teardownAck_.load(std::memory_order_acquire) != 0;
    tornDown_ = true;
    teardown_.store(1, std::memory_order_release);

    bool acked = !audioThreadStarted_;
    if (acked) {
        // No audio thread was ever started: this thread is the only one, so the
        // "audio" side's modules (a single-threaded host drives process() itself)
        // are ours to free too.
        handedBackLive_ = live_;
        handedBackRetiring_ = retiring_;
        live_ = retiring_ = nullptr;
        audioAcked_ = true;
        teardownAck_.store(1, std::memory_order_release);
    } else {
        const double start = hooks_.nowMs ? hooks_.nowMs() : 0.0;
        while (!teardownAck_.load(std::memory_order_acquire)) {
            if (!hooks_.nowMs || hooks_.nowMs() - start > timeoutMs) break;
            if (hooks_.relax) hooks_.relax();
        }
        acked = teardownAck_.load(std::memory_order_acquire) != 0;
    }

    // Exchanges make whatever is in the slots ours, ack or not.
    destroyModule(staged_);
    staged_ = nullptr;
    destroyModule(handoff_.exchange(nullptr, std::memory_order_acq_rel));
    destroyModule(graveyard_.exchange(nullptr, std::memory_order_acq_rel));
    if (acked) {
        // The audio thread handed these back before acking and never looks again.
        destroyModule(handedBackLive_);
        destroyModule(handedBackRetiring_);
        handedBackLive_ = handedBackRetiring_ = nullptr;
    } else {
        // It may be mid-quantum on them: leaking is safe, freeing is not.
        std::fprintf(stderr, "[C++] teardown: audio thread did not ack within %.0f ms; "
                             "leaving its module allocated\n", timeoutMs);
        stats_.leakedOnTeardown = stats_.modulesCreated - stats_.modulesDestroyed;
    }
    snapshot_.release();
    mainPcmHeader_ = nullptr;
    desired_ = DesiredState();
    pending_ = Pending();
    clearLastError();
    return acked;
}

// ── Audio thread ────────────────────────────────────────────────────

void NativeEngine::resetClock() {
    // Pairs with TS createNativeClockAnchor(..., frameSecondsAtAnchor=0): the
    // frame clock restarts at every load and seek.
    framesRendered_ = 0.0;
    lastReportedRow_ = -1;
    timeSinceLastReport_ = 0.0;
    rowStartRow_ = -1;
    rowStartPosSec_ = 0.0;
}

void NativeEngine::applyCommand(const Command& cmd) {
    switch (cmd.type) {
        case CommandType::Seek:
            if (cmd.generation == 0) return; // issued before any load
            if (live_ && cmd.generation < live_->generation) return; // aimed at a retired module
            if (!live_ || cmd.generation > live_->generation) {
                // Its module is staged / published but not swapped in yet: keep
                // the newest such seek until that module goes live.
                deferredSeek_ = cmd;
                deferredSeekValid_ = true;
                return;
            }
            live_->module.seekOrderRow(cmd.a, cmd.b);
            resetClock();
            return;
        case CommandType::SetPcmRing:
            pcmHeader_ = reinterpret_cast<int32_t*>(cmd.ptr);
            pcmSamples_ = reinterpret_cast<float*>(cmd.ptr + 8);
            pcmCapacity_ = cmd.a;
            return;
        default:
            break;
    }
    if (!live_) return; // the next module gets these through applyDesiredState()
    OpenMPTModule& m = live_->module;
    switch (cmd.type) {
        case CommandType::SetLoop: m.setRepeatCount(cmd.a ? -1 : 0); break;
        case CommandType::SetVolume: m.setVolume(cmd.f); break;
        case CommandType::SetMuteMask: m.applyMuteMask(cmd.mask); break;
        case CommandType::SetRenderParam: m.setRenderParam(cmd.a, cmd.b); break;
        case CommandType::CtlSetText: m.ctlSetText(cmd.key, cmd.value); break;
        default: break;
    }
}

void NativeEngine::publishPosition(const PositionInfo& info) {
    uint32_t words[kPositionWords];
    std::memcpy(words, &info, sizeof(info));
    positionSeq_.fetch_add(1, std::memory_order_acq_rel); // odd: write in progress
    for (size_t i = 0; i < kPositionWords; ++i) {
        __atomic_store_n(&positionWords_[i], words[i], __ATOMIC_RELEASE);
    }
    positionSeq_.fetch_add(1, std::memory_order_release); // even: stable again
    positionReady_.store(1, std::memory_order_release);
}

void NativeEngine::publishEnded() {
    // Only currentRow (-1 = ended sentinel), the frame clock and the rate change;
    // the rest of the last report stays as it was.
    PositionInfo info;
    std::memset(&info, 0, sizeof(info));
    readPosition(info); // this thread is the only writer, so the read is always stable
    info.currentRow = -1;
    info.audioFramesRendered = framesRendered_;
    info.sampleRate = renderSampleRate_;
    publishPosition(info);
}

void NativeEngine::writePcmRing(const float* interleaved, int frames) {
    if (!pcmHeader_ || !pcmSamples_ || pcmCapacity_ <= 0) return;
    // A lossy tap by design: the JS reader keeps its own cursor and resyncs
    // when lapped (OpenMPTWorkletEngine.copyPcmChunk), so there is no
    // back-pressure and nothing to report from here.
    const int32_t head = __atomic_load_n(pcmHeader_, __ATOMIC_ACQUIRE);
    for (int i = 0; i < frames; ++i) {
        const int32_t pos = (head + i) % pcmCapacity_;
        pcmSamples_[pos * 2] = interleaved[i * 2];
        pcmSamples_[pos * 2 + 1] = interleaved[i * 2 + 1];
    }
    // Release: the samples are visible before the head that covers them.
    __atomic_store_n(pcmHeader_, (head + frames) % pcmCapacity_, __ATOMIC_RELEASE);
}

void NativeEngine::process(float* left, float* right, int frames) {
    if (frames > kMaxQuantum) frames = kMaxQuantum;
    if (frames < 0) frames = 0;
    const size_t bytes = sizeof(float) * static_cast<size_t>(frames);

    // ── Teardown: give every module back, ack once, then never look again ──
    if (teardown_.load(std::memory_order_acquire)) {
        if (!audioAcked_) {
            handedBackLive_ = live_;
            handedBackRetiring_ = retiring_;
            live_ = retiring_ = nullptr;
            audioAcked_ = true;
            teardownAck_.store(1, std::memory_order_release);
        }
        std::memset(left, 0, bytes);
        std::memset(right, 0, bytes);
        return;
    }

    // ── 1. Retire / swap (a quantum boundary) ──
    if (retiring_ && graveyard_.load(std::memory_order_acquire) == nullptr) {
        graveyard_.store(retiring_, std::memory_order_release);
        retiring_ = nullptr;
    }
    if (!retiring_) {
        StagedModule* next = handoff_.exchange(nullptr, std::memory_order_acq_rel);
        if (next) {
            retiring_ = live_;
            live_ = next;
            resetClock();
            if (retiring_ && graveyard_.load(std::memory_order_acquire) == nullptr) {
                graveyard_.store(retiring_, std::memory_order_release);
                retiring_ = nullptr;
            }
            if (deferredSeekValid_ && deferredSeek_.generation == live_->generation) {
                live_->module.seekOrderRow(deferredSeek_.a, deferredSeek_.b);
            }
            deferredSeekValid_ = false;
        }
    }

    // ── 2. Commands ──
    ring_.drain([this](const Command& cmd) { applyCommand(cmd); });

    // ── 3. Render ──
    if (paused_.load(std::memory_order_acquire) || !live_ || !live_->module.isLoaded()) {
        std::memset(left, 0, bytes);
        std::memset(right, 0, bytes);
        return;
    }
    OpenMPTModule& m = live_->module;
    const int sr = renderSampleRate_ > 0 ? renderSampleRate_ : 48000;

    // Position/VU at ~60 Hz or on a row change. Never GetLength/time-at-row here.
    {
        const int currentRow = m.getCurrentRow();
        if (currentRow != rowStartRow_) {
            // Seen at quantum resolution, so this is when the row started (±1 quantum).
            rowStartRow_ = currentRow;
            rowStartPosSec_ = m.getPositionSeconds();
        }
        if (currentRow != lastReportedRow_ || timeSinceLastReport_ >= (1.0 / 60.0)) {
            PositionInfo info;
            m.fillPositionInfo(info);
            // Fractional row, the same estimate the JS processor reports: time into
            // the row × rows/s from the current BPM (4 rows per beat), kept < 1 row.
            // An integer row made every sample look ~half a row late to the
            // main-thread prediction.
            const double bpm = info.bpm > 1.0 ? info.bpm : 1.0;
            const double rowsPerSec = bpm / 60.0 * 4.0 > 0.25 ? bpm / 60.0 * 4.0 : 0.25;
            double frac = (info.positionMs / 1000.0 - rowStartPosSec_) * rowsPerSec;
            if (!(frac > 0.0)) frac = 0.0;
            if (frac > 0.999) frac = 0.999;
            info.rowFraction = static_cast<float>(currentRow + frac);
            info.audioFramesRendered = framesRendered_;
            info.sampleRate = sr;
            publishPosition(info);
            lastReportedRow_ = currentRow;
            timeSinceLastReport_ = 0.0;
        }
        timeSinceLastReport_ += static_cast<double>(frames) / static_cast<double>(sr);
    }

    float interleaved[kMaxQuantum * 2];
    const int rendered = m.readInterleavedStereo(sr, frames, interleaved);
    if (rendered <= 0) {
        std::memset(left, 0, bytes);
        std::memset(right, 0, bytes);
        publishEnded();
        return;
    }
    framesRendered_ += static_cast<double>(rendered);

    for (int i = 0; i < rendered; ++i) {
        left[i] = interleaved[i * 2];
        right[i] = interleaved[i * 2 + 1];
    }
    if (rendered < frames) {
        const size_t rest = sizeof(float) * static_cast<size_t>(frames - rendered);
        std::memset(left + rendered, 0, rest);
        std::memset(right + rendered, 0, rest);
    }
    writePcmRing(interleaved, rendered);
}

} // namespace xasm
