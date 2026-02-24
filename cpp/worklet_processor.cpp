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
        out.samplesPerSec > 0 ? out.samplesPerSec : 48000,
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

    // ── Report position (throttled: every ~16ms OR on row change) ──
    int currentRow = g_module.getCurrentRow();
    // Accumulate elapsed time based on sample count
    double elapsed = (double)frames / (double)(out.samplesPerSec > 0 ? out.samplesPerSec : 48000);
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

    g_workletNode = emscripten_create_audio_worklet_node(
        audioCtx,
        "openmpt-native-processor",
        &opts,
        audio_process_cb,
        nullptr  // userData
    );

    // Connect worklet node to destination
    EM_ASM({
        var ctx = emscriptenGetAudioObject($0);
        var node = emscriptenGetAudioObject($1);
        if (ctx && node) {
            node.connect(ctx.destination);
            console.log('[C++] AudioWorkletNode connected to destination');
        }
    }, audioCtx, g_workletNode);

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
    emscripten_start_audio_worklet_thread_async(
        g_audioCtx,
        nullptr, 0,  // no custom shared memory (Emscripten manages it)
        worklet_thread_initialized,
        nullptr       // userData
    );

    std::printf("[C++] Audio context created (handle=%d)\n", g_audioCtx);
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

} // extern "C"
