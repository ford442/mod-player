// bloom_threshold_layered.wgsl
// Extract bright areas using a soft threshold, then apply a per-layer tint.

struct Uniforms {
    threshold: f32,
    knee: f32,
    tintR: f32,
    tintG: f32,
    tintB: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let color = textureSample(sceneTexture, sceneSampler, uv).rgb;

    // Soft threshold (Quilez-style soft knee)
    let threshold = uniforms.threshold;
    let knee = uniforms.knee;
    let softness = threshold * knee;
    let brightness = max(color.r, max(color.g, color.b));
    let soft = brightness - threshold + softness;
    let factor = max(soft / (softness * 2.0), 0.0);
    let bloom = color * clamp(factor, 0.0, 1.0);

    // Apply per-layer tint
    let tint = vec3<f32>(uniforms.tintR, uniforms.tintG, uniforms.tintB);
    let tinted = bloom * tint;

    return vec4(tinted, 1.0);
}
