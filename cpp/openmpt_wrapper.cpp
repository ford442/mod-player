/**
 * openmpt_wrapper.cpp – Implementation of the OpenMPTModule class.
 *
 * Uses the libopenmpt C API (not C++) so the same binary works
 * whether libopenmpt was built with or without C++ exceptions.
 */

#include "openmpt_wrapper.h"
#include <cstring>
#include <cstdio>
#include <algorithm>

// ── Helpers ─────────────────────────────────────────────────────────

static void safe_strcpy(char* dst, size_t dstSize, const char* src) {
    if (!src) { dst[0] = '\0'; return; }
    std::strncpy(dst, src, dstSize - 1);
    dst[dstSize - 1] = '\0';
}

// ── OpenMPTModule implementation ────────────────────────────────────

OpenMPTModule::OpenMPTModule() = default;

OpenMPTModule::~OpenMPTModule() {
    unload();
}

bool OpenMPTModule::load(const uint8_t* data, size_t length) {
    unload(); // Clean up any previous module

    mod_ = openmpt_module_create_from_memory2(
        data, length,
        nullptr, nullptr, // log callback
        nullptr, nullptr, // error callback
        nullptr,          // error out
        nullptr,          // error message out
        nullptr           // ctls
    );

    if (!mod_) {
        std::fprintf(stderr, "[OpenMPTModule] Failed to create module from %zu bytes\n", length);
        return false;
    }

    // Set high-quality interpolation (windowed sinc)
    openmpt_module_set_render_param(mod_, OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, 8);

    // Default: infinite loop
    openmpt_module_set_repeat_count(mod_, -1);

    return true;
}

void OpenMPTModule::unload() {
    if (mod_) {
        openmpt_module_destroy(mod_);
        mod_ = nullptr;
    }
}

// ── Playback ────────────────────────────────────────────────────────

int OpenMPTModule::readInterleavedStereo(int sampleRate, int frames, float* buffer) {
    if (!mod_) return 0;

    int rendered = static_cast<int>(
        openmpt_module_read_interleaved_float_stereo(mod_, sampleRate, static_cast<size_t>(frames), buffer)
    );

    // Apply volume scaling in-place
    if (volume_ < 0.999f && rendered > 0) {
        const int total = rendered * 2; // stereo
        for (int i = 0; i < total; ++i) {
            buffer[i] *= volume_;
        }
    }

    return rendered;
}

void OpenMPTModule::seekOrderRow(int order, int row) {
    if (mod_) {
        openmpt_module_set_position_order_row(mod_, order, row);
    }
}

void OpenMPTModule::seekSeconds(double seconds) {
    if (mod_) {
        openmpt_module_set_position_seconds(mod_, seconds);
    }
}

void OpenMPTModule::setRepeatCount(int count) {
    if (mod_) {
        openmpt_module_set_repeat_count(mod_, count);
    }
}

void OpenMPTModule::setVolume(float vol) {
    volume_ = std::max(0.0f, std::min(1.0f, vol));
}

// ── Position / metadata ─────────────────────────────────────────────

void OpenMPTModule::fillPositionInfo(PositionInfo& out) const {
    std::memset(&out, 0, sizeof(out));
    if (!mod_) return;

    out.positionMs      = openmpt_module_get_position_seconds(mod_) * 1000.0;
    out.currentRow      = openmpt_module_get_current_row(mod_);
    out.currentOrder    = openmpt_module_get_current_order(mod_);
    out.bpm             = openmpt_module_get_current_estimated_bpm(mod_);
    out.numChannels     = openmpt_module_get_num_channels(mod_);

    // Resolve order → pattern
    if (out.currentOrder >= 0) {
        out.currentPattern = openmpt_module_get_order_pattern(mod_, out.currentOrder);
    }

    // Per-channel VU
    getChannelVU(out.channelVU, MAX_VU_CHANNELS);
}

void OpenMPTModule::fillMetadata(ModuleMetadata& out) const {
    std::memset(&out, 0, sizeof(out));
    if (!mod_) return;

    const char* title = openmpt_module_get_metadata(mod_, "title");
    safe_strcpy(out.title, sizeof(out.title), title);
    if (title) openmpt_free_string(title);

    out.numOrders       = openmpt_module_get_num_orders(mod_);
    out.numPatterns     = openmpt_module_get_num_patterns(mod_);
    out.numChannels     = openmpt_module_get_num_channels(mod_);
    out.durationSeconds = openmpt_module_get_duration_seconds(mod_);
    out.initialBpm      = openmpt_module_get_current_estimated_bpm(mod_);
}

int OpenMPTModule::getCurrentOrder() const {
    return mod_ ? openmpt_module_get_current_order(mod_) : 0;
}

int OpenMPTModule::getCurrentRow() const {
    return mod_ ? openmpt_module_get_current_row(mod_) : 0;
}

int OpenMPTModule::getCurrentPattern() const {
    if (!mod_) return 0;
    int order = openmpt_module_get_current_order(mod_);
    return openmpt_module_get_order_pattern(mod_, order);
}

double OpenMPTModule::getPositionSeconds() const {
    return mod_ ? openmpt_module_get_position_seconds(mod_) : 0.0;
}

double OpenMPTModule::getBPM() const {
    return mod_ ? openmpt_module_get_current_estimated_bpm(mod_) : 0.0;
}

int OpenMPTModule::getNumChannels() const {
    return mod_ ? openmpt_module_get_num_channels(mod_) : 0;
}

int OpenMPTModule::getNumOrders() const {
    return mod_ ? openmpt_module_get_num_orders(mod_) : 0;
}

void OpenMPTModule::getChannelVU(float* out, int maxCh) const {
    if (!mod_) {
        std::memset(out, 0, sizeof(float) * maxCh);
        return;
    }
    int nch = std::min(openmpt_module_get_num_channels(mod_), maxCh);
    for (int c = 0; c < nch; ++c) {
        out[c] = static_cast<float>(openmpt_module_get_current_channel_vu_mono(mod_, c));
    }
    // Zero remaining
    for (int c = nch; c < maxCh; ++c) {
        out[c] = 0.0f;
    }
}

int OpenMPTModule::getPatternNumRows(int pattern) const {
    return mod_ ? openmpt_module_get_pattern_num_rows(mod_, pattern) : 0;
}

int OpenMPTModule::getOrderPattern(int order) const {
    return mod_ ? openmpt_module_get_order_pattern(mod_, order) : 0;
}

int OpenMPTModule::getPatternRowChannelCommand(int pattern, int row, int channel, int command) const {
    return mod_ ? openmpt_module_get_pattern_row_channel_command(mod_, pattern, row, channel, command) : 0;
}
