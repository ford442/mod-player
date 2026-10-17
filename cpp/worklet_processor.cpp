/**
 * worklet_processor.cpp – Emscripten AudioWorklet glue for the native engine.
 *
 * Compiled with: -sAUDIO_WORKLET=1 -sWASM_WORKERS=1
 *
 * Everything that has to be thread-safe lives in cpp/native_engine.{h,cpp}
 * (one NativeEngine, `g_engine`), which is platform-independent so the host
 * TSan / ASan harness in cpp/host/ runs the same code from two std::threads.
 * This file only adds what needs Emscripten: the KEEPALIVE exports the
 * TypeScript engine calls, the AudioWorklet thread + node, and EM_ASM.
 *
 * Threads (#491):
 *   Main thread    – every export below. It parses each module ONCE
 *                    (load_module), publishes it (commit_module), sends
 *                    controls through a lock-free command ring, frees retired
 *                    modules, and answers pattern queries from a snapshot.
 *   Worklet thread – audio_process_cb() → g_engine.process(): swaps the
 *                    published module in at a quantum boundary, drains the
 *                    ring, renders. It never parses, frees or allocates.
 */

#include <emscripten/emscripten.h>
#include <emscripten/webaudio.h>
#include <emscripten/heap.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <malloc.h>

#include "native_engine.h"
#include "openmpt_wrapper.h"

// AudioWorklet render quantum. emscripten/webaudio.h hardcodes AudioSampleFrame.data
// to numberOfChannels*128 floats today — Chrome's proposed configurable render
// quantum (renderSizeHint) would need this raised (and a real frame-count field
// from Emscripten) before anything above 128 is safe; every fixed-size scratch
// buffer is sized from this one constant (and xasm::kMaxQuantum) so that's a
// one-line change instead of an audit.
static constexpr int MAX_QUANTUM = 128;
static_assert(MAX_QUANTUM <= xasm::kMaxQuantum, "the engine's scratch buffers must hold a quantum");

// The one engine. Main-thread and audio-thread state are separated inside it.
static xasm::NativeEngine g_engine;

// Audio context and node handles (main thread only: the worklet-created
// callback below also runs on the main thread).
static EMSCRIPTEN_WEBAUDIO_T g_audioCtx = 0;
static EMSCRIPTEN_AUDIO_WORKLET_NODE_T g_workletNode = 0;
// The worklet thread is started at most once per engine: a second audio thread
// calling process() would break the single-consumer command ring.
static int g_audioStartRequested = 0;

// Flag: 1 = caller owns the AudioContext (skip auto-connect to destination)
static int g_externalContext = 0;

// AudioWorklet thread stack (required by emscripten_start_wasm_audio_worklet_thread_async)
static uint8_t* g_workletStack = nullptr;
constexpr uint32_t WORKLET_STACK_SIZE = 128 * 1024;

// How long cleanup_audio() waits for the audio thread to hand its module back.
static constexpr double TEARDOWN_ACK_TIMEOUT_MS = 100.0;

// Main-thread TLS under -sWASM_WORKERS is repaired by cpp/wasm_workers_tls.cpp (#491).

static uint8_t* ensureWorkletStack() {
    if (!g_workletStack) {
        g_workletStack = static_cast<uint8_t*>(memalign(16, WORKLET_STACK_SIZE));
    }
    return g_workletStack;
}

// ── Engine hooks (Emscripten side) ──────────────────────────────────

static double hook_now_ms() { return emscripten_get_now(); }

/** Live allocator numbers for ERR_OUT_OF_MEMORY strings (best effort). */
static void hook_append_heap_detail(char* buf, size_t capacity) {
    const size_t heap = emscripten_get_heap_size();
    const struct mallinfo mi = mallinfo();
    std::snprintf(buf, capacity, " [heap=%zu arena=%lu uordblks=%lu fordblks=%lu]",
        heap,
        static_cast<unsigned long>(mi.arena),
        static_cast<unsigned long>(mi.uordblks),
        static_cast<unsigned long>(mi.fordblks));
}

static void install_hooks() {
    static bool installed = false;
    if (installed) return;
    xasm::EngineHooks hooks;
    hooks.nowMs = hook_now_ms;
    hooks.appendHeapDetail = hook_append_heap_detail;
    g_engine.setHooks(hooks);
    installed = true;
}

// ── AudioWorklet process callback (runs on worklet thread) ──────────

EM_BOOL audio_process_cb(
    int numInputs,  const AudioSampleFrame* inputs,
    int numOutputs, AudioSampleFrame* outputs,
    int numParams,  const AudioParamFrame* params,
    void* userData)
{
    (void)numInputs; (void)inputs; (void)numParams; (void)params; (void)userData;
    if (numOutputs < 1 || outputs[0].numberOfChannels < 2) {
        return EM_TRUE; // Keep processor alive
    }
    AudioSampleFrame& out = outputs[0];
    // emscripten/webaudio.h hardcodes AudioSampleFrame.data to numberOfChannels*128
    // floats (no runtime frame-count field exists to assert against today) — see
    // the MAX_QUANTUM comment above. Planar: [L0..L127, R0..R127, …].
    static_assert(MAX_QUANTUM == 128, "AudioSampleFrame.data is fixed at numberOfChannels*128 floats");
    const int frames = MAX_QUANTUM;
    g_engine.process(out.data, out.data + frames, frames);
    // Any channels past stereo stay silent.
    for (int ch = 2; ch < out.numberOfChannels; ++ch) {
        std::memset(out.data + ch * frames, 0, sizeof(float) * frames);
    }
    return EM_TRUE;
}

// ── Worklet thread / processor startup (both callbacks run on the main thread) ──

static const char* const kProcessorName = "openmpt-native-processor";

static void worklet_processor_created(EMSCRIPTEN_WEBAUDIO_T audioCtx, EM_BOOL success, void* userData) {
    (void)userData;
    if (!success) {
        std::fprintf(stderr, "[worklet] Failed to register the %s AudioWorkletProcessor\n", kProcessorName);
        return;
    }

    int outputChannelCounts[] = { 2 }; // Stereo output

    EmscriptenAudioWorkletNodeCreateOptions opts;
    std::memset(&opts, 0, sizeof(opts));
    opts.numberOfInputs  = 0;
    opts.numberOfOutputs = 1;
    opts.outputChannelCounts = outputChannelCounts;

    g_workletNode = emscripten_create_wasm_audio_worklet_node(
        audioCtx,
        kProcessorName,
        &opts,
        audio_process_cb,
        nullptr  // userData
    );

    // Connect worklet node to destination (standalone mode only)
    // In external-context mode the caller (TypeScript) wires the node manually.
    if (!g_externalContext) {
        EM_ASM({
            var ctx = emscriptenGetAudioObject($0);
            var node = emscriptenGetAudioObject($1);
            if (ctx && node) {
                node.connect(ctx.destination);
                console.log('[C++] AudioWorkletNode connected to destination');
            }
        }, audioCtx, g_workletNode);
    } else {
        std::printf("[C++] External-context mode: AudioWorkletNode NOT auto-connected "
                    "(caller responsible for graph wiring)\n");
    }

    std::printf("[C++] Worklet thread initialized, node created\n");
}

static void worklet_thread_initialized(EMSCRIPTEN_WEBAUDIO_T audioCtx, EM_BOOL success, void* userData) {
    (void)userData;
    if (!success) {
        std::fprintf(stderr, "[worklet] Failed to initialize audio worklet thread\n");
        return;
    }
    // The node's processor name has to be registered in the AudioWorkletGlobalScope
    // first. Without this step `new AudioWorkletNode(ctx, name)` throws
    // ("node name … is not defined"), Emscripten reports the whole thread start as
    // failed, and the host falls back to the JS engine after its 8 s wait — which
    // is what every native start did before #491.
    WebAudioWorkletProcessorCreateOptions opts;
    std::memset(&opts, 0, sizeof(opts));
    opts.name = kProcessorName;
    opts.numAudioParams = 0;
    opts.audioParamDescriptors = nullptr;
    emscripten_create_wasm_audio_worklet_processor_async(audioCtx, &opts, worklet_processor_created, nullptr);
}

/** Start the worklet thread once; later calls are no-ops that report success. */
static int start_worklet_thread() {
    if (g_audioStartRequested) return 1;
    uint8_t* stack = ensureWorkletStack();
    if (!stack) {
        std::fprintf(stderr, "[C++] Failed to allocate AudioWorklet stack\n");
        return 0;
    }
    g_audioStartRequested = 1;
    g_engine.markAudioThreadStarted();
    emscripten_start_wasm_audio_worklet_thread_async(
        g_audioCtx,
        stack,
        WORKLET_STACK_SIZE,
        worklet_thread_initialized,
        nullptr
    );
    return 1;
}

// ── Exported C functions (called from TypeScript via ccall/cwrap) ────

extern "C" {

/**
 * Initialize the audio system standalone: creates its OWN AudioContext and
 * starts the AudioWorklet thread.
 *
 * **Headless / unit-test harness only.** The player has exactly one
 * AudioContext per page session, built by `utils/audioContextFactory.ts`, and
 * production always attaches via `init_audio_with_context()` below. A second
 * context silently blocks MediaRecorder capture and puts the native frame
 * clock in a different domain from the main graph, so nothing in the app may
 * call this. Kept as a KEEPALIVE export (and in
 * `scripts/verify-native-exports.mjs`) so a headless harness can render
 * without a JS-side graph.
 *
 * The context it builds mirrors `utils/audioContextFactory.ts` exactly —
 * `latencyHint: 'playback'` at a locked 48000 Hz — so a headless bench run is
 * comparable with the in-app engine instead of measuring a different mixer.
 * `sampleRate` is honoured only as an explicit override; 0 means "use the lock".
 *
 * @param sampleRate  Sample rate override (0 = the locked 48000)
 * @return 1 on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int init_audio(int sampleRate) {
    // Must stay in sync with PLAYER_SAMPLE_RATE in utils/audioContextFactory.ts.
    constexpr int LOCKED_SAMPLE_RATE = 48000;
    install_hooks();
    if (g_engine.tornDown()) {
        std::fprintf(stderr, "[C++] init_audio: engine was cleaned up; create a new instance\n");
        return 0;
    }
    if (g_audioStartRequested) return 1;

    EmscriptenWebAudioCreateAttributes attrs;
    std::memset(&attrs, 0, sizeof(attrs));
    attrs.latencyHint   = "playback";
    attrs.sampleRate    = sampleRate > 0 ? sampleRate : LOCKED_SAMPLE_RATE;
    // The engine renders for the rate this context actually opened at, not an
    // assumed constant (see init_audio_with_context below). Set before the
    // worklet thread starts, which publishes it to that thread.
    g_engine.setRenderSampleRate(attrs.sampleRate);

    g_audioCtx = emscripten_create_audio_context(&attrs);
    if (!g_audioCtx) {
        std::fprintf(stderr, "[C++] Failed to create AudioContext\n");
        return 0;
    }
    if (!start_worklet_thread()) return 0;

    std::printf("[C++] Audio context created (handle=%d)\n", g_audioCtx);
    return 1;
}

/**
 * Configure a ring buffer in WASM shared memory for PCM capture (pcmBus /
 * projectM taps).
 *
 * The buffer must have been allocated on the WASM heap (via _malloc from JS).
 * Layout at buf:
 *   [0..3]  writeHead (Int32) – next frame index to write; updated atomically
 *   [4..7]  readHead  (Int32) – reserved for a JS consumer
 *   [8..]   float32 stereo samples, interleaved L/R, capacity = capacityFrames
 *
 * The buffer is zeroed here and handed to the audio thread as a ring command,
 * so the audio thread starts writing only once it owns the new configuration.
 *
 * @param buf            Pointer to the WASM heap ring buffer (8-byte header + samples)
 * @param capacityFrames Stereo frame capacity of the sample area
 */
EMSCRIPTEN_KEEPALIVE
void set_ring_buffer(uint8_t* buf, int capacityFrames) {
    g_engine.setPcmRing(buf, capacityFrames);
    std::printf("[C++] Ring buffer configured: ptr=%p, capacity=%d frames\n",
                static_cast<void*>(buf), capacityFrames);
}

/**
 * Returns the current ring buffer write-head (in stereo frames).
 * Useful for the JS side to verify data is flowing.
 */
EMSCRIPTEN_KEEPALIVE
int get_ring_write_head() {
    return g_engine.pcmRingWriteHead();
}

/**
 * Initialise audio using an externally-provided AudioContext handle.
 *
 * This is the only production path. Unlike the headless-only init_audio(),
 * it does NOT create a new AudioContext.
 * Instead it accepts a handle obtained by the caller via
 * emscriptenRegisterAudioObject(existingCtx) and starts the worklet thread
 * on that context.  The AudioWorkletNode is NOT auto-connected to destination;
 * the caller is responsible for connecting it into their audio graph.
 * Idempotent: the worklet thread is started once per engine.
 *
 * @param ctxHandle    Emscripten audio context handle
 * @param sampleRateHz The context's real `AudioContext.sampleRate`. The engine
 *                     renders for whatever rate this is — it used to hardcode
 *                     48000, so when utils/audioContextFactory.ts's own 48000
 *                     request was rejected and it fell back to the device rate (rare —
 *                     some Firefox / older Safari), this engine kept rendering as if the
 *                     context were still 48 kHz: about a 9% pitch/tempo error against
 *                     whatever the device actually ran at. libopenmpt resamples to
 *                     whatever rate you ask for, so there is no reason to hardcode one;
 *                     pass 0 to keep the previous default (48000) for old callers.
 * @return 1 on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int init_audio_with_context(int ctxHandle, int sampleRateHz) {
    install_hooks();
    if (!ctxHandle) {
        std::fprintf(stderr, "[C++] init_audio_with_context: invalid context handle\n");
        return 0;
    }
    if (g_engine.tornDown()) {
        std::fprintf(stderr, "[C++] init_audio_with_context: engine was cleaned up; create a new instance\n");
        return 0;
    }
    if (g_audioStartRequested) return 1;
    g_engine.setRenderSampleRate(sampleRateHz > 0 ? sampleRateHz : 48000);
    g_audioCtx        = ctxHandle;
    g_externalContext = 1; // skip auto-connect in worklet_thread_initialized

    if (!start_worklet_thread()) return 0;

    std::printf("[C++] Audio initialised with external context (handle=%d, sampleRate=%d)\n",
                ctxHandle, g_engine.renderSampleRate());
    return 1;
}

/**
 * Poll the last typed error (or NULL when there is none).
 *
 * Every code is stable and safe to branch on from TypeScript:
 *   ERR_BAD_ARGS           – caller passed a null/empty buffer
 *   ERR_OUT_OF_MEMORY      – not enough heap for this module (use the --grow build)
 *   ERR_UNSUPPORTED_MODULE – libopenmpt could not parse the bytes
 *   ERR_TORN_DOWN          – cleanup_audio() already ended this engine instance
 *
 * (ERR_AUDIO_LOAD is gone: the audio thread no longer parses, so it cannot
 * fail a load.)
 *
 * The returned pointer is a static buffer; copy it (UTF8ToString) before the
 * next native call.
 */
EMSCRIPTEN_KEEPALIVE
const char* get_last_error() {
    return g_engine.lastError();
}

/** Drop any pending error string. */
EMSCRIPTEN_KEEPALIVE
void clear_last_error() {
    g_engine.clearLastError();
}

/**
 * Parse a module ONCE, on the main thread, and stage it for playback.
 *
 * **Ownership:** `data` MUST come from `_malloc` and is adopted by C++ — the
 * caller never frees it, on success or on failure. It is freed as soon as
 * libopenmpt has parsed it.
 *
 * The parsed module stays main-thread-owned (and a read-only snapshot of its
 * patterns / orders / duration answers the get_* queries) until
 * `commit_module()` publishes it to the audio thread; the audio thread swaps
 * it in at a quantum boundary and hands the module it replaced back to be
 * freed here. The audio thread never parses.
 *
 * @param data    Module file data, allocated with _malloc (ownership transferred)
 * @param length  Size in bytes
 * @return 1 on success, 0 on failure (see get_last_error())
 */
EMSCRIPTEN_KEEPALIVE
int load_module(uint8_t* data, int length) {
    install_hooks();
    return g_engine.loadModule(data, length);
}

/**
 * Publish the staged module to the audio thread (one atomic exchange). The
 * module gets the current mute mask, render params, ctls, loop and volume
 * applied first, while this thread still owns it.
 *
 * Idempotent and safe to call when nothing is staged. `resume_audio()` calls
 * it for you so a host that never reads patterns still plays. Pattern queries
 * keep answering from the snapshot after the commit.
 *
 * @return 1 if a staged module was committed, 0 if there was nothing to do.
 */
EMSCRIPTEN_KEEPALIVE
int commit_module() {
    return g_engine.commitModule();
}

/**
 * Resume render (clears pause flag). Also resumes a suspended AudioContext
 * after a user gesture — never used as the pause mechanism.
 */
EMSCRIPTEN_KEEPALIVE
void resume_audio() {
    // Safety net for hosts that load and play without reading pattern data.
    commit_module();
    g_engine.setPaused(false);
    if (g_audioCtx) {
        EM_ASM({
            var ctx = emscriptenGetAudioObject($0);
            if (ctx && ctx.state === 'suspended') ctx.resume();
        }, g_audioCtx);
    }
}

/**
 * Pause render by silencing the worklet. Does NOT AudioContext.suspend()
 * (that would freeze a shared main-thread graph — #329 / #330). The audio
 * thread sees the engine's paused flag and outputs silence.
 */
EMSCRIPTEN_KEEPALIVE
void suspend_audio() {
    g_engine.setPaused(true);
}

/**
 * Seek to a specific order + row: one ring command carrying both halves, so
 * the audio thread can never see an order without its row. It targets the
 * newest loaded module (a seek sent before a reload never lands on the next
 * song).
 */
EMSCRIPTEN_KEEPALIVE
void seek_order_row(int order, int row) {
    g_engine.seek(order, row);
}

/**
 * Set loop mode: 1 = loop, 0 = play once.
 */
EMSCRIPTEN_KEEPALIVE
void set_loop(int loop) {
    g_engine.setLoop(loop != 0);
}

/**
 * Set the C++ render gain (0.0 – 1.0). The app keeps it at 1: the master
 * GainNode owns volume (#489).
 */
EMSCRIPTEN_KEEPALIVE
void set_volume(float vol) {
    g_engine.setVolume(vol);
}

/**
 * Mute/unmute a tracker channel (interactive ext).
 *
 * The engine keeps the full 32-bit mask (the single source of truth), sends it
 * to the audio thread whole as a ring command, and applies it to every newly
 * loaded module before that module is published.
 */
EMSCRIPTEN_KEEPALIVE
void set_channel_mute(int channel, int muted) {
    g_engine.setChannelMute(channel, muted != 0);
}

/**
 * Set a libopenmpt render param (e.g. OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH).
 * Validated here, sent as one ring command (param and value together), and
 * persisted so it survives the next load.
 */
EMSCRIPTEN_KEEPALIVE
void set_render_param(int param, int32_t value) {
    g_engine.setRenderParam(param, value);
}

/**
 * Post-load ctl_set_text. Key and value are copied into a ring slot (never
 * shared buffers), validated here, and persisted for later loads.
 */
EMSCRIPTEN_KEEPALIVE
void ctl_set_text(const char* key, const char* value) {
    g_engine.ctlSetText(key, value);
}

/**
 * Poll position info from the worklet thread. Also frees modules the audio
 * thread has retired and retries ring-full commands.
 * @return Pointer to the PositionInfo bytes, or NULL if no new data. Read it
 *         through the get_position_seq() seqlock.
 */
EMSCRIPTEN_KEEPALIVE
PositionInfo* poll_position() {
    return const_cast<PositionInfo*>(g_engine.pollPosition());
}

/**
 * Seqlock counter guarding the PositionInfo bytes. The caller reads this
 * before and after decoding the struct's raw bytes out of WASM memory; odd,
 * or a value that changed across the read, means a write raced the read and
 * the decode must be retried.
 */
EMSCRIPTEN_KEEPALIVE
uint32_t get_position_seq() {
    return g_engine.positionSeq();
}

/**
 * Get the AudioContext handle for external audio graph wiring.
 */
EMSCRIPTEN_KEEPALIVE
EMSCRIPTEN_WEBAUDIO_T get_audio_context() {
    return g_audioCtx;
}

/**
 * Get the AudioWorkletNode handle for external audio graph wiring.
 */
EMSCRIPTEN_KEEPALIVE
EMSCRIPTEN_AUDIO_WORKLET_NODE_T get_worklet_node() {
    return g_workletNode;
}

/**
 * Clean up and destroy all audio resources. Terminal for this instance.
 *
 * Never frees a module the audio thread might be rendering: the engine raises
 * a teardown flag, the audio thread hands its modules back and acks at its
 * next quantum, and only then are they freed. Without an ack (context already
 * suspended / closed) the live module is left allocated rather than freed out
 * from under a possibly running render.
 */
EMSCRIPTEN_KEEPALIVE
void cleanup_audio() {
    install_hooks();
    g_engine.teardown(TEARDOWN_ACK_TIMEOUT_MS);
    // Note: AudioContext destruction is handled by the browser
    // when the page unloads or the context is garbage collected.
    g_audioCtx = 0;
    g_workletNode = 0;
}

// ── Pattern data query functions (called from TypeScript) ────────────
// Answered from the read-only snapshot load_module() takes on the main
// thread — never from the module the audio thread is rendering.

/**
 * Get the number of channels in the currently loaded module.
 */
EMSCRIPTEN_KEEPALIVE
int get_num_channels() {
    return g_engine.snapshot().numChannels;
}

/**
 * Get the number of orders (positions) in the currently loaded module.
 */
EMSCRIPTEN_KEEPALIVE
int get_num_orders() {
    return g_engine.snapshot().numOrders;
}

EMSCRIPTEN_KEEPALIVE
int get_num_patterns() {
    return g_engine.snapshot().numPatterns;
}

/** Song duration, computed on the main thread at load (GetLength never runs on the audio thread). */
EMSCRIPTEN_KEEPALIVE
double get_duration_seconds() {
    return g_engine.snapshot().durationSeconds;
}

/** Initial BPM estimate, read at load before the module is published. */
EMSCRIPTEN_KEEPALIVE
double get_initial_bpm() {
    return g_engine.snapshot().initialBpm;
}

/**
 * Get the pattern index for a given order position.
 */
EMSCRIPTEN_KEEPALIVE
int get_order_pattern(int order) {
    return g_engine.snapshot().orderPatternAt(order);
}

/**
 * Get the number of rows in a given pattern.
 */
EMSCRIPTEN_KEEPALIVE
int get_pattern_num_rows(int pattern) {
    return g_engine.snapshot().rowsOf(pattern);
}

/**
 * Read a per-cell command value for a given pattern/row/channel.
 * `command` is libopenmpt's OPENMPT_MODULE_COMMAND_* index (0..5).
 */
EMSCRIPTEN_KEEPALIVE
int get_pattern_row_channel_command(int pattern, int row, int channel, int command) {
    return g_engine.snapshot().cell(pattern, row, channel, command);
}

/**
 * Bulk pattern read: pointer to the pattern's cells in the snapshot, laid out
 * [row][channel][6] bytes (OPENMPT_MODULE_COMMAND_* order), or NULL. Valid
 * until the next load_module() / cleanup_audio(). Lets the host read a whole
 * pattern out of HEAPU8 instead of making six export calls per cell.
 */
EMSCRIPTEN_KEEPALIVE
const uint8_t* get_pattern_cells(int pattern) {
    return g_engine.snapshot().patternCells(pattern);
}

} // extern "C"
