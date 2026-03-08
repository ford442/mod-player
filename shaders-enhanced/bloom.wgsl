// Bloom Post-Processing Shader
// Multi-pass bloom with downsample and upsample

// Binding 0: Input texture (scene render)
// Binding 1: Output texture (bloom result)
// Binding 2: Uniforms

struct BloomUniforms {
  threshold: f32,
  intensity: f32,
  radius: f32,
  direction: vec2<f32>, // (1, 0) for horizontal, (0, 1) for vertical
  mipLevel: f32,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> uniforms: BloomUniforms;
@group(0) @binding(3) var linearSampler: sampler;

// Downsample compute shader
@compute @workgroup_size(8, 8)
fn downsample(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let size = textureDimensions(inputTexture, 0);
  
  if (coord.x >= size.x / 2 || coord.y >= size.y / 2) {
    return;
  }
  
  // UV coordinates
  let uv = (vec2<f32>(coord) + 0.5) / vec2<f32>(size / 2);
  
  // 4-tap bilinear downsample with threshold
  var color = vec3<f32>(0.0);
  let offsets = array<vec2<f32>, 4>(
    vec2<f32>(-0.5, -0.5),
    vec2<f32>(0.5, -0.5),
    vec2<f32>(-0.5, 0.5),
    vec2<f32>(0.5, 0.5)
  );
  
  for (var i = 0; i < 4; i = i + 1) {
    let sampleUV = uv + offsets[i] / vec2<f32>(size);
    let sample = textureSampleLevel(inputTexture, linearSampler, sampleUV, uniforms.mipLevel).rgb;
    
    // Apply threshold
    let brightness = dot(sample, vec3<f32>(0.2126, 0.7152, 0.0722));
    let contribution = max(0.0, brightness - uniforms.threshold);
    color = color + sample * contribution;
  }
  
  color = color / 4.0;
  
  textureStore(outputTexture, coord, vec4<f32>(color, 1.0));
}

// Upsample and blur compute shader
@compute @workgroup_size(8, 8)
fn upsample(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let size = textureDimensions(outputTexture);
  
  if (coord.x >= size.x || coord.y >= size.y) {
    return;
  }
  
  let uv = (vec2<f32>(coord) + 0.5) / vec2<f32>(size);
  
  // Gaussian blur weights
  let weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  
  var result = textureSampleLevel(inputTexture, linearSampler, uv, uniforms.mipLevel).rgb * weights[0];
  
  // Sample in blur direction
  let texelSize = 1.0 / vec2<f32>(textureDimensions(inputTexture, i32(uniforms.mipLevel)));
  
  for (var i = 1; i < 5; i = i + 1) {
    let offset = uniforms.direction * f32(i) * uniforms.radius * texelSize;
    
    let sample1 = textureSampleLevel(inputTexture, linearSampler, uv + offset, uniforms.mipLevel).rgb;
    let sample2 = textureSampleLevel(inputTexture, linearSampler, uv - offset, uniforms.mipLevel).rgb;
    
    result = result + (sample1 + sample2) * weights[i];
  }
  
  textureStore(outputTexture, coord, vec4<f32>(result * uniforms.intensity, 1.0));
}

// Composite shader - add bloom to original
@compute @workgroup_size(8, 8)
fn composite(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let size = textureDimensions(outputTexture);
  
  if (coord.x >= size.x || coord.y >= size.y) {
    return;
  }
  
  let uv = (vec2<f32>(coord) + 0.5) / vec2<f32>(size);
  
  let original = textureSampleLevel(inputTexture, linearSampler, uv, 0.0).rgb;
  let bloom = textureSampleLevel(inputTexture, linearSampler, uv, uniforms.mipLevel).rgb;
  
  // Additive blending with intensity control
  let result = original + bloom * uniforms.intensity;
  
  // Tone mapping
  let toneMapped = result * (2.51 * result + 0.03) / (2.43 * result + 0.59 * result * result + 0.14);
  
  textureStore(outputTexture, coord, vec4<f32>(toneMapped, 1.0));
}
