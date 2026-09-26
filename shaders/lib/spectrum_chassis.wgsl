// lib/spectrum_chassis.wgsl — read the GPU spectrum bins and turn them into
// display levels + colour, for chassis / bezel shaders (v0.60 family).
//
// Include-only. The including shader must declare the storage binding itself
// (the slot is fixed by the host — SPECTRUM_BACKGROUND_BINDING = 4 in
// src/renderers/webgpu/bindGroup.ts):
//
//   @group(0) @binding(4) var<storage, read> spectrum: array<f32>;
//
// `spectrum` holds SPECTRUM_CHASSIS_BINS raw peak FFT magnitudes written by
// compute_analysis.wgsl (`binsOut`): Hann-windowed, coherent-gain normalised so
// a full-scale sine reads ~1.0, log-spaced 20 Hz .. 16 kHz, NOT smoothed. Before
// ComputeAnalysis exists — or after PCM stops — the host binds / writes zeros,
// which this lib maps to level 0, so silence always renders the static chassis.
//
// SPECTRUM_CHASSIS_BINS duplicates SPECTRUM_BIN_COUNT (computeAnalysis.ts and
// lib/spectrum_bands.wgsl); tests/spectrumChassis.test.ts pins all three.

const SPECTRUM_CHASSIS_BINS: u32 = 32u;

/// Display range for the dB mapping. A full-scale sine is 0 dB; quiet tracker
/// mixes put most bins between -60 and -20 dB.
const SPECTRUM_DB_FLOOR: f32 = -72.0;
const SPECTRUM_DB_RANGE: f32 = 60.0;
/// Music falls off with frequency (~-3 dB/oct), so lift the top of the range
/// or the treble bars never leave the floor. Applied linearly in `t`.
const SPECTRUM_TILT_DB: f32 = 14.0;
/// Contrast curve — >1 keeps the floor dark and makes peaks read as peaks.
const SPECTRUM_LEVEL_GAMMA: f32 = 1.35;

/// 20 * log10(x) = SPECTRUM_DB_PER_LOG2 * log2(x); WGSL has no log10.
const SPECTRUM_DB_PER_LOG2: f32 = 6.0205999;

/// Display level in [0, 1] for bin `i` (clamped to the valid range).
/// `t` is the bin's position along the frequency axis in [0, 1], used only for
/// the high-frequency tilt.
fn spectrumLevel(i: i32, t: f32) -> f32 {
    let idx = u32(clamp(i, 0, i32(SPECTRUM_CHASSIS_BINS) - 1));
    let mag = max(spectrum[idx], 1e-5);
    let db = SPECTRUM_DB_PER_LOG2 * log2(mag) + SPECTRUM_TILT_DB * t;
    let lin = clamp((db - SPECTRUM_DB_FLOOR) / SPECTRUM_DB_RANGE, 0.0, 1.0);
    return pow(lin, SPECTRUM_LEVEL_GAMMA);
}

/// Level for the bin under frequency-axis position `t` in [0, 1], stepped
/// (one flat level per bin — reads as discrete LED bars).
fn spectrumLevelAt(t: f32) -> f32 {
    let n = f32(SPECTRUM_CHASSIS_BINS);
    let i = i32(floor(clamp(t, 0.0, 0.9999) * n));
    return spectrumLevel(i, (f32(i) + 0.5) / n);
}

/// Mean level across bins [lo, hi] inclusive — for coarse "bass" / "treble" drivers.
fn spectrumBandLevel(lo: i32, hi: i32) -> f32 {
    let n = f32(SPECTRUM_CHASSIS_BINS);
    var sum = 0.0;
    for (var i: i32 = lo; i <= hi; i = i + 1) {
        sum = sum + spectrumLevel(i, (f32(i) + 0.5) / n);
    }
    return sum / f32(max(1, hi - lo + 1));
}

/// Bass → treble colour ramp (matches the v0.58 reactive palette: cyan, violet, pink).
fn spectrumColor(t: f32) -> vec3<f32> {
    let bass = vec3<f32>(0.0, 0.85, 1.0);
    let mid = vec3<f32>(0.55, 0.3, 1.0);
    let high = vec3<f32>(1.0, 0.45, 0.75);
    return mix(mix(bass, mid, smoothstep(0.0, 0.5, t)), high, smoothstep(0.5, 1.0, t));
}
