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

#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <atomic>

#include "openmpt_wrapper.h"

// ── Shared state ────────────────────────────────────────────────────
//
// Accessed from BOTH main thread and audio worklet thread.
// Atomics or single-writer patterns are used to avoid races.

// The module instance lives on the worklet thread (created there after
// receiving module data from main thread via shared buffer).
static OpenMPTModule g_module;

// Shared buffer for transferring module file data from main → worklet
static uint8_t*        g_moduleData     = nullptr;
static size_t          g_moduleDataSize = 0;

// Atomic flags for cross-thread commands
static std::atomic<int> g_cmdLoad{0};    // 1 = new module data ready
static std::atomic<int> g_cmdSeekOrder{-1};
static std::atomic<int> g_cmdSeekRow{-1};
static std::atomic<int> g_cmdSetLoop{-1}; // -1=no change, 0=off, 1=on
static std::atomic<float> g_cmdVolume{-1.0f}; // <0 = no change

// Position info polled by main thread (written by worklet)
static PositionInfo g_positionInfo;
static std::atomic<int> g_positionReady{0}; // 1 = new data available

// Audio context and node handles
static EMSCRIPTEN_WEBAUDIO_T g_audioCtx = 0;
static EMSCRIPTEN_AUDIO_WORKLET_NODE_T g_workletNode = 0;

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
            if (!ok) {
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

    // ── Render audio ──

    if (numOutputs < 1 || outputs[0].numberOfChannels < 2) {
        return EM_TRUE; // Keep processor alive
    }

    AudioSampleFrame& out = outputs[0];
    const int frames = 128; // Standard AudioWorklet quantum

    if (!g_module.isLoaded()) {
        // Output silence
        std::memset(out.data, 0, sizeof(float) * frames * out.numberOfChannels);
        return EM_TRUE;
    }

    // Render interleaved stereo into a temp buffer
    float interleaved[128 * 2]; // Stack allocation for 128 frames
    int rendered = g_module.readInterleavedStereo(
        48000,
        frames,
        interleaved
    );

    if (rendered == 0) {
        // Module ended
        std::memset(out.data, 0, sizeof(float) * frames * out.numberOfChannels);
        // Signal end to main thread
        PositionInfo& pi = g_positionInfo;
        pi.currentRow = -1; // Special sentinel for "ended"
        g_positionReady.store(1, std::memory_order_release);
        return EM_TRUE;
    }

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
        for (int i = 0; i < rendered; ++i) {
            int pos = (head + i) % g_ringCapacity;
            g_ringSamples[pos * 2]     = interleaved[i * 2];     // Left
            g_ringSamples[pos * 2 + 1] = interleaved[i * 2 + 1]; // Right
        }
        // Release fence ensures samples are visible before the updated head
        __atomic_store_n(g_ringBufHeader, (head + rendered) % g_ringCapacity, __ATOMIC_RELEASE);
    }

    // ── Report position (throttled: every ~16ms OR on row change) ──
    int currentRow = g_module.getCurrentRow();
    // Accumulate elapsed time based on sample count
    double elapsed = (double)frames / 48000.0;
    static double timeSinceLastReport = 0.0;
    timeSinceLastReport += elapsed;
    g_lastReportTimeS += elapsed;

    bool rowChanged = (currentRow != g_lastReportedRow);
    // ~16ms = ~768 samples at 48kHz ≈ 6 process() calls
    bool timeThreshold = (timeSinceLastReport >= 0.016);

    if (rowChanged || timeThreshold) {
        g_lastReportedRow = currentRow;
        timeSinceLastReport = 0.0;
        g_module.fillPositionInfo(g_positionInfo);
        g_positionReady.store(1, std::memory_order_release);
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

    // Start the worklet thread with a stack size of 128KB
    emscripten_start_wasm_audio_worklet_thread_async(
        g_audioCtx,
        nullptr, 0,  // no custom shared memory (Emscripten manages it)
        worklet_thread_initialized,
        nullptr       // userData
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

    emscripten_start_wasm_audio_worklet_thread_async(
        g_audioCtx,
        nullptr, 0,
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
    if (!g_moduleData) return 0;
    std::memcpy(g_moduleData, data, length);
    g_moduleDataSize = length;

    // Signal the worklet thread to load
    g_cmdLoad.store(1, std::memory_order_release);

    return 1;
}

/**
 * Resume audio context (required after user gesture).
 */
EMSCRIPTEN_KEEPALIVE
void resume_audio() {
    if (g_audioCtx) {
        EM_ASM({
            var ctx = emscriptenGetAudioObject($0);
            if (ctx && ctx.state === 'suspended') ctx.resume();
        }, g_audioCtx);
    }
}

/**
 * Suspend audio context (pause).
 */
EMSCRIPTEN_KEEPALIVE
void suspend_audio() {
    if (g_audioCtx) {
        EM_ASM({
            var ctx = emscriptenGetAudioObject($0);
            if (ctx && ctx.state === 'running') ctx.suspend();
        }, g_audioCtx);
    }
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
    if (g_moduleData) {
        free(g_moduleData);
        g_moduleData = nullptr;
    }
    // Note: AudioContext destruction is handled by the browser
    // when the page unloads or the context is garbage collected.
    g_audioCtx = 0;
    g_workletNode = 0;
}

// ── Pattern data query functions (called from TypeScript) ────────────
// These allow the JS engine to build a PatternMatrix for the current
// module without shipping pattern bytes through the PositionInfo struct.

/**
 * Get the number of channels in the currently loaded module.
 */
EMSCRIPTEN_KEEPALIVE
int get_num_channels() {
    return g_module.getNumChannels();
}

/**
 * Get the number of orders (positions) in the currently loaded module.
 */
EMSCRIPTEN_KEEPALIVE
int get_num_orders() {
    return g_module.getNumOrders();
}

/**
 * Get the pattern index for a given order position.
 */
EMSCRIPTEN_KEEPALIVE
int get_order_pattern(int order) {
    return g_module.getOrderPattern(order);
}

/**
 * Get the number of rows in a given pattern.
 */
EMSCRIPTEN_KEEPALIVE
int get_pattern_num_rows(int pattern) {
    return g_module.getPatternNumRows(pattern);
}

/**
 * Read a per-cell command value for a given pattern/row/channel.
 * command values: 0=note, 1=instrument, 2=volCmd, 3=volVal, 4=effCmd, 5=effVal
 */
EMSCRIPTEN_KEEPALIVE
int get_pattern_row_channel_command(int pattern, int row, int channel, int command) {
    return g_module.getPatternRowChannelCommand(pattern, row, channel, command);
}

} // extern "C"
