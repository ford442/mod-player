#pragma once
/**
 * openmpt_wrapper.h – Thin C++ wrapper around libopenmpt's C API.
 *
 * Provides RAII module management, metadata extraction, and audio
 * rendering helpers used by both the main thread (metadata) and
 * the AudioWorklet thread (real-time audio).
 *
 * Thread-safety: a single OpenMPTModule instance must NOT be used by two
 * threads at once. cpp/native_engine.cpp moves each instance between the
 * control thread (parse, snapshot, destroy) and the audio thread (render)
 * only through atomic exchanges, so exactly one thread owns it at any time.
 *
 * Methods marked [audio-safe] never allocate or log, so the audio thread may
 * call them; load()/unload() allocate and run on the control thread only.
 */

#include <cstdint>
#include <cstddef>
#include <string>

// libopenmpt public C API
#include <libopenmpt/libopenmpt.h>
#include <libopenmpt/libopenmpt_ext.h>

// Maximum channels we report VU for (matches JS side Float32Array[32])
constexpr int MAX_VU_CHANNELS = 32;

// Message IDs shared with the TypeScript engine via postMessage bridge.
enum class MsgType : int {
    Position   = 1,
    Ended      = 2,
    Error      = 3,
    Loaded     = 4,
    Metadata   = 5,
    ChannelVU  = 6,
};

/**
 * Lightweight POD struct written to shared memory for main-thread polling.
 * Layout must stay in sync with audio-worklet/OpenMPTWorkletEngine.ts offsets.
 *
 * Extended fields (audioFramesRendered, rowFraction, speed, sampleRate) enable
 * sample-accurate playhead prediction without waiting for the next ~16 ms poll.
 */
struct PositionInfo {
    double positionMs;
    int    currentRow;
    int    currentPattern;
    int    currentOrder;
    double bpm;
    int    numChannels;
    float  channelVU[MAX_VU_CHANNELS]; // per-channel mono VU
    // ── Extended (ABI append-only) ──────────────────────────────────
    double audioFramesRendered; // cumulative frames rendered since load/play
    float  rowFraction;         // fractional row (currentRow + in-row progress)
    int    speed;               // ticks per row
    int    sampleRate;          // render sample rate used for frame clock
};

/**
 * Module metadata extracted after loading.
 */
struct ModuleMetadata {
    char   title[256];
    int    numOrders;
    int    numPatterns;
    int    numChannels;
    double durationSeconds;
    double initialBpm;
};

/**
 * RAII wrapper around an openmpt_module*.
 */
class OpenMPTModule {
public:
    OpenMPTModule();
    ~OpenMPTModule();

    // Non-copyable
    OpenMPTModule(const OpenMPTModule&) = delete;
    OpenMPTModule& operator=(const OpenMPTModule&) = delete;

    /**
     * Load a tracker module from a memory buffer.
     * Returns true on success. On failure, if `reason` is non-null, libopenmpt's own
     * error code and message are written to it (empty when it gave none).
     */
    bool load(const uint8_t* data, size_t length, char* reason = nullptr, size_t reasonSize = 0);

    /** Destroy the current module (safe to call if none loaded). */
    void unload();

    /** True after a successful load(). */
    bool isLoaded() const { return mod_ != nullptr; }

    // ── Playback control ────────────────────────────────────────────

    /**
     * Render interleaved stereo float audio.
     * @param sampleRate  Output sample rate (e.g. 48000)
     * @param frames      Number of stereo frames to render
     * @param buffer      Output buffer, must hold frames*2 floats
     * @return            Frames actually rendered (0 = end of song)
     */
    int readInterleavedStereo(int sampleRate, int frames, float* buffer);

    /** Seek to a specific order + row. */
    void seekOrderRow(int order, int row);

    /** Seek to a position in seconds. */
    void seekSeconds(double seconds);

    /** Set repeat count (-1 = infinite, 0 = play once). */
    void setRepeatCount(int count);

    /** Set master volume (0.0 – 1.0 maps to render gain). */
    void setVolume(float vol);

    /** Per-channel mute via openmpt_module_ext interactive (no-op if iface missing). [audio-safe] */
    void setChannelMute(int channel, bool muted);

    /** Mute exactly the channels whose bit is set; only changed bits call libopenmpt. [audio-safe] */
    void applyMuteMask(uint32_t mask);

    /** libopenmpt render param (interpolation length, stereo sep, …). Unknown ids are ignored. [audio-safe] */
    void setRenderParam(int param, int32_t value);

    /** Post-load ctl_set_text (e.g. play.at_end). Unsupported keys are ignored. [audio-safe] */
    void ctlSetText(const char* key, const char* value);

    /** True if this libopenmpt build lists `key` in openmpt_module_get_ctls(). [audio-safe] */
    bool supportsCtl(const char* key) const;

    /** libopenmpt's ';'-separated ctl list, cached at load (null if unloaded). */
    const char* supportedCtls() const { return ctls_; }

    // ── Position / metadata queries ─────────────────────────────────

    void fillPositionInfo(PositionInfo& out) const;
    void fillMetadata(ModuleMetadata& out) const;

    int getCurrentOrder()  const;
    int getCurrentRow()    const;
    int getCurrentPattern() const;
    double getPositionSeconds() const;
    double getBPM()        const;
    int getNumChannels()   const;
    int getNumOrders()     const;
    int getNumPatterns()   const;
    double getDurationSeconds() const;

    /**
     * Fill per-channel mono VU into out[0..numChannels-1].
     * Values are in [0, 1] range.
     */
    void getChannelVU(float* out, int maxCh) const;

    /**
     * Get the number of rows in a given pattern.
     */
    int getPatternNumRows(int pattern) const;

    /**
     * Get the pattern index for a given order position.
     */
    int getOrderPattern(int order) const;

    /**
     * Read a cell command value (note/inst/vol/effect/etc.).
     */
    int getPatternRowChannelCommand(int pattern, int row, int channel, int command) const;

private:
    openmpt_module_ext* modExt_ = nullptr;
    openmpt_module* mod_ = nullptr;
    openmpt_module_ext_interface_interactive interactive_{};
    bool interactiveReady_ = false;
    float volume_ = 1.0f;
    uint32_t muteMask_ = 0;
    // openmpt_module_get_ctls() allocates, so it is read once at load (control
    // thread) and kept: supportsCtl() on the audio thread then allocates nothing.
    const char* ctls_ = nullptr;
};
