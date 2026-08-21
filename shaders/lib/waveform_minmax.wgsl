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
