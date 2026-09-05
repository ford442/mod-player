/**
 * worklet_processor.cpp – Emscripten AudioWorklet processor for libopenmpt.
 *
 * Compiled with: -sAUDIO_WORKLET=1 -sWASM_WORKERS=1
 *
 * Architecture:
 *   Main thread: JS calls exported C functions (load_module, play, pause, etc.)
 *   Worklet thread: audio_process_cb() renders audio via libopenmpt and posts
 *                   position/VU data back through a shared-memory ring buffer.
 *
 * Communication (Main → Worklet): shared atomic flags + shared memory buffers
 * Communication (Worklet → Main): emscripten_audio_worklet_post_message() or
 *                                  a polled shared-memory PositionInfo struct.
 */

#include <emscripten/emscripten.h>
#include <emscripten/webaudio.h>
#include <emscripten/atomic.h>
#include <emscripten/heap.h>

#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <malloc.h>
#include <atomic>

#include "openmpt_wrapper.h"

#include <cstdint>

// ── Shared state ────────────────────────────────────────────────────
//
// Accessed from BOTH main thread and audio worklet thread.
// Atomics or single-writer patterns are used to avoid races.

// The render instance lives on the worklet thread (created there after
// receiving module data from main thread via shared buffer).
static OpenMPTModule g_module;
// Main-thread copy for pattern/metadata reads (does not wait for the worklet).
static OpenMPTModule g_metaModule;

// Shared buffer for transferring module file data from main → worklet
static uint8_t*        g_moduleData     = nullptr;
static size_t          g_moduleDataSize = 0;

// Atomic flags for cross-thread commands
static std::atomic<int> g_cmdLoad{0};    // 1 = new module data ready
static std::atomic<int> g_cmdSeekOrder{-1};
static std::atomic<int> g_cmdSeekRow{-1};
static std::atomic<int> g_cmdSetLoop{-1}; // -1=no change, 0=off, 1=on
static std::atomic<float> g_cmdVolume{-1.0f}; // <0 = no change
static std::atomic<int> g_cmdRenderParam{-1}; // -1 = no change
static std::atomic<int32_t> g_cmdRenderValue{0};
static std::atomic<int> g_cmdCtl{0}; // 1 = key/value buffers ready
static char g_ctlKey[128];
static char g_ctlVal[256];
// Per-channel mute bits (32 = MAX_VU_CHANNELS). Main writes; audio thread applies.
static std::atomic<uint32_t> g_muteBits{0};
static uint32_t g_appliedMuteBits = 0;
static int g_interpLength = 8;
static int g_lastExtraRenderParam = -1;
static int32_t g_lastExtraRenderValue = 0;
// Render pause: silence output without AudioContext.suspend() (shared-context safe).
static std::atomic<int> g_paused{0};
static int g_ringOverrunLogged = 0;

// Position info polled by main thread (written by worklet)
static PositionInfo g_positionInfo;
static std::atomic<int> g_positionReady{0}; // 1 = new data available

// Audio context and node handles
static EMSCRIPTEN_WEBAUDIO_T g_audioCtx = 0;
static EMSCRIPTEN_AUDIO_WORKLET_NODE_T g_workletNode = 0;

// Cumulative frames rendered since last load/seek (sample-accurate clock).
// MUST reset on load and seek so main-thread anchors with frameSecondsAtAnchor=0
// (see utils/nativeClockAnchor.ts) stay valid across stop→play / seek / reload.
static double g_audioFramesRendered = 0.0;
static int    g_renderSampleRate    = 48000;

// Track last reported row to detect row changes
static int g_lastReportedRow = -1;
static double g_lastReportTimeS = 0.0;

// ── Ring buffer for main-thread bridge routing ───────────────────────
//
// When a ring buffer is configured via set_ring_buffer(), the worklet thread
// writes rendered audio samples here instead of (only) through the Web Audio
// graph.  The main-thread bridge AudioWorkletProcessor reads from the same
// WASM shared memory and re-outputs audio through the main AudioContext chain,
// making GainNode / AnalyserNode routing work with the native C++ engine.
//
// Layout at g_ringBufBase (WASM heap pointer):
//   [0..3]  writeHead  (Int32, updated atomically by worklet thread)
//   [4..7]  readHead   (Int32, updated by bridge processor – reserved for JS)
//   [8..]   stereo samples (Float32, interleaved L/R, capacity = g_ringCapacity frames)

static volatile int32_t* g_ringBufHeader = nullptr; // &buf[0] – writeHead / readHead
static float*            g_ringSamples   = nullptr; // &buf[8] – sample area
static int               g_ringCapacity  = 0;       // in stereo frames

// Flag: 1 = caller owns the AudioContext (skip auto-connect to destination)
static int g_externalContext = 0;

// AudioWorklet thread stack (required by emscripten_start_wasm_audio_worklet_thread_async)
static uint8_t* g_workletStack = nullptr;
constexpr uint32_t WORKLET_STACK_SIZE = 128 * 1024;

static uint8_t* ensureWorkletStack() {
    if (!g_workletStack) {
        g_workletStack = static_cast<uint8_t*>(memalign(16, WORKLET_STACK_SIZE));
    }
    return g_workletStack;
}

static void apply_persisted_controls(OpenMPTModule& m) {
    m.setRenderParam(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, g_interpLength);
    if (g_lastExtraRenderParam >= 0
        && g_lastExtraRenderParam != OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH) {
        m.setRenderParam(g_lastExtraRenderParam, g_lastExtraRenderValue);
    }
    if (g_ctlKey[0] != '\0') {
        m.ctlSetText(g_ctlKey, g_ctlVal);
    }
    const uint32_t bits = g_muteBits.load(std::memory_order_acquire);
    for (int i = 0; i < MAX_VU_CHANNELS; ++i) {
        if ((bits >> i) & 1u) {
            m.setChannelMute(i, true);
        }
    }
}

static void apply_mute_bits(OpenMPTModule& m, uint32_t bits, uint32_t previous) {
    if (bits == previous) return;
    for (int i = 0; i < MAX_VU_CHANNELS; ++i) {
        const bool now = ((bits >> i) & 1u) != 0;
        const bool was = ((previous >> i) & 1u) != 0;
        if (now != was) {
            m.setChannelMute(i, now);
        }
    }
}

static void log_heap_exhausted(int requested) {
    const size_t heap = emscripten_get_heap_size();
    const struct mallinfo mi = mallinfo();
    std::fprintf(stderr,
        "[C++] load_module: malloc(%d) failed (heap exhausted) "
        "heap_size=%zu arena=%lu uordblks=%lu fordblks=%lu "
        "(128MiB cap includes g_module + g_metaModule)\n",
        requested, heap,
        static_cast<unsigned long>(mi.arena),
        static_cast<unsigned long>(mi.uordblks),
        static_cast<unsigned long>(mi.fordblks));
}

// ── AudioWorklet process callback (runs on worklet thread) ──────────

EM_BOOL audio_process_cb(
    int numInputs,  const AudioSampleFrame* inputs,
    int numOutputs, AudioSampleFrame* outputs,
    int numParams,  const AudioParamFrame* params,
    void* userData)
{
    // ── Handle pending commands from main thread ──

    // Load command
    if (g_cmdLoad.load(std::memory_order_acquire) == 1) {
        g_cmdLoad.store(0, std::memory_order_release);
        if (g_moduleData && g_moduleDataSize > 0) {
            bool ok = g_module.load(g_moduleData, g_moduleDataSize);
            // Free the transfer buffer
            free(g_moduleData);
            g_moduleData = nullptr;
            g_moduleDataSize = 0;
            if (ok) {
                // Pair with TS createNativeClockAnchor(..., frameSecondsAtAnchor=0)
                g_audioFramesRendered = 0.0;
                g_lastReportedRow = -1;
                g_lastReportTimeS = 0.0;
                apply_persisted_controls(g_module);
                g_appliedMuteBits = g_muteBits.load(std::memory_order_acquire);
            } else {
                std::fprintf(stderr, "[worklet] Failed to load module\n");
            }
        }
    }

    // Seek command
    {
        int order = g_cmdSeekOrder.exchange(-1, std::memory_order_acq_rel);
        int row   = g_cmdSeekRow.exchange(-1, std::memory_order_acq_rel);
        if (order >= 0 && row >= 0) {
            g_module.seekOrderRow(order, row);
            // Re-zero frame clock so seek re-anchor (frameSecondsAtAnchor=0) matches
            g_audioFramesRendered = 0.0;
            g_lastReportedRow = -1;
        }
    }

    // Loop command
    {
        int loop = g_cmdSetLoop.exchange(-1, std::memory_order_acq_rel);
        if (loop >= 0) {
            g_module.setRepeatCount(loop ? -1 : 0);
        }
    }

    // Volume command
    {
        float vol = g_cmdVolume.exchange(-1.0f, std::memory_order_acq_rel);
        if (vol >= 0.0f) {
            g_module.setVolume(vol);
        }
    }

    // Render param (interpolation length, stereo sep, …)
    {
        int param = g_cmdRenderParam.exchange(-1, std::memory_order_acq_rel);
        if (param >= 0) {
            const int32_t value = g_cmdRenderValue.load(std::memory_order_acquire);
            g_module.setRenderParam(param, value);
        }
    }

    // ctl_set_text
    if (g_cmdCtl.exchange(0, std::memory_order_acq_rel) == 1) {
        char key[sizeof(g_ctlKey)];
        char val[sizeof(g_ctlVal)];
        std::memcpy(key, g_ctlKey, sizeof(key));
        std::memcpy(val, g_ctlVal, sizeof(val));
        key[sizeof(key) - 1] = '\0';
        val[sizeof(val) - 1] = '\0';
        g_module.ctlSetText(key, val);
    }

    // Channel mute bitmask
    {
        const uint32_t bits = g_muteBits.load(std::memory_order_acquire);
        apply_mute_bits(g_module, bits, g_appliedMuteBits);
        g_appliedMuteBits = bits;
    }

    // ── Render audio ──

    if (numOutputs < 1 || outputs[0].numberOfChannels < 2) {
        return EM_TRUE; // Keep processor alive
    }

    AudioSampleFrame& out = outputs[0];
    const int frames = 128; // Standard AudioWorklet quantum

    if (g_paused.load(std::memory_order_acquire) || !g_module.isLoaded()) {
        std::memset(out.data, 0, sizeof(float) * frames * out.numberOfChannels);
        return EM_TRUE;
    }

    // Prefer context sample rate when available (Emscripten sets 48000 typically)
    const int sr = g_renderSampleRate > 0 ? g_renderSampleRate : 48000;

    // ── Pre-render position snapshot (mirrors JS worklet quantum tag) ──
    // audioFramesRendered is the frame count at the *start* of this quantum so
    // workletTime = frames/sampleRate tags the first output sample.
    g_module.fillPositionInfo(g_positionInfo);
    g_positionInfo.audioFramesRendered = g_audioFramesRendered;
    g_positionInfo.sampleRate = sr;

    {
        const int currentRow = g_positionInfo.currentRow;
        static double timeSinceLastReport = 0.0;
        // Coalesce ready-flag lightly (~8 ms) but always refresh the struct above.
        const bool rowChanged = (currentRow != g_lastReportedRow);
        const bool timeThreshold = (timeSinceLastReport >= 0.008);
        if (rowChanged || timeThreshold) {
            g_lastReportedRow = currentRow;
            timeSinceLastReport = 0.0;
            g_positionReady.store(1, std::memory_order_release);
        }
        // Accumulate wall quantum even when flag not raised (next threshold)
        timeSinceLastReport += 128.0 / static_cast<double>(sr);
    }

    // Render interleaved stereo into a temp buffer
    float interleaved[128 * 2]; // Stack allocation for 128 frames
    int rendered = g_module.readInterleavedStereo(
        sr,
        frames,
        interleaved
    );

    if (rendered == 0) {
        // Module ended
        std::memset(out.data, 0, sizeof(float) * frames * out.numberOfChannels);
        // Signal end to main thread
        PositionInfo& pi = g_positionInfo;
        pi.currentRow = -1; // Special sentinel for "ended"
        pi.audioFramesRendered = g_audioFramesRendered;
        pi.sampleRate = sr;
        g_positionReady.store(1, std::memory_order_release);
        return EM_TRUE;
    }

    g_audioFramesRendered += static_cast<double>(rendered);
    g_lastReportTimeS += static_cast<double>(rendered) / static_cast<double>(sr);

    // De-interleave into planar output
    // Emscripten AudioWorklet outputs are planar: [L0,L1,...,L127, R0,R1,...,R127]
    float* outData = out.data;
    for (int i = 0; i < rendered; ++i) {
        outData[i]          = interleaved[i * 2];     // Left
        outData[frames + i] = interleaved[i * 2 + 1]; // Right
    }
    // Zero-fill remainder if needed
    if (rendered < frames) {
        std::memset(outData + rendered, 0, sizeof(float) * (frames - rendered));
        std::memset(outData + frames + rendered, 0, sizeof(float) * (frames - rendered));
    }

    // ── Write to ring buffer (if configured for main-thread bridge routing) ──
    if (g_ringBufHeader && g_ringSamples && g_ringCapacity > 0) {
        int32_t head = __atomic_load_n(g_ringBufHeader, __ATOMIC_ACQUIRE);
        int32_t readHead = __atomic_load_n(g_ringBufHeader + 1, __ATOMIC_ACQUIRE);
        const int used = (head - readHead + g_ringCapacity) % g_ringCapacity;
        const int freeFrames = g_ringCapacity - used - 1;
        if (rendered > freeFrames && !g_ringOverrunLogged) {
            std::fprintf(stderr,
                "[worklet] ring buffer overrun (write lapped read; used=%d cap=%d)\n",
                used, g_ringCapacity);
            g_ringOverrunLogged = 1;
        }
        for (int i = 0; i < rendered; ++i) {
            int pos = (head + i) % g_ringCapacity;
            g_ringSamples[pos * 2]     = interleaved[i * 2];     // Left
            g_ringSamples[pos * 2 + 1] = interleaved[i * 2 + 1]; // Right
        }
        // Release fence ensures samples are visible before the updated head
        __atomic_store_n(g_ringBufHeader, (head + rendered) % g_ringCapacity, __ATOMIC_RELEASE);
    }

    return EM_TRUE;
}

// ── Worklet thread created callback ─────────────────────────────────

static void worklet_thread_initialized(EMSCRIPTEN_WEBAUDIO_T audioCtx, EM_BOOL success, void* userData) {
    if (!success) {
        std::fprintf(stderr, "[worklet] Failed to initialize audio worklet thread\n");
        return;
    }

    // Create the AudioWorkletNode on the worklet thread
    int outputChannelCounts[] = { 2 }; // Stereo output

    EmscriptenAudioWorkletNodeCreateOptions opts;
    std::memset(&opts, 0, sizeof(opts));
    opts.numberOfInputs  = 0;
    opts.numberOfOutputs = 1;
    opts.outputChannelCounts = outputChannelCounts;

    g_workletNode = emscripten_create_wasm_audio_worklet_node(
        audioCtx,
        "openmpt-native-processor",
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

// ── Exported C functions (called from TypeScript via ccall/cwrap) ────

extern "C" {

/**
 * Initialize the audio system. Creates an AudioContext and starts
 * the AudioWorklet thread.
 * @param sampleRate  Desired sample rate (0 = browser default)
 * @return 1 on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int init_audio(int sampleRate) {
    EmscriptenWebAudioCreateAttributes attrs;
    std::memset(&attrs, 0, sizeof(attrs));
    attrs.latencyHint   = "playback";
    attrs.sampleRate    = sampleRate > 0 ? sampleRate : 0; // 0 = default

    g_audioCtx = emscripten_create_audio_context(&attrs);
    if (!g_audioCtx) {
        std::fprintf(stderr, "[C++] Failed to create AudioContext\n");
        return 0;
    }

    // Start the worklet thread with a 128KB 16-byte-aligned stack (required).
    uint8_t* stack = ensureWorkletStack();
    if (!stack) {
        std::fprintf(stderr, "[C++] Failed to allocate AudioWorklet stack\n");
        return 0;
    }
    emscripten_start_wasm_audio_worklet_thread_async(
        g_audioCtx,
        stack,
        WORKLET_STACK_SIZE,
        worklet_thread_initialized,
        nullptr
    );

    std::printf("[C++] Audio context created (handle=%d)\n", g_audioCtx);
    return 1;
}

/**
 * Configure a ring buffer in WASM shared memory for main-thread bridge routing.
 *
 * The buffer must have been allocated on the WASM heap (via _malloc from JS).
 * Layout at buf:
 *   [0..3]  writeHead (Int32) – next frame index to write; updated atomically
 *   [4..7]  readHead  (Int32) – reserved for the JS bridge worklet
 *   [8..]   float32 stereo samples, interleaved L/R, capacity = capacityFrames
 *
 * Once configured, audio_process_cb writes every rendered frame here in addition
 * to (or instead of) the Web Audio output, enabling the main-thread bridge
 * AudioWorkletProcessor to re-output audio through the shared GainNode/AnalyserNode.
 *
 * @param buf            Pointer to the WASM heap ring buffer (8-byte header + samples)
 * @param capacityFrames Stereo frame capacity of the sample area
 */
EMSCRIPTEN_KEEPALIVE
void set_ring_buffer(uint8_t* buf, int capacityFrames) {
    if (!buf || capacityFrames <= 0) return;
    g_ringBufHeader = (volatile int32_t*)buf;
    g_ringSamples   = (float*)(buf + 8); // skip 8-byte header
    g_ringCapacity  = capacityFrames;
    // Zero-initialise header counters and sample area
    __atomic_store_n(g_ringBufHeader,     0, __ATOMIC_RELAXED); // writeHead = 0
    __atomic_store_n(g_ringBufHeader + 1, 0, __ATOMIC_RELAXED); // readHead  = 0
    std::memset(g_ringSamples, 0, (size_t)capacityFrames * 2 * sizeof(float));
    std::printf("[C++] Ring buffer configured: ptr=%p, capacity=%d frames\n",
                (void*)buf, capacityFrames);
}

/**
 * Returns the current ring buffer write-head (in stereo frames).
 * Useful for the JS side to verify data is flowing.
 */
EMSCRIPTEN_KEEPALIVE
int get_ring_write_head() {
    if (!g_ringBufHeader) return 0;
    return __atomic_load_n(g_ringBufHeader, __ATOMIC_ACQUIRE);
}

/**
 * Initialise audio using an externally-provided AudioContext handle.
 *
 * Unlike init_audio(), this function does NOT create a new AudioContext.
 * Instead it accepts a handle obtained by the caller via
 * emscriptenRegisterAudioObject(existingCtx) and starts the worklet thread
 * on that context.  The AudioWorkletNode is NOT auto-connected to destination;
 * the caller is responsible for connecting it into their audio graph (e.g. via
 * the TypeScript bridgeToAudioGraph() helper or the ring-buffer bridge).
 *
 * @param ctxHandle  Emscripten audio context handle
 * @return 1 on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int init_audio_with_context(int ctxHandle) {
    if (!ctxHandle) {
        std::fprintf(stderr, "[C++] init_audio_with_context: invalid context handle\n");
        return 0;
    }
    g_audioCtx        = ctxHandle;
    g_externalContext = 1; // skip auto-connect in worklet_thread_initialized

    uint8_t* stack = ensureWorkletStack();
    if (!stack) {
        std::fprintf(stderr, "[C++] Failed to allocate AudioWorklet stack\n");
        return 0;
    }
    emscripten_start_wasm_audio_worklet_thread_async(
        g_audioCtx,
        stack,
        WORKLET_STACK_SIZE,
        worklet_thread_initialized,
        nullptr
    );

    std::printf("[C++] Audio initialised with external context (handle=%d)\n", ctxHandle);
    return 1;
}

/**
 * Load a module from a memory buffer.
 * Copies data to shared memory and signals the worklet thread.
 * @param data    Pointer to module file data
 * @param length  Size in bytes
 * @return 1 on success (data queued), 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int load_module(const uint8_t* data, int length) {
    if (!data || length <= 0) return 0;

    // Free previous transfer buffer
    if (g_moduleData) {
        free(g_moduleData);
    }

    // Copy data for the worklet thread to consume
    g_moduleData = (uint8_t*)malloc(length);
    if (!g_moduleData) {
        log_heap_exhausted(length);
        return 0;
    }
    std::memcpy(g_moduleData, data, length);
    g_moduleDataSize = length;

    if (!g_metaModule.load(data, static_cast<size_t>(length))) {
        std::fprintf(stderr, "[C++] load_module: metadata parse failed (%d bytes)\n", length);
    } else {
        apply_persisted_controls(g_metaModule);
    }

    // Signal the worklet thread to load
    g_cmdLoad.store(1, std::memory_order_release);

    return 1;
}

/**
 * Resume render (clears pause flag). Also resumes a suspended AudioContext
 * after a user gesture — never used as the pause mechanism.
 */
EMSCRIPTEN_KEEPALIVE
void resume_audio() {
    g_paused.store(0, std::memory_order_release);
    if (g_audioCtx) {
        EM_ASM({
            var ctx = emscriptenGetAudioObject($0);
            if (ctx && ctx.state === 'suspended') ctx.resume();
        }, g_audioCtx);
    }
}

/**
 * Pause render by silencing the worklet. Does NOT AudioContext.suspend()
 * (that would freeze a shared main-thread graph — #329 / #330).
 */
EMSCRIPTEN_KEEPALIVE
void suspend_audio() {
    g_paused.store(1, std::memory_order_release);
}

/**
 * Seek to a specific order + row position.
 */
EMSCRIPTEN_KEEPALIVE
void seek_order_row(int order, int row) {
    g_cmdSeekOrder.store(order, std::memory_order_release);
    g_cmdSeekRow.store(row, std::memory_order_release);
}

/**
 * Set loop mode: 1 = loop, 0 = play once.
 */
EMSCRIPTEN_KEEPALIVE
void set_loop(int loop) {
    g_cmdSetLoop.store(loop, std::memory_order_release);
}

/**
 * Set playback volume (0.0 – 1.0).
 */
EMSCRIPTEN_KEEPALIVE
void set_volume(float vol) {
    g_cmdVolume.store(vol, std::memory_order_release);
}

/**
 * Mute/unmute a tracker channel (interactive ext). Applied on g_metaModule
 * immediately; g_module sees the bitmask on the audio thread.
 */
EMSCRIPTEN_KEEPALIVE
void set_channel_mute(int channel, int muted) {
    if (channel < 0 || channel >= MAX_VU_CHANNELS) return;
    uint32_t bits = g_muteBits.load(std::memory_order_relaxed);
    if (muted) {
        bits |= (1u << channel);
    } else {
        bits &= ~(1u << channel);
    }
    g_muteBits.store(bits, std::memory_order_release);
    if (g_metaModule.isLoaded()) {
        g_metaModule.setChannelMute(channel, muted != 0);
    }
}

/**
 * Set a libopenmpt render param (e.g. OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH).
 */
EMSCRIPTEN_KEEPALIVE
void set_render_param(int param, int32_t value) {
    if (param == OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH) {
        g_interpLength = value;
    } else {
        g_lastExtraRenderParam = param;
        g_lastExtraRenderValue = value;
    }
    g_cmdRenderValue.store(value, std::memory_order_relaxed);
    g_cmdRenderParam.store(param, std::memory_order_release);
    if (g_metaModule.isLoaded()) {
        g_metaModule.setRenderParam(param, value);
    }
}

/**
 * Post-load ctl_set_text. Strings are copied into fixed buffers for the audio thread.
 */
EMSCRIPTEN_KEEPALIVE
void ctl_set_text(const char* key, const char* value) {
    if (!key || !value) return;
    std::strncpy(g_ctlKey, key, sizeof(g_ctlKey) - 1);
    g_ctlKey[sizeof(g_ctlKey) - 1] = '\0';
    std::strncpy(g_ctlVal, value, sizeof(g_ctlVal) - 1);
    g_ctlVal[sizeof(g_ctlVal) - 1] = '\0';
    if (g_metaModule.isLoaded()) {
        g_metaModule.ctlSetText(g_ctlKey, g_ctlVal);
    }
    g_cmdCtl.store(1, std::memory_order_release);
}

/**
 * Poll position info from the worklet thread.
 * @return Pointer to a static PositionInfo struct, or NULL if no new data.
 *         The caller should read it immediately (not thread-safe to hold).
 */
EMSCRIPTEN_KEEPALIVE
PositionInfo* poll_position() {
    if (g_positionReady.exchange(0, std::memory_order_acq_rel)) {
        return &g_positionInfo;
    }
    return nullptr;
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
 * Clean up and destroy all audio resources.
 */
EMSCRIPTEN_KEEPALIVE
void cleanup_audio() {
    g_module.unload();
    g_metaModule.unload();
    if (g_moduleData) {
        free(g_moduleData);
        g_moduleData = nullptr;
    }
    g_muteBits.store(0, std::memory_order_relaxed);
    g_appliedMuteBits = 0;
    g_interpLength = 8;
    g_lastExtraRenderParam = -1;
    g_ctlKey[0] = '\0';
    g_ctlVal[0] = '\0';
    // Note: AudioContext destruction is handled by the browser
    // when the page unloads or the context is garbage collected.
    g_audioCtx = 0;
    g_workletNode = 0;
}

// ── Pattern data query functions (called from TypeScript) ────────────
// These allow the JS engine to build a PatternMatrix for the current
// module without shipping pattern bytes through the PositionInfo struct.

static OpenMPTModule& patternQueryModule() {
    return g_metaModule.isLoaded() ? g_metaModule : g_module;
}

/**
 * Get the number of channels in the currently loaded module.
 */
EMSCRIPTEN_KEEPALIVE
int get_num_channels() {
    return patternQueryModule().getNumChannels();
}

/**
 * Get the number of orders (positions) in the currently loaded module.
 */
EMSCRIPTEN_KEEPALIVE
int get_num_orders() {
    return patternQueryModule().getNumOrders();
}

EMSCRIPTEN_KEEPALIVE
int get_num_patterns() {
    return patternQueryModule().getNumPatterns();
}

EMSCRIPTEN_KEEPALIVE
double get_duration_seconds() {
    return patternQueryModule().getDurationSeconds();
}

EMSCRIPTEN_KEEPALIVE
double get_initial_bpm() {
    return patternQueryModule().getBPM();
}

/**
 * Get the pattern index for a given order position.
 */
EMSCRIPTEN_KEEPALIVE
int get_order_pattern(int order) {
    return patternQueryModule().getOrderPattern(order);
}

/**
 * Get the number of rows in a given pattern.
 */
EMSCRIPTEN_KEEPALIVE
int get_pattern_num_rows(int pattern) {
    return patternQueryModule().getPatternNumRows(pattern);
}

/**
 * Read a per-cell command value for a given pattern/row/channel.
 * command values: 0=note, 1=instrument, 2=volCmd, 3=volVal, 4=effCmd, 5=effVal
 */
EMSCRIPTEN_KEEPALIVE
int get_pattern_row_channel_command(int pattern, int row, int channel, int command) {
    return patternQueryModule().getPatternRowChannelCommand(pattern, row, channel, command);
}

} // extern "C"
