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
