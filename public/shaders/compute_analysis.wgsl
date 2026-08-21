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

// lib/waveform_minmax.wgsl — oscilloscope tile reduction.
//
// Include-only. Replaces the per-frame CPU walk that filled the v0.55
// oscilloscope texture (`uploadOscilloscopeTexture` in frameDraw.ts).
//
// ## Contract
//
// The including entry shader MUST define, *before* the include:
//
//   fn waveformSampleMono(frame: u32) -> f32
//
// returning the mono sample for a PCM frame index (WGSL resolves functions in
// declaration order, so the callee has to come first).
//
// ## Why min/max and not point sampling
//
// One texel usually covers several PCM frames. Point-sampling the first frame
// of each tile aliases badly — a 440 Hz tone decimated 8:1 turns into a
// wandering low-frequency wobble. Keeping both extrema preserves the envelope,
// and collapses to the exact sample when the tile is one frame wide.

const WAVEFORM_WORKGROUP_SIZE: u32 = 64u;

/// Half-open PCM frame range [x, y) that texel `texel` covers.
/// Always non-empty so the reduce below never divides by zero.
fn waveformTileRange(texel: u32, texelCount: u32, frameCount: u32) -> vec2<u32> {
    let start = (texel * frameCount) / texelCount;
    var end = ((texel + 1u) * frameCount) / texelCount;
    if (end <= start) { end = start + 1u; }
    return vec2<u32>(start, min(end, frameCount));
}

/// Reduce one tile to its (min, max) extrema.
fn waveformTileExtrema(texel: u32, texelCount: u32, frameCount: u32) -> vec2<f32> {
    let range = waveformTileRange(texel, texelCount, frameCount);
    if (range.y <= range.x) { return vec2<f32>(0.0, 0.0); }

    var lo = waveformSampleMono(range.x);
    var hi = lo;
    for (var f: u32 = range.x + 1u; f < range.y; f = f + 1u) {
        let s = waveformSampleMono(f);
        lo = min(lo, s);
        hi = max(hi, s);
    }
    return vec2<f32>(lo, hi);
}

/// Collapse extrema to the single signed f32 the r32float oscilloscope texture
/// carries: whichever excursion is larger, sign preserved. Identical to the
/// sample itself when the tile is one frame wide.
fn waveformEnvelope(extrema: vec2<f32>) -> f32 {
    if (abs(extrema.y) >= abs(extrema.x)) { return extrema.y; }
    return extrema.x;
}
// lib/fft.wgsl — radix-2 Cooley–Tukey FFT for the GPU audio-analysis pass.
//
// Include-only: declares no bindings and no entry points. The including entry
// shader owns `params`, the PCM storage buffer, and the dispatch shape.
//
// Design notes
// ────────────
//  * Single-workgroup, in-place, decimation-in-time. The transform lives in
//    workgroup storage so every butterfly stage is a shared-memory shuffle.
//  * MAX_FFT_SIZE is 1024 → `array<vec2<f32>, 1024>` = 8 KiB of workgroup
//    storage, half the 16 KiB WebGPU baseline (`maxComputeWorkgroupStorageSize`).
//    2048 would sit exactly on the baseline limit; the extra frequency
//    resolution is not worth failing pipeline creation on a tight adapter, so
//    the host clamps `fftSize` to MAX_FFT_SIZE and keeps the CPU AnalyserNode
//    path as the fallback.
//  * `fftSize` is a *runtime* uniform (256 / 512 / 1024) — only the first
//    `fftSize` entries of the workgroup array are touched, so one pipeline
//    serves every supported window length.
//
// Uniformity: every `workgroupBarrier()` below sits in control flow driven only
// by uniform-buffer values (`fftBits`), never by `local_invocation_id`.

const MAX_FFT_SIZE: u32 = 1024u;
const FFT_WORKGROUP_SIZE: u32 = 128u;
const FFT_TWO_PI: f32 = 6.28318530717958647692;

/// In-place transform buffer: real in .x, imaginary in .y.
var<workgroup> fftData: array<vec2<f32>, MAX_FFT_SIZE>;

/// Periodic Hann window. Periodic (divide by n) rather than symmetric
/// (divide by n-1) because the input is a continuous audio stream, not an
/// isolated finite record.
fn fftHann(i: u32, n: u32) -> f32 {
    return 0.5 - 0.5 * cos(FFT_TWO_PI * f32(i) / f32(n));
}

/// Reverse the low `bits` bits of `v` (index permutation for decimation-in-time).
fn fftBitReverse(v: u32, bits: u32) -> u32 {
    var x = v;
    x = ((x & 0x55555555u) << 1u) | ((x >> 1u) & 0x55555555u);
    x = ((x & 0x33333333u) << 2u) | ((x >> 2u) & 0x33333333u);
    x = ((x & 0x0F0F0F0Fu) << 4u) | ((x >> 4u) & 0x0F0F0F0Fu);
    x = ((x & 0x00FF00FFu) << 8u) | ((x >> 8u) & 0x00FF00FFu);
    x = (x << 16u) | (x >> 16u);
    return x >> (32u - bits);
}

/// Complex multiply.
fn fftCMul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

/// Store one windowed real sample at its bit-reversed slot.
/// Each `i` maps to a distinct destination, so the scatter is race-free.
fn fftStoreWindowed(i: u32, sample: f32, n: u32, bits: u32) {
    fftData[fftBitReverse(i, bits)] = vec2<f32>(sample * fftHann(i, n), 0.0);
}

/// Run all log2(n) butterfly stages. Call once, from every invocation of the
/// workgroup, after the bit-reversed load and a `workgroupBarrier()`.
///
/// Within a stage each butterfly owns a disjoint index pair, so only the
/// stage-to-stage boundary needs a barrier.
fn fftRunStages(n: u32, bits: u32, lid: u32) {
    let butterflies = n >> 1u;
    var len: u32 = 2u;
    for (var stage: u32 = 0u; stage < bits; stage = stage + 1u) {
        let half = len >> 1u;
        for (var k: u32 = lid; k < butterflies; k = k + FFT_WORKGROUP_SIZE) {
            let blockIdx = k / half;  // (`block` is a WGSL reserved word)
            let j = k % half;
            let i0 = blockIdx * len + j;
            let i1 = i0 + half;
            let angle = -FFT_TWO_PI * f32(j) / f32(len);
            let twiddle = vec2<f32>(cos(angle), sin(angle));
            let a = fftData[i0];
            let t = fftCMul(fftData[i1], twiddle);
            fftData[i0] = a + t;
            fftData[i1] = a - t;
        }
        workgroupBarrier();
        len = len << 1u;
    }
}

/// Single-sided magnitude of bin `k` (k in [0, n/2]), normalised so a
/// full-scale sinusoid reads ~1.0 through the Hann window.
fn fftMagnitude(k: u32, n: u32) -> f32 {
    // |X[k]| for a real sine of amplitude A landing on bin k is A*n*CG/2, where
    // CG is the window's coherent gain (0.5 for Hann). Undo the window gain
    // (x2) and fold the mirrored negative frequency back in (x2): 4/n.
    return length(fftData[k]) * (4.0 / f32(n));
}
// lib/spectrum_bands.wgsl — reduce an FFT magnitude spectrum to the shapes the
// chassis / pattern shaders consume.
//
// Include-only. Requires `lib/fft.wgsl` to be included FIRST — this file reads
// `fftData` and reuses `FFT_WORKGROUP_SIZE`.
//
// Two outputs:
//   * four band energies (bass / lowMid / highMid / treble)
//   * SPECTRUM_BIN_COUNT log-spaced bins for a spectrum chassis
//
// Band crossovers match the worklet's one-pole IIR split in
// public/worklets/openmpt-worklet.js (180 Hz and 1200 Hz) so the GPU path and
// the AnalyserNode fallback drive `audio.frequencies` with the same character.
// The 5 kHz highMid/treble split is new — the CPU path has no fourth band and
// folds highMid+treble back into `high` on readback.

const SPECTRUM_BIN_COUNT: u32 = 32u;

const BAND_BASS_HZ: f32 = 180.0;
const BAND_LOW_MID_HZ: f32 = 1200.0;
const BAND_HIGH_MID_HZ: f32 = 5000.0;

/// Log-spaced bin range for the spectrum display.
const SPECTRUM_MIN_HZ: f32 = 20.0;
const SPECTRUM_MAX_HZ: f32 = 16000.0;

/// Per-invocation band energy partials, reduced by invocation 0.
var<workgroup> bandPartial: array<vec4<f32>, FFT_WORKGROUP_SIZE>;
/// One log-spaced magnitude bin per entry; each is owned by a single invocation.
var<workgroup> spectrumBins: array<f32, SPECTRUM_BIN_COUNT>;

/// Which of the four bands a frequency belongs to (0 = bass … 3 = treble).
fn spectrumBandOf(freqHz: f32) -> u32 {
    if (freqHz < BAND_BASS_HZ) { return 0u; }
    if (freqHz < BAND_LOW_MID_HZ) { return 1u; }
    if (freqHz < BAND_HIGH_MID_HZ) { return 2u; }
    return 3u;
}

/// Accumulate this invocation's share of the band energies into `bandPartial`.
/// Skips DC (bin 0) — a tracker mix can carry a DC offset that would otherwise
/// pin the bass band high. Call from every invocation, then `workgroupBarrier()`.
fn spectrumAccumulateBands(n: u32, sampleRate: f32, lid: u32) {
    var acc = vec4<f32>(0.0);
    let halfN = n >> 1u;
    let hzPerBin = sampleRate / f32(n);
    for (var k: u32 = lid + 1u; k < halfN; k = k + FFT_WORKGROUP_SIZE) {
        let mag = fftMagnitude(k, n);
        let band = spectrumBandOf(f32(k) * hzPerBin);
        let energy = mag * mag;
        acc[band] = acc[band] + energy;
    }
    bandPartial[lid] = acc;
}

/// Sum every invocation's partial and convert energy → RMS-style amplitude.
/// Only meaningful on invocation 0, after the barrier that follows
/// `spectrumAccumulateBands`.
fn spectrumReduceBands() -> vec4<f32> {
    var total = vec4<f32>(0.0);
    for (var i: u32 = 0u; i < FFT_WORKGROUP_SIZE; i = i + 1u) {
        total = total + bandPartial[i];
    }
    return sqrt(total);
}

/// Fill `spectrumBins` with log-spaced peak magnitudes. Invocations
/// [0, SPECTRUM_BIN_COUNT) each own one bin, so no barrier is needed inside.
/// Call after the FFT stages have completed.
fn spectrumFillBins(n: u32, sampleRate: f32, lid: u32) {
    if (lid >= SPECTRUM_BIN_COUNT) { return; }

    let nyquist = sampleRate * 0.5;
    let hi = min(SPECTRUM_MAX_HZ, nyquist);
    let ratio = hi / SPECTRUM_MIN_HZ;
    let loHz = SPECTRUM_MIN_HZ * pow(ratio, f32(lid) / f32(SPECTRUM_BIN_COUNT));
    let hiHz = SPECTRUM_MIN_HZ * pow(ratio, f32(lid + 1u) / f32(SPECTRUM_BIN_COUNT));

    let binsPerHz = f32(n) / sampleRate;
    let halfN = n >> 1u;
    var kLo = max(1u, u32(floor(loHz * binsPerHz)));
    var kHi = min(halfN, u32(ceil(hiHz * binsPerHz)));
    // Low bins can be narrower than one FFT bin — widen to the nearest bin so
    // the display never shows a hole.
    if (kHi <= kLo) { kHi = min(halfN, kLo + 1u); }

    var peak = 0.0;
    for (var k: u32 = kLo; k < kHi; k = k + 1u) {
        peak = max(peak, fftMagnitude(k, n));
    }
    spectrumBins[lid] = peak;
}

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
