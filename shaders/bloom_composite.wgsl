// bloom_composite.wgsl
// Composite the blurred bloom texture back over the scene

struct Uniforms {
    bloomIntensity: f32,
    sceneIntensity: f32,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;
@group(0) @binding(3) var bloomSampler: sampler;
@group(0) @binding(4) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let sceneColor = textureSample(sceneTexture, sceneSampler, uv).rgb;
    let bloomColor = textureSample(bloomTexture, bloomSampler, uv).rgb;
    
    // Linear combine (scene can be SDR; bloom is HDR)
    let finalColor = sceneColor * uniforms.sceneIntensity + bloomColor * uniforms.bloomIntensity;

    // Optional: simple Reinhard tone-mapping can be enabled by the host if desired
    // let tonemapped = finalColor / (finalColor + vec3<f32>(1.0));
    // return vec4(tonemapped, 1.0);

    return vec4(finalColor, 1.0);
}