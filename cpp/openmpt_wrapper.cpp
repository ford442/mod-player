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

    // Ext create so interactive mute is available; ctls stay null (post-load ctl_set_text).
    modExt_ = openmpt_module_ext_create_from_memory(
        data, length,
        nullptr, nullptr, // log callback
        nullptr, nullptr, // error callback
        nullptr,          // error out
        nullptr,          // error message out
        nullptr           // ctls
    );

    if (!modExt_) {
        std::fprintf(stderr, "[OpenMPTModule] Failed to create ext module from %zu bytes\n", length);
        return false;
    }

    mod_ = openmpt_module_ext_get_module(modExt_);
    if (!mod_) {
        std::fprintf(stderr, "[OpenMPTModule] ext_get_module returned null\n");
        openmpt_module_ext_destroy(modExt_);
        modExt_ = nullptr;
        return false;
    }

    std::memset(&interactive_, 0, sizeof(interactive_));
    interactiveReady_ = openmpt_module_ext_get_interface(
        modExt_,
        LIBOPENMPT_EXT_C_INTERFACE_INTERACTIVE,
        &interactive_,
        sizeof(interactive_)
    ) != 0;
    if (!interactiveReady_) {
        std::fprintf(stderr, "[OpenMPTModule] interactive interface unavailable (mute will no-op)\n");
    }

    // Default: Sinc+LP (length 8). 0 is the same mixer mode (library default).
    // JS wasm2js live stays on cubic (4); native SIMD can hold 8.
    openmpt_module_set_render_param(mod_, OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, 8);

    // Default: infinite loop
    openmpt_module_set_repeat_count(mod_, -1);

    return true;
}

void OpenMPTModule::unload() {
    if (modExt_) {
        openmpt_module_ext_destroy(modExt_);
        modExt_ = nullptr;
        mod_ = nullptr; // owned by ext
    }
    interactiveReady_ = false;
    std::memset(&interactive_, 0, sizeof(interactive_));
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

// libopenmpt reports bad arguments by throwing, and this binary links
// libc++abi-noexcept (see scripts/build-wasm.sh) — so a throw is an abort(),
// not a return code, and an abort inside audio_process_cb takes the whole
// worklet down. Every setter below therefore validates before it calls in.

void OpenMPTModule::setChannelMute(int channel, bool muted) {
    if (!interactiveReady_ || !modExt_ || !interactive_.set_channel_mute_status) {
        return;
    }
    // Channel count is per-module: the worklet replays a 32-bit mute mask after
    // every load, so a mask set on a 32-channel IT must not abort on a 4ch MOD.
    if (channel < 0 || channel >= openmpt_module_get_num_channels(mod_)) {
        return;
    }
    interactive_.set_channel_mute_status(modExt_, channel, muted ? 1 : 0);
}

void OpenMPTModule::setRenderParam(int param, int32_t value) {
    if (!mod_) return;
    // Only the four documented ids (libopenmpt.h); an unknown id throws.
    // Out-of-range *values* are clamped by libopenmpt and are safe to pass.
    switch (param) {
        case OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL:
        case OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT:
        case OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH:
        case OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH:
            break;
        default:
            std::fprintf(stderr, "[OpenMPTModule] ignoring unknown render param %d\n", param);
            return;
    }
    openmpt_module_set_render_param(mod_, param, value);
}

bool OpenMPTModule::supportsCtl(const char* key) const {
    if (!mod_ || !key || !key[0]) return false;
    // Semicolon-separated list of the ctls this build actually understands.
    const char* ctls = openmpt_module_get_ctls(mod_);
    if (!ctls) return false;
    const size_t keyLen = std::strlen(key);
    bool found = false;
    for (const char* p = ctls; *p && !found; ) {
        const char* end = std::strchr(p, ';');
        const size_t len = end ? static_cast<size_t>(end - p) : std::strlen(p);
        if (len == keyLen && std::strncmp(p, key, keyLen) == 0) found = true;
        if (!end) break;
        p = end + 1;
    }
    openmpt_free_string(ctls);
    return found;
}

void OpenMPTModule::ctlSetText(const char* key, const char* value) {
    if (!mod_ || !key || !value) return;
    if (!supportsCtl(key)) {
        std::fprintf(stderr, "[OpenMPTModule] ignoring unsupported ctl '%s'\n", key);
        return;
    }
    openmpt_module_ctl_set_text(mod_, key, value);
}

// ── Position / metadata ─────────────────────────────────────────────

void OpenMPTModule::fillPositionInfo(PositionInfo& out) const {
    std::memset(&out, 0, sizeof(out));
    if (!mod_) return;

    const double posSec = openmpt_module_get_position_seconds(mod_);
    out.positionMs      = posSec * 1000.0;
    out.currentRow      = openmpt_module_get_current_row(mod_);
    out.currentOrder    = openmpt_module_get_current_order(mod_);
    out.bpm             = openmpt_module_get_current_estimated_bpm(mod_);
    out.numChannels     = openmpt_module_get_num_channels(mod_);
    out.speed           = openmpt_module_get_current_speed(mod_);
    out.sampleRate      = 0; // filled by caller when known
    out.audioFramesRendered = 0; // filled by caller when known
    out.rowFraction     = static_cast<float>(out.currentRow);

    // Resolve order → pattern
    if (out.currentOrder >= 0) {
        out.currentPattern = openmpt_module_get_order_pattern(mod_, out.currentOrder);
    }

    // Integer rowFraction: GetLength/time-at-row is O(song) and must stay off
    // the audio thread. Main thread extrapolates with BPM.

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

int OpenMPTModule::getNumPatterns() const {
    return mod_ ? openmpt_module_get_num_patterns(mod_) : 0;
}

double OpenMPTModule::getDurationSeconds() const {
    return mod_ ? openmpt_module_get_duration_seconds(mod_) : 0.0;
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
