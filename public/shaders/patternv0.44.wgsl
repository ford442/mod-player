struct Uniforms {
  numRows: u32, numChannels: u32, playheadRow: u32, isPlaying: u32,
  cellW: f32, cellH: f32, canvasW: f32, canvasH: f32, tickOffset: f32,
  bpm: f32, timeSec: f32, beatPhase: f32, groove: f32, kickTrigger: f32,
  activeChannels: u32, isModuleLoaded: u32, bloomIntensity: f32, bloomThreshold: f32,
  invertChannels: u32, dimFactor: f32,
};
@group(0) @binding(1) var<uniform> params: Uniforms;

struct VertOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) idx: u32) -> VertOut {
  var v = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  var out: VertOut; out.pos = vec4(v[idx], 0.0, 1.0); out.uv = v[idx] * 0.5 + 0.5; return out;
}

@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // HORIZONTAL WALL (64 Steps)
    let cols = 64.0;
    let rows = f32(params.numChannels);
    let gridX = fract(uv.x * cols);
    let gridY = fract(uv.y * rows);
    
    let divX = smoothstep(0.4, 0.5, abs(gridX - 0.5));
    let divY = smoothstep(0.45, 0.5, abs(gridY - 0.5));
    
    var col = vec3<f32>(0.15, 0.16, 0.18);
    col -= vec3<f32>(0.05) * divY;
    col += vec3<f32>(0.02) * divX;
    
    let stepID = floor(uv.x * cols);
    if (u32(stepID) % 8u == 0u) { col += vec3<f32>(0.04); }

    return vec4<f32>(col, 0.8 * params.dimFactor);
}