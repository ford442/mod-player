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
