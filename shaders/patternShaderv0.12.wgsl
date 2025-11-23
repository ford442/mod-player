// Horizontal Pattern Grid Shader (Time = X, Channels = Y)

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: u32,
  pad: u32,
  cellW: f32,
  cellH: f32,
  canvasW: f32,
  canvasH: f32,
  texScale: vec2<f32>,
  texOffset: vec2<f32>,
  colorMix: f32,
  maskMix: f32,
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var myTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,

  // --- FIX ---
  // Added @interpolate(linear).
  // All floating-point values passed from vertex to fragment
  // MUST specify an interpolation type (e.g., linear, flat, perspective).
  @location(2) @interpolate(linear) uv: vec2<f32>,
  // -----------

  @location(3) @interpolate(flat) packedA: u32, // Note/Inst
  @location(4) @interpolate(flat) packedB: u32, // Vol/Effect/Param
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  // --- ORIENTATION FLIP ---
  // Horizontal Layout: Row increases X, Channel increases Y
  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

  // Convert to clip space
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Read packed data (2 u32s per cell)
  let idx = instanceIndex * 2u;
  let packedA = cells[idx];
  let packedB = cells[idx + 1u];

  return VertexOut(vec4<f32>(clipX, clipY, 0.0, 1.0), row, channel, lp, packedA, packedB);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let texUV = in.uv * uniforms.texScale + uniforms.texOffset;
  let texColor = textureSample(myTexture, mySampler, texUV);

  let mask = texColor.a; // Use alpha as mask
  let baseColor = vec3<f32>(0.0, 0.0, 0.0); // Default background

  // Mix texture color and mask
  let finalColor = mix(baseColor, texColor.rgb, uniforms.colorMix) * mask * uniforms.maskMix;

  return vec4<f32>(finalColor, 1.0);
}
