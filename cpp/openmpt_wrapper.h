#pragma once
/**
 * openmpt_wrapper.h – Thin C++ wrapper around libopenmpt's C API.
 *
 * Provides RAII module management, metadata extraction, and audio
 * rendering helpers used by both the main thread (metadata) and
 * the AudioWorklet thread (real-time audio).
 *
 * Thread-safety: a single OpenMPTModule instance must NOT be shared
 * between threads.  The worklet thread owns its own instance; the
 * main thread may create a second instance for metadata only.
 */

#include <cstdint>
#include <cstddef>
#include <string>

// libopenmpt public C API
#include <libopenmpt/libopenmpt.h>

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
 * Lightweight POD struct posted to the main thread every ~16 ms
 * (or when the current row changes).
 */
struct PositionInfo {
    double positionMs;
    int    currentRow;
    int    currentPattern;
    int    currentOrder;
    double bpm;
    int    numChannels;
    float  channelVU[MAX_VU_CHANNELS]; // per-channel mono VU
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
     * Returns true on success.
     */
    bool load(const uint8_t* data, size_t length);

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
    openmpt_module* mod_ = nullptr;
    float volume_ = 1.0f;
};
