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
    // 32-Step HORIZONTAL (Like v0.21 but Horizontal)
    let cols = 32.0;
    let rows = f32(params.numChannels);
    let gridX = fract(uv.x * cols);
    let gridY = fract(uv.y * rows);
    
    // Sharp, precision lines (v0.21 style)
    let divX = step(0.9, gridX); // Sharp vertical line
    let divY = step(0.9, gridY); // Sharp horizontal line
    
    // v0.21 "Precision" Colors
    var col = vec3<f32>(0.1, 0.11, 0.12); // Deep dark grey
    
    // Highlight Beat (Every 4th)
    let stepID = floor(uv.x * cols);
    if (u32(stepID) % 4u == 0u) {
        col = vec3<f32>(0.13, 0.14, 0.16); // Slightly lighter band
    }

    // Add grid
    col += vec3<f32>(0.2) * divX;
    col += vec3<f32>(0.2) * divY;

    // Playhead Highlight
    let activeCol = params.playheadRow % 32u;
    if (u32(stepID) == activeCol) {
        col += vec3<f32>(0.1, 0.3, 0.4); // Cyan tint
    }

    return vec4<f32>(col, 0.85 * params.dimFactor);
}
