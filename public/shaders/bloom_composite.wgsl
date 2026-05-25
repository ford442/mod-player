// bloom_composite.wgsl
// Composite the blurred bloom texture back over the scene

struct Uniforms {
    bloomIntensity: f32,
    sceneIntensity: f32,
};

struct CRTUniforms {
    intensity: f32,
    scanlineDark: f32,
    vignetteStrength: f32,
    _pad: f32,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;
@group(0) @binding(3) var bloomSampler: sampler;
@group(0) @binding(4) var<uniform> uniforms: Uniforms;
@group(0) @binding(5) var<uniform> crt: CRTUniforms;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let sceneColor = textureSample(sceneTexture, sceneSampler, uv).rgb;
    let bloomColor = textureSample(bloomTexture, bloomSampler, uv).rgb;

    // Linear combine (scene can be SDR; bloom is HDR)
    var finalColor = sceneColor * uniforms.sceneIntensity + bloomColor * uniforms.bloomIntensity;

    // CRT scanline + vignette effect (gated by crt.intensity; 0.0 = no effect)
    let row = floor(uv.y * f32(textureDimensions(sceneTexture).y));
    let scanline = select(1.0, 1.0 - crt.scanlineDark, (u32(row) % 2u) == 0u);
    let vd = length(uv - vec2<f32>(0.5));
    let vignette = 1.0 - crt.vignetteStrength * vd * vd;
    finalColor = mix(finalColor, finalColor * scanline * vignette, crt.intensity);

    // ACES Filmic Tone Mapping — preserves note hue at high bloom intensity
    let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
    let tonemapped = clamp(
        (finalColor * (a * finalColor + b)) / (finalColor * (c * finalColor + d) + e),
        vec3<f32>(0.0), vec3<f32>(1.0)
    );
    return vec4(tonemapped, 1.0);
}