// bloom_blur.wgsl
// Separable Gaussian blur (horizontal or vertical)

struct Uniforms {
    direction: vec2<f32>, // (1,0) for horizontal, (0,1) for vertical
    resolution: vec2<f32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let offset = uniforms.direction / uniforms.resolution;
    var color = vec4<f32>(0.0);

    // 13-tap Gaussian kernel (sigma = 2.0)
    let weights = array<f32, 13>(
        0.002216, 0.008764, 0.026995, 0.064759, 0.120985, 0.176033,
        0.199471,
        0.176033, 0.120985, 0.064759, 0.026995, 0.008764, 0.002216
    );

    for (var i = 0; i < 13; i = i + 1) {
        let index = f32(i) - 6.0;
        let sampleUV = uv + offset * index;
        color = color + textureSample(inputTexture, inputSampler, sampleUV) * weights[i];
    }

    return color;
}