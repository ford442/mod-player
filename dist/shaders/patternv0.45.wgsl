struct Uniforms {
  numRows: u32, numChannels: u32, playheadRow: u32, isPlaying: u32,
  cellW: f32, cellH: f32, canvasW: f32, canvasH: f32, tickOffset: f32,
  bpm: f32, timeSec: f32, beatPhase: f32, groove: f32, kickTrigger: f32,
  activeChannels: u32, isModuleLoaded: u32, bloomIntensity: f32, bloomThreshold: f32,
  invertChannels: u32, dimFactor: f32,
};
@group(0) @binding(1) var<uniform> params: Uniforms;

struct VertOut { 
    @builtin(position) pos: vec4<f32>, 
    @location(0) uv: vec2<f32>,
    @location(1) isUI: f32 
};

fn sdCircle(p: vec2<f32>, r: f32) -> f32 { return length(p) - r; }

@vertex
fn vs(@builtin(vertex_index) idx: u32, @builtin(instance_index) instanceIdx: u32) -> VertOut {
  var v = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  var out: VertOut;
  
  let noteCount = params.numRows * params.numChannels;
  
  // OPTIMIZATION: Only draw UI on the "extra" instances (indices >= noteCount)
  if (instanceIdx < noteCount) {
      out.pos = vec4(0.0); // Collapse geometry
      out.uv = vec2(0.0);
      out.isUI = 0.0;
      return out;
  }

  // Draw UI Quad
  out.pos = vec4(v[idx], 0.0, 1.0);
  out.uv = v[idx] * 0.5 + 0.5;
  out.isUI = 1.0;
  return out;
}

@fragment
fn fs(@location(0) uv: vec2<f32>, @location(1) isUI: f32) -> @location(0) vec4<f32> {
    if (isUI < 0.5) { discard; }

    let p = uv - 0.5;
    var col = vec4<f32>(0.0);
    
    // Play (Green)
    let dPlay = sdCircle(p - vec2<f32>(-0.44, -0.45), 0.035);
    if (dPlay < 0.0 && params.isPlaying > 0u) {
        let glow = exp(-length(p - vec2<f32>(-0.44, -0.45)) * 10.0);
        col = vec4<f32>(0.2, 1.0, 0.4, 1.0) * glow * 1.5;
    }

    // Stop (Red)
    let dStop = sdCircle(p - vec2<f32>(-0.35, -0.45), 0.035);
    if (dStop < 0.0 && params.isPlaying == 0u) {
        let glow = exp(-length(p - vec2<f32>(-0.35, -0.45)) * 10.0);
        col = vec4<f32>(1.0, 0.2, 0.2, 1.0) * glow * 1.5;
    }

    // Loop (Purple)
    let dLoop = sdCircle(p - vec2<f32>(-0.24, 0.42), 0.035);
    if (dLoop < 0.0) {
       col = vec4<f32>(0.8, 0.2, 1.0, 0.6);
    }

    if (col.a < 0.1) { discard; }
    return col;
}
