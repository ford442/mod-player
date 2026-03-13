// Clouds Shader - Fitted to Video Bezel
struct Uniforms {
  numRows: u32, numChannels: u32, playheadRow: u32, isPlaying: u32,
  cellW: f32, cellH: f32, canvasW: f32, canvasH: f32, tickOffset: f32, bpm: f32,
  timeSec: f32, beatPhase: f32, groove: f32, kickTrigger: f32, activeChannels: u32,
  isModuleLoaded: u32, bloomIntensity: f32, bloomThreshold: f32, invertChannels: u32, dimFactor: f32,
};
@group(0) @binding(1) var<uniform> params: Uniforms;

struct VertOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) idx: u32) -> VertOut {
  var v = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  let rawPos = v[idx];
  var out: VertOut;
  
  // FIT TO CHASSIS WINDOW:
  // Target Box: Center(0.0, 0.1), Size(0.92, 0.75) -> HalfSize(0.46, 0.375)
  // Transform: rawPos * scale + offset
  // Y is inverted in some pipelines, assuming standard -1..1 here.
  let scale = vec2<f32>(0.91, 0.74); // Slightly smaller than bezel hole to avoid overlap
  let offset = vec2<f32>(0.0, 0.2); // Shift up
  
  out.pos = vec4(rawPos * scale + offset, 0.0, 1.0);
  out.uv = rawPos * 0.5 + 0.5; // UV still 0..1 for internal shader logic
  return out;
}

// Minimal placeholder for verification (replace with original cloud logic if desired)
@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let t = params.timeSec * 0.5;
    let col = 0.5 + 0.5 * cos(t + uv.xyx + vec3<f32>(0., 2., 4.));
    return vec4<f32>(col, 1.0);
}