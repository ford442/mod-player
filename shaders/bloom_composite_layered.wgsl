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

// Peak output relative to SDR white. Pipeline-overridable: the host sets it
// only for an rgba16float + toneMapping 'extended' canvas (#492).
override hdrHeadroom: f32 = 1.0;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // The scene is rgba16float (HDR, unclamped): drop negative / runaway values
    // that an 8-bit target used to clamp away.
    let sceneColor = clamp(textureSample(sceneTexture, sharedSampler, uv).rgb, vec3<f32>(0.0), vec3<f32>(64.0));
    let bloom0 = textureSample(bloomTexture0, sharedSampler, uv).rgb;
    let bloom1 = textureSample(bloomTexture1, sharedSampler, uv).rgb;
    let bloom2 = textureSample(bloomTexture2, sharedSampler, uv).rgb;

    var finalColor = sceneColor * uniforms.sceneIntensity
                   + bloom0 * uniforms.weight0
                   + bloom1 * uniforms.weight1
                   + bloom2 * uniforms.weight2;

    // ACES Filmic Tone Mapping — preserves note hue at high bloom intensity.
    // Scaled by hdrHeadroom: 1.0 (SDR) is the plain curve clipped at white; on
    // an extended-range HDR canvas the shoulder lands at hdrHeadroom instead.
    let x = finalColor / hdrHeadroom;
    let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
    let tonemapped = clamp(
        (x * (a * x + b)) / (x * (c * x + d) + e),
        vec3<f32>(0.0), vec3<f32>(1.0)
    ) * hdrHeadroom;
    return vec4(tonemapped, 1.0);
}
