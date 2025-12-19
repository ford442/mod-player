// bloom_threshold.wgsl
// Extract bright areas using a soft threshold (for HDR inputs)

struct Uniforms {
    threshold: f32,
    knee: f32,
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

    return vec4(bloom, 1.0);
}