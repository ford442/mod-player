// Tunnel Shader - Fitted to Video Bezel
// Same Vertex Transform logic
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
  let scale = vec2<f32>(0.91, 0.74); 
  let offset = vec2<f32>(0.0, 0.2); 
  
  out.pos = vec4(rawPos * scale + offset, 0.0, 1.0);
  out.uv = rawPos * 0.5 + 0.5;
  return out;
}

@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let p = -1.0 + 2.0 * uv;
    let r = length(p);
    let a = atan2(p.y, p.x);
    let t = params.timeSec;
    
    // Simple Tunnel
    var col = vec3<f32>(0.0);
    let grid = abs(sin(20.0 * r - t * 4.0) * sin(10.0 * a));
    col = vec3<f32>(grid * 0.5, grid * 0.2, grid * 0.8) / r;
    
    return vec4<f32>(col, 1.0);
}