// bloom_composite_layered.wgsl
// Composite the scene with three layered bloom textures additively.

struct Uniforms {
    sceneIntensity: f32,
    weight0: f32,
    weight1: f32,
    weight2: f32,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var sharedSampler: sampler;
@group(0) @binding(2) var bloomTexture0: texture_2d<f32>;
@group(0) @binding(3) var bloomTexture1: texture_2d<f32>;
@group(0) @binding(4) var bloomTexture2: texture_2d<f32>;
@group(0) @binding(5) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let sceneColor = textureSample(sceneTexture, sharedSampler, uv).rgb;
    let bloom0 = textureSample(bloomTexture0, sharedSampler, uv).rgb;
    let bloom1 = textureSample(bloomTexture1, sharedSampler, uv).rgb;
    let bloom2 = textureSample(bloomTexture2, sharedSampler, uv).rgb;

    var finalColor = sceneColor * uniforms.sceneIntensity
                   + bloom0 * uniforms.weight0
                   + bloom1 * uniforms.weight1
                   + bloom2 * uniforms.weight2;

    // ACES Filmic Tone Mapping — preserves note hue at high bloom intensity
    let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
    let tonemapped = clamp(
        (finalColor * (a * finalColor + b)) / (finalColor * (c * finalColor + d) + e),
        vec3<f32>(0.0), vec3<f32>(1.0)
    );
    return vec4(tonemapped, 1.0);
}
