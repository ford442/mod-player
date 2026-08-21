// compute_analysis.wgsl — GPU audio-analysis entry point.
//
// Two compute entry points share one bind group so the host can encode both
// into a single compute pass:
//
//   waveform_main — PCM → per-texel min/max tiles → oscilloscope envelope
//                   (replaces the CPU walk behind the v0.55 osc texture)
//   spectrum_main — PCM → Hann window → radix-2 FFT → 4 bands + 32 log bins
//                   (fills `audio.frequencies` without an AnalyserNode)
//
// The tracker engine is untouched: this shader only ever reads rendered PCM.
// No pattern data, no note triggering, no playhead — those stay on CPU/WASM.
//
// Host: src/renderers/webgpu/computeAnalysis.ts
// Libs: lib/waveform_minmax.wgsl, lib/fft.wgsl, lib/spectrum_bands.wgsl

struct AnalysisParams {
    /// PCM frames currently valid in `pcm` (oldest first).
    frameCount: u32,
    /// 1 = mono, 2 = interleaved stereo.
    channels: u32,
    /// Oscilloscope texel count (texture width).
    oscSampleCount: u32,
    /// Active FFT window length; clamped by the host to MAX_FFT_SIZE.
    fftSize: u32,
    /// log2(fftSize).
    fftBits: u32,
    sampleRate: f32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: AnalysisParams;
@group(0) @binding(1) var<storage, read> pcm: array<f32>;
/// One signed f32 per oscilloscope texel — copied straight into the r32float texture.
@group(0) @binding(2) var<storage, read_write> oscEnvelope: array<f32>;
/// (min, max) per texel, kept for a future rg32float oscilloscope texture.
@group(0) @binding(3) var<storage, read_write> oscExtrema: array<vec2<f32>>;
/// [0..3] band amplitudes, [4] amplitude, [5] rms, [6] peak, [7] valid flag.
@group(0) @binding(4) var<storage, read_write> spectrumMeta: array<f32>;
/// SPECTRUM_BIN_COUNT log-spaced magnitudes.
@group(0) @binding(5) var<storage, read_write> binsOut: array<f32>;

/// Mono sample for a PCM frame. Out-of-range frames read as silence so the
/// FFT load loop needs no per-invocation early-out (which would sit badly
/// next to the workgroup barriers below).
///
/// Defined before the waveform include on purpose — `lib/waveform_minmax.wgsl`
/// calls it, and WGSL resolves functions in declaration order.
fn waveformSampleMono(frame: u32) -> f32 {
    if (frame >= params.frameCount) { return 0.0; }
    if (params.channels == 2u) {
        let i = frame * 2u;
        return (pcm[i] + pcm[i + 1u]) * 0.5;
    }
    return pcm[frame];
}

//#include "lib/waveform_minmax.wgsl"
//#include "lib/fft.wgsl"
//#include "lib/spectrum_bands.wgsl"

/// Time-domain partials: .x = sum of squares, .y = peak magnitude.
var<workgroup> timePartial: array<vec2<f32>, FFT_WORKGROUP_SIZE>;

/// Matches the worklet's amplitude coefficient in openmpt-worklet.js so the
/// GPU and AnalyserNode paths drive the chassis at the same scale.
const AMPLITUDE_GAIN: f32 = 0.55;

// ── Pass A — oscilloscope waveform ───────────────────────────────────────────

@compute @workgroup_size(WAVEFORM_WORKGROUP_SIZE, 1, 1)
fn waveform_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let texel = gid.x;
    if (texel >= params.oscSampleCount) { return; }

    if (params.frameCount == 0u) {
        oscEnvelope[texel] = 0.0;
        oscExtrema[texel] = vec2<f32>(0.0, 0.0);
        return;
    }

    let extrema = waveformTileExtrema(texel, params.oscSampleCount, params.frameCount);
    oscExtrema[texel] = extrema;
    oscEnvelope[texel] = waveformEnvelope(extrema);
}

// ── Pass B — windowed spectrum ───────────────────────────────────────────────
//
// One workgroup, dispatched (1, 1, 1). Every barrier below sits in control flow
// driven only by uniform-buffer values.

@compute @workgroup_size(FFT_WORKGROUP_SIZE, 1, 1)
fn spectrum_main(@builtin(local_invocation_id) localId: vec3<u32>) {
    let lid = localId.x;
    let n = min(params.fftSize, MAX_FFT_SIZE);
    let bits = params.fftBits;
    let available = params.frameCount;

    // Analyse the most recent `n` frames of the block.
    var offset: u32 = 0u;
    if (available > n) { offset = available - n; }

    var sumSq = 0.0;
    var peak = 0.0;
    for (var i: u32 = lid; i < n; i = i + FFT_WORKGROUP_SIZE) {
        let s = waveformSampleMono(offset + i);
        sumSq = sumSq + s * s;
        peak = max(peak, abs(s));
        fftStoreWindowed(i, s, n, bits);
    }
    timePartial[lid] = vec2<f32>(sumSq, peak);
    workgroupBarrier();

    fftRunStages(n, bits, lid);
    workgroupBarrier();

    spectrumAccumulateBands(n, params.sampleRate, lid);
    workgroupBarrier();

    spectrumFillBins(n, params.sampleRate, lid);
    workgroupBarrier();

    if (lid != 0u) { return; }

    let bands = spectrumReduceBands();

    var totalSq = 0.0;
    var totalPeak = 0.0;
    for (var i: u32 = 0u; i < FFT_WORKGROUP_SIZE; i = i + 1u) {
        totalSq = totalSq + timePartial[i].x;
        totalPeak = max(totalPeak, timePartial[i].y);
    }

    spectrumMeta[0] = bands.x;
    spectrumMeta[1] = bands.y;
    spectrumMeta[2] = bands.z;
    spectrumMeta[3] = bands.w;
    spectrumMeta[4] = min(1.0, (bands.x + bands.y + bands.z + bands.w) * AMPLITUDE_GAIN);
    spectrumMeta[5] = sqrt(totalSq / f32(max(1u, n)));
    spectrumMeta[6] = totalPeak;
    spectrumMeta[7] = select(0.0, 1.0, available > 0u);

    for (var b: u32 = 0u; b < SPECTRUM_BIN_COUNT; b = b + 1u) {
        binsOut[b] = spectrumBins[b];
    }
}
